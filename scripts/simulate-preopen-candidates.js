// Simulates the pre-open research candidates (5 long + 10 short) at intraday
// moments. For each candidate it fetches the live TWSE MIS quote, then computes
// P/L assuming a fill at the report's `close` basis:
//   - long  candidates: profit when price rises (price - close) * qty
//   - short candidates: profit when price falls (close - price) * qty
// Aggregate net P/L includes commission per side and sale transaction tax.
// Writes:
//   data/preopen-simulation-latest.json   (overwrites each run)
//   data/preopen-simulation-history.json  (appends one record per run)
//
// Optional: pushes a plain-text summary to LINE when LINE_USER_ID is set.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const reportPath = new URL("data/shared/preopen-report.json", ROOT);
const latestPath = new URL("data/preopen-simulation-latest.json", ROOT);
const historyPath = new URL("data/preopen-simulation-history.json", ROOT);

const misBaseUrl = process.env.TWSE_MIS_BASE_URL || "https://mis.twse.com.tw";
const timezone = process.env.REMINDER_TIMEZONE || "Asia/Taipei";
const dryRun = process.env.LINE_DRY_RUN === "true";
const sharesPerCandidate = Number(process.env.SIM_SHARES || "1000");

// Exit strategy (user-confirmed): take-profit +6%, stop-loss -4%,
// force-close at 13:00 Taipei (30 min before the 13:30 close); no overnight.
// Applies to both long and short candidates using the day's high/low.
const TAKE_PROFIT_PCT = Number(process.env.SIM_TAKE_PROFIT_PCT || "6");
const STOP_LOSS_PCT = Number(process.env.SIM_STOP_LOSS_PCT || "4");
// 13:00 Taipei in minutes since midnight.
const FORCE_CLOSE_MINUTES = Number(process.env.SIM_FORCE_CLOSE_MINUTES || "780");

// Fee model (matches AGENTS.md): commission 0.1425% per side (min TWD 20),
// sale transaction tax 0.3% on normal trades.
const COMMISSION_RATE = 0.001425;
const MIN_COMMISSION = 20;
const SALE_TAX_RATE = 0.003;

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

// Live current price from a MIS quote row. `z` is the last traded price but can
// be "-" (e.g. before first trade or during some states); fall back to the
// nested trade.z, then open (o) and previous close (y).
function livePrice(quote) {
  return (
    parsePrice(quote?.z) ||
    parsePrice(quote?.trade?.z) ||
    parsePrice(quote?.o) ||
    parsePrice(quote?.y) ||
    null
  );
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
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    ...parts,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

async function fetchQuotes(codes) {
  const params = new URLSearchParams({
    ex_ch: codes.map((code) => `tse_${code}.tw`).join("|"),
    json: "1",
    delay: "0",
    _: String(Date.now())
  });
  const response = await fetch(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "stock-rebalance-preopen-simulator/1.0" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`TWSE MIS failed: HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.msgArray) ? payload.msgArray : [];
}

function sideFees(qty, refPrice, fillPrice) {
  const commission = Math.max(MIN_COMMISSION, qty * refPrice * COMMISSION_RATE) + Math.max(MIN_COMMISSION, qty * fillPrice * COMMISSION_RATE);
  const tax = qty * fillPrice * SALE_TAX_RATE;
  return { commission, tax };
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "—";
}

function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}` : "—";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

export function priceTick(price) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

function ticked(price) {
  const tick = priceTick(price);
  return Number((Math.round(price / tick) * tick).toFixed(2));
}

export function buildSnapshot(quotes, report, now) {
  const byCode = new Map(quotes.map((quote) => [String(quote.c || "").trim(), quote]));
  const rows = [];
  let costTotal = 0;
  let grossPnl = 0;
  let feesTotal = 0;
  let exitCount = { takeProfit: 0, stopLoss: 0, forceClose: 0, holding: 0 };

  const candidates = [
    ...(report.longCandidates || []).map((c) => ({ ...c, side: "long" })),
    ...(report.shortCandidates || []).map((c) => ({ ...c, side: "short" }))
  ];

  for (const candidate of candidates) {
    const basis = parsePrice(candidate.close);
    const quote = byCode.get(String(candidate.code));
    const price = livePrice(quote);
    if (!basis || !price) {
      rows.push({ rank: candidate.rank, side: candidate.side, code: candidate.code, name: candidate.name, basis, price: null, note: "no-live-quote" });
      continue;
    }
    const qty = sharesPerCandidate;
    const notional = qty * basis;
    const high = parsePrice(quote?.h) ?? price;
    const low = parsePrice(quote?.l) ?? price;

    // Determine exit state based on day high/low and current time.
    let exitType = "holding";
    let exitPrice = price;
    const forced = now.minutes >= FORCE_CLOSE_MINUTES;

    if (candidate.side === "long") {
      // Long: price up = profit. Take profit at +5%, stop at -4%.
      const takePrice = ticked(basis * (1 + TAKE_PROFIT_PCT / 100));
      const stopPrice = ticked(basis * (1 - STOP_LOSS_PCT / 100));
      if (high >= takePrice) { exitType = "takeProfit"; exitPrice = takePrice; }
      else if (low <= stopPrice) { exitType = "stopLoss"; exitPrice = stopPrice; }
      else if (forced) { exitType = "forceClose"; exitPrice = price; }
    } else {
      // Short: price down = profit. Take profit when low falls 5%, stop when high rises 4%.
      const takePrice = ticked(basis * (1 - TAKE_PROFIT_PCT / 100));
      const stopPrice = ticked(basis * (1 + STOP_LOSS_PCT / 100));
      if (low <= takePrice) { exitType = "takeProfit"; exitPrice = takePrice; }
      else if (high >= stopPrice) { exitType = "stopLoss"; exitPrice = stopPrice; }
      else if (forced) { exitType = "forceClose"; exitPrice = price; }
    }

    // gross: long gains on rise; short gains on fall.
    const gross = candidate.side === "long" ? (exitPrice - basis) * qty : (basis - exitPrice) * qty;
    const { commission, tax } = sideFees(qty, basis, exitPrice);
    const net = gross - commission - tax;
    const grossPct = gross / notional * 100;
    costTotal += notional;
    grossPnl += gross;
    feesTotal += commission + tax;
    exitCount[exitType] += 1;
    rows.push({
      rank: candidate.rank,
      side: candidate.side,
      code: candidate.code,
      name: candidate.name,
      basis,
      price,
      high,
      low,
      exitType,
      exitPrice: round(exitPrice),
      grossPnl: round(gross),
      grossPct,
      netPnl: round(net),
      netPct: net / notional * 100
    });
  }

  return {
    reportDataDate: report.dataDate,
    generatedAt: report.generatedAt,
    marketDate: normalizeDate(quotes[0]?.["^"] || ""),
    quoteTime: String(quotes[0]?.t || quotes[0]?.["%"] || ""),
    strategy: {
      takeProfitPct: TAKE_PROFIT_PCT,
      stopLossPct: STOP_LOSS_PCT,
      forceCloseLocalTime: `${Math.floor(FORCE_CLOSE_MINUTES / 60)}:${String(FORCE_CLOSE_MINUTES % 60).padStart(2, "0")}`,
      note: "當日模擬；停利/停損用當日高低點判定，13:00 後強制平倉，不留隔夜。"
    },
    exitCount,
    notionalBasis: round(costTotal),
    grossPnl: round(grossPnl),
    grossPct: costTotal ? grossPnl / costTotal * 100 : null,
    fees: round(feesTotal),
    netPnl: round(grossPnl - feesTotal),
    netPct: costTotal ? (grossPnl - feesTotal) / costTotal * 100 : null,
    positions: rows
  };
}

export function buildSummaryText(snapshot, now) {
  const rows = snapshot.positions || [];
  const longs = rows.filter((r) => r.side === "long");
  const shorts = rows.filter((r) => r.side === "short");
  const lines = [];
  lines.push(`📊 開盤前候選模擬 · 報告 ${snapshot.reportDataDate}｜行情 ${snapshot.marketDate} ${snapshot.quoteTime || ""}`);
  lines.push(`時間：${now.date} ${now.time}`);
  lines.push(`策略：+${snapshot.strategy.takeProfitPct}%停利 / -${snapshot.strategy.stopLossPct}%停損 / ${snapshot.strategy.forceCloseLocalTime}強制平倉`);
  lines.push(`基準市值 ${formatMoney(snapshot.notionalBasis)}｜淨損益 ${formatMoney(snapshot.netPnl)}（${formatPercent(snapshot.netPct)}）`);
  lines.push("");

  lines.push(`【做多｜${longs.length}】`);
  for (const p of longs) {
    if (p.price == null) { lines.push(`${p.code} ${p.name}：無即時報價`); continue; }
    lines.push(`${p.rank}. ${p.code} ${p.name} 現${formatPrice(p.price)}｜${exitLabel(p)}${formatPercent(p.netPct)}`);
  }
  lines.push("");
  lines.push(`【放空｜${shorts.length}】`);
  for (const p of shorts) {
    if (p.price == null) { lines.push(`${p.code} ${p.name}：無即時報價`); continue; }
    lines.push(`${p.rank}. ${p.code} ${p.name} 現${formatPrice(p.price)}｜${exitLabel(p)}${formatPercent(p.netPct)}`);
  }
  lines.push("");
  lines.push("來源：臺灣證券交易所 MIS；基準價為報告前收盤，停利/停損用當日高低點判定，淨損益含賣出成本估算，供研究參考、非下單依據。");
  return lines.join("\n");
}

function exitLabel(position) {
  const map = { takeProfit: "🟢停利 ", stopLoss: "🔴停損 ", forceClose: "⏰強平 ", holding: "⏳持有 " };
  return map[position.exitType] ?? "";
}

async function getLineAccessToken() {
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()) return process.env.LINE_CHANNEL_ACCESS_TOKEN.trim();
  const channelId = process.env.LINE_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) return null;
  const response = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: channelId, client_secret: channelSecret })
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.access_token || null;
}

async function pushLine(text) {
  const userId = process.env.LINE_USER_ID?.trim();
  const token = await getLineAccessToken();
  if (!userId || !token) {
    console.log("（LINE 未設定或缺少憑證，跳過推播）");
    return;
  }
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] })
  });
  if (!response.ok) throw new Error(`LINE push failed: HTTP ${response.status}`);
}

async function main() {
  const now = taipeiNow();
  const report = await readJson(reportPath, null);
  if (!report) {
    console.log("找不到開盤前報告 data/shared/preopen-report.json。");
    await writeSummary("## 候選模擬\n\n找不到 data/shared/preopen-report.json。");
    return;
  }

  const candidates = [...(report.longCandidates || []), ...(report.shortCandidates || [])];
  const codes = [...new Set(candidates.map((c) => String(c.code)))];
  if (!codes.length) {
    console.log("報告中沒有候選標的。");
    return;
  }

  const quotes = await fetchQuotes(codes);
  const snapshot = {
    version: "preopen-sim-v1",
    simulatedAt: new Date().toISOString(),
    tz: timezone,
    localDate: now.date,
    localTime: now.time,
    sharesPerCandidate,
    ...buildSnapshot(quotes, report, now)
  };

  await mkdir(new URL(".", latestPath), { recursive: true });
  await writeFile(latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const history = await readJson(historyPath, { simulations: [] });
  history.simulations = history.simulations || [];
  history.simulations.push({
    simulatedAt: snapshot.simulatedAt,
    localDate: snapshot.localDate,
    localTime: snapshot.localTime,
    reportDataDate: snapshot.reportDataDate,
    marketDate: snapshot.marketDate,
    quoteTime: snapshot.quoteTime,
    strategy: snapshot.strategy,
    exitCount: snapshot.exitCount,
    notionalBasis: snapshot.notionalBasis,
    grossPnl: snapshot.grossPnl,
    grossPct: snapshot.grossPct,
    fees: snapshot.fees,
    netPnl: snapshot.netPnl,
    netPct: snapshot.netPct
  });
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");

  const text = buildSummaryText(snapshot, now);
  console.log(text);
  await writeSummary(`## 開盤前候選模擬\n\n\`\`\`\n${text}\n\`\`\``);

  if (!dryRun) {
    await pushLine(text);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(error.message);
    await writeSummary(`## 候選模擬失敗\n\n${error.message}`);
    process.exitCode = 1;
  });
}
