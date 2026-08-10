import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const watchlistPath = "data/line-watchlist.json";
const riskDataPath = "market-risk-scanner/data/market-risk.json";
const fallbackMarketDataPath = "data/twse-latest.json";
const statePath = "data/line-market-alert-state.json";
const misBaseUrl = process.env.TWSE_MIS_BASE_URL || "https://mis.twse.com.tw";
const timezone = process.env.REMINDER_TIMEZONE || "Asia/Taipei";
const forceRun = process.env.FORCE_RUN === "true";
const dryRun = process.env.LINE_DRY_RUN === "true";
const testMode = process.env.LINE_TEST_MODE === "true";

async function writeSummary(message) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${message}\n`, "utf8");
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function parsePrice(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dateFromParts(parts) {
  return parts.reduce((result, part) => {
    if (part.type === "year") result.year = part.value;
    if (part.type === "month") result.month = part.value;
    if (part.type === "day") result.day = part.value;
    if (part.type === "hour") result.hour = part.value;
    if (part.type === "minute") result.minute = part.value;
    return result;
  }, {});
}

function taipeiNow() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = dateFromParts(formatter.formatToParts(new Date()));
  return {
    ...parts,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function normalizeDate(value) {
  const text = String(value || "").replaceAll("-", "").replaceAll("/", "");
  if (!/^\d{8}$/.test(text)) return String(value || "");
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function normalizeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^\d{4,6}$/.test(code) ? code : "";
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function fetchJson(url, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "stock-rebalance-simulator-limit-up-monitor/1.0"
        },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`${url}: ${lastError?.message || "request failed"}`);
}

async function resolveWatchlist() {
  const watchlist = await readJson(watchlistPath, { enabled: false });
  if (watchlist.enabled === false) return { codes: [], labels: new Map(), source: "已停用" };

  const configuredCodes = [...new Set((watchlist.symbols || []).map(normalizeCode).filter(Boolean))];
  if (configuredCodes.length) {
    const configuredLabels = Object.entries(watchlist.labels || {})
      .map(([code, name]) => [normalizeCode(code), String(name || "").trim()])
      .filter(([code, name]) => code && name);
    return {
      codes: configuredCodes,
      labels: new Map(configuredLabels),
      source: `自訂上市股票清單（${configuredCodes.length} 檔）`,
      declineAlertPct: Math.max(0.1, Math.min(10, Number(watchlist.declineAlertPct) || 3)),
      notifyOn: new Set(watchlist.notifyOn || ["limit-up"])
    };
  }

  const riskData = await readJson(riskDataPath, null);
  const riskRows = (riskData?.stocks || [])
    .filter((row) => row.market === "上市")
    .map((row) => ({ code: normalizeCode(row.code), name: String(row.name || "") }))
    .filter((row) => row.code);
  const limit = Math.max(1, Math.min(200, Number(watchlist.limit) || 50));
  if (riskRows.length) {
    return {
      codes: [...new Set(riskRows.map((row) => row.code))].slice(0, limit),
      labels: new Map(riskRows.map((row) => [row.code, row.name])),
      source: `風險排行前 ${limit} 檔上市股票`,
      declineAlertPct: Math.max(0.1, Math.min(10, Number(watchlist.declineAlertPct) || 3)),
      notifyOn: new Set(watchlist.notifyOn || ["limit-up"])
    };
  }

  const fallback = await readJson(fallbackMarketDataPath, { stocks: {} });
  const fallbackCodes = Object.keys(fallback.stocks || {}).map(normalizeCode).filter(Boolean).slice(0, limit);
  return {
    codes: [...new Set(fallbackCodes)],
    labels: new Map(),
    source: `證交所上市資料前 ${limit} 檔`,
    declineAlertPct: Math.max(0.1, Math.min(10, Number(watchlist.declineAlertPct) || 3)),
    notifyOn: new Set(watchlist.notifyOn || ["limit-up"])
  };
}

async function fetchQuotes(codes) {
  const quotes = [];
  for (const batch of chunk(codes, 30)) {
    const params = new URLSearchParams({
      ex_ch: batch.map((code) => `tse_${code}.tw`).join("|"),
      json: "1",
      delay: "0",
      _: String(Date.now())
    });
    const payload = await fetchJson(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`);
    quotes.push(...(Array.isArray(payload.msgArray) ? payload.msgArray : []));
  }
  return quotes;
}

function samePrice(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= Math.max(0.01, right * 0.00001);
}

export function findMarketEvents(quotes, today, labels = new Map(), options = {}) {
  const declineAlertPct = Math.max(0.1, Math.min(10, Number(options.declineAlertPct) || 3));
  const notifyOn = options.notifyOn instanceof Set
    ? options.notifyOn
    : new Set(options.notifyOn || ["limit-up", "limit-down", "decline"]);
  return quotes.flatMap((quote) => {
    const code = normalizeCode(quote.c);
    const quoteDate = normalizeDate(quote["^"]);
    const limitUp = parsePrice(quote.u);
    const limitDown = parsePrice(quote.w);
    const latest = parsePrice(quote.z);
    const high = parsePrice(quote.h);
    const low = parsePrice(quote.l);
    const previousClose = parsePrice(quote.y);
    if (!code || quoteDate !== today) return [];

    const name = String(quote.n || labels.get(code) || code);
    const changePct = latest && previousClose ? ((latest - previousClose) / previousClose) * 100 : null;
    const common = { date: today, code, name, latest, high, low, previousClose, changePct, detectedAt: new Date().toISOString() };
    const events = [];
    const touchedLimitUp = limitUp && (samePrice(latest, limitUp) || samePrice(high, limitUp));
    const touchedLimitDown = limitDown && (samePrice(latest, limitDown) || samePrice(low, limitDown));

    if (notifyOn.has("limit-up") && touchedLimitUp) {
      events.push({
        ...common,
        key: `${today}:${code}:limit-up`,
        type: "limit-up",
        limitPrice: limitUp,
        triggerPrice: samePrice(latest, limitUp) ? latest : high,
        trigger: samePrice(latest, limitUp) ? "最新成交價等於漲停價" : "盤中最高價觸及漲停價"
      });
    }

    if (notifyOn.has("limit-down") && touchedLimitDown) {
      events.push({
        ...common,
        key: `${today}:${code}:limit-down`,
        type: "limit-down",
        limitPrice: limitDown,
        triggerPrice: samePrice(latest, limitDown) ? latest : low,
        trigger: samePrice(latest, limitDown) ? "最新成交價等於跌停價" : "盤中最低價觸及跌停價"
      });
    }

    if (notifyOn.has("decline") && !touchedLimitDown && Number.isFinite(changePct) && changePct <= -declineAlertPct) {
      events.push({
        ...common,
        key: `${today}:${code}:decline-${declineAlertPct}`,
        type: "decline",
        thresholdPct: -declineAlertPct,
        triggerPrice: latest,
        trigger: `當日跌幅首次達到 ${declineAlertPct}% 警示門檻`
      });
    }

    return events;
  });
}

async function getLineAccessToken() {
  let token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (token) return token;
  const channelId = process.env.LINE_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN，或 LINE_CHANNEL_ID 與 LINE_CHANNEL_SECRET。");
  const response = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: channelId, client_secret: channelSecret })
  });
  if (!response.ok) throw new Error(`LINE token request failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("LINE token endpoint 沒有回傳 access token。");
  return payload.access_token;
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString("zh-TW", { maximumFractionDigits: 4 }) : "—";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

export function buildMessages(events, now) {
  const header = `台股價格異動通知\n時間：${now.date} ${now.hour}:${now.minute}\n\n`;
  const eventLabels = { "limit-up": "觸及漲停", "limit-down": "觸及跌停", decline: "跌幅警示" };
  const sections = events.map((event) => {
    const lines = [
      `${event.code} ${event.name}｜${eventLabels[event.type] || "價格異動"}`,
      `觸發價格：${formatPrice(event.triggerPrice)}`,
      `最新成交：${formatPrice(event.latest)}`,
      `昨收：${formatPrice(event.previousClose)}`,
      `當日漲跌：${formatPercent(event.changePct)}`
    ];
    if (event.type === "limit-up") lines.push(`漲停價：${formatPrice(event.limitPrice)}`);
    if (event.type === "limit-down") lines.push(`跌停價：${formatPrice(event.limitPrice)}`);
    lines.push(event.trigger);
    return lines.join("\n");
  });
  const messages = [];
  let current = header;
  for (const section of sections) {
    if (current.length + section.length + 2 > 4500 && current !== header) {
      messages.push(current.trim());
      current = header;
    }
    current += `${section}\n\n`;
  }
  if (current.trim() !== header.trim()) messages.push(current.trim());
  return messages.slice(0, 5).map((text) => ({ type: "text", text: `${text}\n\n來源：臺灣證券交易所 MIS；僅供行情提醒，不構成投資建議。` }));
}

function buildTestMessage(now) {
  return [{
    type: "text",
    text: [
      "LINE 通知連線測試成功",
      `時間：${now.date} ${now.hour}:${now.minute}`,
      "這是由股票價格異動監控系統手動發送的測試訊息。",
      "正式監控時，觀察清單內的股票觸及漲停、跌停或設定的跌幅門檻會通知。"
    ].join("\n")
  }];
}

async function pushLine(messages) {
  const userId = process.env.LINE_USER_ID?.trim();
  if (!userId) throw new Error("缺少 LINE_USER_ID，無法指定 LINE 通知對象。");
  const token = await getLineAccessToken();
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ to: userId, messages })
  });
  if (!response.ok) throw new Error(`LINE push failed: HTTP ${response.status} ${response.statusText}`);
}

function pruneEvents(events, today) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  return events.filter((event) => String(event.date) >= cutoff.toISOString().slice(0, 10)).slice(-500);
}

async function main() {
  const now = taipeiNow();
  if (testMode) {
    if (dryRun) {
      console.log("LINE_TEST_MODE=true 且 LINE_DRY_RUN=true，略過實際發送。");
      return;
    }
    await pushLine(buildTestMessage(now));
    await writeSummary(`## LINE 連線測試已送出\n\n- 日期：${now.date}\n- 時間：${now.hour}:${now.minute}`);
    console.log("LINE 連線測試訊息已送出。");
    return;
  }
  if (!forceRun && (now.minutes < 540 || now.minutes > 810)) {
    console.log(`目前為 ${now.date} ${now.hour}:${now.minute}，不在 TWSE 09:00–13:30 監控時段。`);
    return;
  }

  const watchlist = await resolveWatchlist();
  if (!watchlist.codes.length) {
    console.log("目前沒有可監控的上市股票。");
    return;
  }
  const quotes = await fetchQuotes(watchlist.codes);
  const events = findMarketEvents(quotes, now.date, watchlist.labels, watchlist);
  const state = await readJson(statePath, { events: [] });
  const known = new Set((state.events || []).map((event) => event.key));
  const newEvents = events.filter((event) => !known.has(event.key));
  console.log(`已檢查 ${watchlist.codes.length} 檔上市股票（${watchlist.source}），目前偵測 ${events.length} 個價格事件，新事件 ${newEvents.length} 個。`);
  if (!newEvents.length) return;

  const messages = buildMessages(newEvents, now);
  if (dryRun) {
    console.log("LINE_DRY_RUN=true，以下為不送出的通知內容：");
    console.log(messages.map((message) => message.text).join("\n---\n"));
    return;
  }

  await pushLine(messages);
  const nextState = { events: pruneEvents([...(state.events || []), ...newEvents], now.date) };
  await writeFile(statePath, JSON.stringify(nextState, null, 2) + "\n", "utf8");
  await writeSummary(`## TWSE 價格異動通知已送出\n\n- 監控範圍：${watchlist.source}\n- 新增通知：${newEvents.length} 個\n- 日期：${now.date}`);
  console.log(`LINE 價格異動通知已送出 ${newEvents.length} 個事件。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error.message);
    await writeSummary(`## TWSE 價格異動監控失敗\n\n${error.message}`);
    process.exitCode = 1;
  });
}
