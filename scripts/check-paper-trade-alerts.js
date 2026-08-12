import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const positionsPath = "data/paper-trade-positions.json";
const statePath = "data/paper-trade-alert-state.json";
const misBaseUrl = process.env.TWSE_MIS_BASE_URL || "https://mis.twse.com.tw";
const timezone = process.env.REMINDER_TIMEZONE || "Asia/Taipei";
const forceRun = process.env.FORCE_RUN === "true";
const dryRun = process.env.LINE_DRY_RUN === "true";
const testMode = process.env.LINE_TEST_MODE === "true";

async function writeSummary(message) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`, "utf8");
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

function normalizeDate(value) {
  const text = String(value || "").replaceAll("-", "").replaceAll("/", "");
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : String(value || "");
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
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    ...parts,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function priceTick(price) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

export function targetPriceForGain(buyPrice, gainPct) {
  const raw = Number(buyPrice) * (1 + Number(gainPct) / 100);
  const tick = priceTick(raw);
  return Number((Math.ceil((raw - 1e-9) / tick) * tick).toFixed(2));
}

async function fetchQuotes(codes) {
  const params = new URLSearchParams({
    ex_ch: codes.map((code) => `tse_${code}.tw`).join("|"),
    json: "1",
    delay: "0",
    _: String(Date.now())
  });
  const response = await fetch(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "stock-rebalance-paper-trade-monitor/1.0" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`TWSE MIS failed: HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.msgArray) ? payload.msgArray : [];
}

export function findPositionEvents(quotes, portfolio, today) {
  const byCode = new Map(quotes.map((quote) => [String(quote.c || "").trim(), quote]));
  return (portfolio.positions || []).flatMap((position) => {
    if (position.status !== "holding") return [];
    const quote = byCode.get(String(position.code));
    if (!quote || normalizeDate(quote["^"]) !== today) return [];

    const latest = parsePrice(quote.z) || parsePrice(quote.pz);
    const high = parsePrice(quote.h);
    const observed = Math.max(latest || 0, high || 0) || null;
    const quoteTime = String(quote.t || quote["%"] || "");
    const timeMatch = quoteTime.match(/^(\d{2}):(\d{2})/);
    const quoteMinutes = timeMatch ? Number(timeMatch[1]) * 60 + Number(timeMatch[2]) : null;
    const targetPrice = Number(position.targetPrice) || targetPriceForGain(position.buyPrice, portfolio.alertGainPct || 5);
    const returnPct = observed ? (observed / position.buyPrice - 1) * 100 : null;
    const common = {
      code: position.code,
      name: position.name,
      buyPrice: position.buyPrice,
      quantity: position.quantity,
      latest,
      high,
      observed,
      targetPrice,
      returnPct,
      quoteDate: today,
      detectedAt: new Date().toISOString()
    };
    const events = [];

    if (observed && observed >= targetPrice) {
      events.push({
        ...common,
        key: `${position.id}:target-${portfolio.alertGainPct || 5}`,
        type: "target",
        title: `獲利 ${portfolio.alertGainPct || 5}% 目標已觸及`
      });
    }

    if (today >= portfolio.evaluationTradingDate && latest && Number.isFinite(quoteMinutes) && quoteMinutes >= 805) {
      events.push({
        ...common,
        observed: latest,
        returnPct: (latest / position.buyPrice - 1) * 100,
        key: `${position.id}:evaluation-${portfolio.evaluationTradingDate}`,
        type: "evaluation",
        title: "三個交易日接近收盤投報率"
      });
    }
    return events;
  });
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "—";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

export function buildMessages(events, now) {
  return events.slice(0, 5).map((event) => ({
    type: "text",
    text: [
      `買入實測｜${event.title}`,
      `時間：${now.date} ${now.hour}:${now.minute}`,
      `${event.code} ${event.name}`,
      `成交價：${formatPrice(event.buyPrice)}`,
      `監測價格：${formatPrice(event.observed)}`,
      `投報率：${formatPercent(event.returnPct)}`,
      `5% 通知價：${formatPrice(event.targetPrice)}`,
      `持股：${Number(event.quantity).toLocaleString("zh-TW")} 股`,
      "來源：臺灣證券交易所 MIS；未計入交易成本。"
    ].join("\n")
  }));
}

async function getLineAccessToken() {
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return process.env.LINE_CHANNEL_ACCESS_TOKEN.trim();
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

async function pushLine(messages) {
  const userId = process.env.LINE_USER_ID?.trim();
  if (!userId) throw new Error("缺少 LINE_USER_ID，無法指定 LINE 通知對象。");
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${await getLineAccessToken()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ to: userId, messages })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`LINE push failed: HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const now = taipeiNow();
  const portfolio = await readJson(positionsPath, { positions: [] });
  if (testMode) {
    const messages = [{ type: "text", text: `買入實測追蹤器連線測試\n宏和 13.95｜5% 通知價 14.65\n麗清 21.20｜5% 通知價 22.30\n三交易日評估：2026-08-17` }];
    if (dryRun) console.log(messages[0].text);
    else await pushLine(messages);
    return;
  }
  if (!forceRun && (now.minutes < 540 || now.minutes > 810)) {
    console.log(`目前為 ${now.date} ${now.hour}:${now.minute}，不在 09:00–13:30 監控時段。`);
    return;
  }

  const codes = [...new Set((portfolio.positions || []).filter((position) => position.status === "holding").map((position) => position.code))];
  if (!codes.length) return;
  const events = findPositionEvents(await fetchQuotes(codes), portfolio, now.date);
  const state = await readJson(statePath, { events: [] });
  const known = new Set((state.events || []).map((event) => event.key));
  const newEvents = events.filter((event) => !known.has(event.key));
  console.log(`已檢查 ${codes.length} 檔買入實測股票，新事件 ${newEvents.length} 個。`);
  if (!newEvents.length) return;
  const messages = buildMessages(newEvents, now);
  if (dryRun) {
    console.log(messages.map((message) => message.text).join("\n---\n"));
    return;
  }
  await pushLine(messages);
  const nextEvents = [...(state.events || []), ...newEvents].slice(-100);
  await writeFile(statePath, `${JSON.stringify({ events: nextEvents }, null, 2)}\n`, "utf8");
  await writeSummary(`## 買入實測 LINE 通知已送出\n\n- 新事件：${newEvents.length}\n- 日期：${now.date}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error.message);
    await writeSummary(`## 買入實測監控失敗\n\n${error.message}`);
    process.exitCode = 1;
  });
}
