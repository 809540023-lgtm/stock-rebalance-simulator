// Generates historical candidate signals and evaluates their forward returns.
// Writes data/shared/evaluation.json with per-model performance summaries,
// 3/5/20-day returns, and comparisons against the TAIEX and a baseline.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { computeBullishScore, computeBearishScore, applyFilters } from "./models.js";
import { buildTradeRecord, summarizeTrades, compareToBaseline } from "./evaluation.js";

const signalStart = process.env.SIGNAL_START_DATE || process.argv[2] || "2026-06-15";
const signalEnd = process.env.SIGNAL_END_DATE || process.argv[3] || "2026-07-20";
const twseBase = process.env.TWSE_BASE_URL || "https://www.twse.com.tw";
const tpexOpenApiBase = process.env.TPEX_OPENAPI_BASE_URL || "https://www.tpex.org.tw/openapi/v1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", Referer: "https://www.tpex.org.tw/openapi/", "User-Agent": "stock-rebalance-simulator/1.0" },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.trimStart().startsWith("<")) throw new Error("The data provider returned HTML instead of JSON.");
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(800 * (attempt + 1));
    }
  }
  throw new Error(`${url}: ${lastError?.message || "request failed"}`);
}

function parseNumber(value) {
  const text = String(value ?? "").replaceAll(",", "").replace(/<[^>]+>/g, "").trim();
  if (!text || text === "--" || text === "-" || text === "X") return null;
  const n = Number(text.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function isoToRoc(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function dateToCompact(value) {
  return value.replaceAll("-", "");
}

function dateToMonthEnd(value) {
  const [year, month] = value.split("-");
  return `${year}-${month}-${new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate().toString().padStart(2, "0")}`;
}

function eachWeekday(start, end) {
  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday > 0 && weekday < 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function tableColumn(fields, patterns) {
  return fields.findIndex((field) => patterns.some((pattern) => String(field).includes(pattern)));
}

function isCommonStock(code) {
  return /^\d{4}$/.test(String(code).trim());
}

function parseTwseDaily(payload, date) {
  const table = (payload.tables || []).find((item) => {
    const fields = item.fields || [];
    return fields.some((field) => String(field).includes("證券代號")) && fields.some((field) => String(field).includes("收盤價"));
  });
  if (!table) return [];
  const fields = table.fields || [];
  const codeIndex = tableColumn(fields, ["證券代號"]);
  const nameIndex = tableColumn(fields, ["證券名稱"]);
  const closeIndex = tableColumn(fields, ["收盤價"]);
  const highIndex = tableColumn(fields, ["最高價"]);
  const lowIndex = tableColumn(fields, ["最低價"]);
  const volumeIndex = tableColumn(fields, ["成交股數"]);
  return (table.data || []).map((row) => ({
    market: "上市",
    code: String(row[codeIndex] || "").trim(),
    name: String(row[nameIndex] || "").trim(),
    date,
    close: parseNumber(row[closeIndex]),
    high: parseNumber(row[highIndex]),
    low: parseNumber(row[lowIndex]),
    volume: parseNumber(row[volumeIndex]) || 0
  })).filter((row) => isCommonStock(row.code) && Number.isFinite(row.close) && row.close > 0);
}

function parseTpexDaily(payload, date) {
  if (Array.isArray(payload)) {
    return payload.map((row) => ({
      market: "上櫃",
      code: String(row.SecuritiesCompanyCode || "").trim(),
      name: String(row.CompanyName || "").trim(),
      date,
      close: parseNumber(row.Close),
      high: parseNumber(row.High),
      low: parseNumber(row.Low),
      volume: parseNumber(row.TradingShares) || 0
    })).filter((item) => isCommonStock(item.code) && Number.isFinite(item.close) && item.close > 0);
  }
  const table = (payload.tables || []).find((item) => {
    const fields = item.fields || [];
    return fields.some((field) => String(field).includes("代號")) && fields.some((field) => String(field).includes("收盤"));
  });
  if (!table) return [];
  const fields = table.fields || [];
  const codeIndex = tableColumn(fields, ["代號"]);
  const nameIndex = tableColumn(fields, ["名稱"]);
  const closeIndex = tableColumn(fields, ["收盤"]);
  const highIndex = tableColumn(fields, ["最高"]);
  const lowIndex = tableColumn(fields, ["最低"]);
  const volumeIndex = tableColumn(fields, ["成交股數"]);
  return (table.data || []).map((row) => ({
    market: "上櫃",
    code: String(row[codeIndex] || "").trim(),
    name: String(row[nameIndex] || "").trim(),
    date,
    close: parseNumber(row[closeIndex]),
    high: parseNumber(row[highIndex]),
    low: parseNumber(row[lowIndex]),
    volume: parseNumber(row[volumeIndex]) || 0
  })).filter((item) => isCommonStock(item.code) && Number.isFinite(item.close) && item.close > 0);
}

async function fetchDailyPrices(date) {
  const twseUrl = `${twseBase}/rwd/zh/afterTrading/MI_INDEX?response=json&date=${dateToCompact(date)}&type=ALLBUT0999`;
  const tpexUrl = `${tpexOpenApiBase}/tpex_mainboard_daily_close_quotes?l=zh-tw&d=${encodeURIComponent(isoToRoc(date))}&s=0,asc,0`;
  const [twseResult, tpexResult] = await Promise.allSettled([fetchJson(twseUrl), fetchJson(tpexUrl)]);
  const rows = [];
  if (twseResult.status === "fulfilled") rows.push(...parseTwseDaily(twseResult.value, date));
  if (tpexResult.status === "fulfilled") rows.push(...parseTpexDaily(tpexResult.value, date));
  return rows;
}

async function fetchTaiex() {
  const months = [];
  const cursor = new Date(`${window.start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${window.end.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const rows = [];
  for (const month of months) {
    const payload = await fetchJson(`${twseBase}/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${dateToCompact(dateToMonthEnd(`${month}-01`))}`);
    for (const row of payload.data || []) {
      const match = String(row[0] || "").match(/(\d{2,3})\/(\d{2})\/(\d{2})/);
      if (!match) continue;
      const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
      const close = parseNumber(row[4]);
      if (date >= window.start && date <= window.end && Number.isFinite(close)) rows.push({ date, close });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchFundamentals() {
  const output = new Map();
  try {
    const rows = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL");
    for (const row of rows) {
      if (row.Code) output.set(`${row.Code}|上市`, { pe: parseNumber(row.PEratio), dividendYield: parseNumber(row.DividendYield), pb: parseNumber(row.PBratio) });
    }
  } catch (error) {
    console.warn(`TWSE fundamentals unavailable: ${error.message}`);
  }
  try {
    const payload = await fetchJson(`${tpexOpenApiBase}/tpex_mainboard_peratio_analysis`);
    const rows = Array.isArray(payload) ? payload : payload.aaData || [];
    for (const row of rows) {
      output.set(`${row.SecuritiesCompanyCode || row[0]}|上櫃`, { pe: parseNumber(row.PriceEarningRatio ?? row[2]), dividendYield: parseNumber(row.YieldRatio ?? row.DividendYield ?? row[5]), pb: parseNumber(row.PriceBookRatio ?? row[6]) });
    }
  } catch (error) {
    console.warn(`TPEx fundamentals unavailable: ${error.message}`);
  }
  return output;
}

async function fetchDisposition() {
  const codes = new Set();
  try {
    const rows = await fetchJson("https://openapi.twse.com.tw/v1/announcement/punish");
    for (const row of rows) {
      const code = String(row.Code || "").trim();
      if (isCommonStock(code)) codes.add(code);
    }
  } catch (error) {
    console.warn(`Disposition list unavailable: ${error.message}`);
  }
  return codes;
}

// Computes the model scores for a stock using only bars up to a cutoff date.
function scoreAt(series, cutoff, indexCloses, fundamental, dispositionSet) {
  const upTo = series.filter((bar) => bar.date <= cutoff);
  if (upTo.length < 2) return null;
  const indexUpTo = indexCloses.filter((row) => row.date <= cutoff).map((row) => row.close);
  const row = {
    code: series[0].code,
    market: series[0].market,
    endPrice: upTo.at(-1).close,
    avgVolume: upTo.reduce((sum, bar) => sum + bar.volume, 0) / upTo.length,
    ma10: upTo.length >= 10 ? upTo.slice(-10).reduce((sum, bar) => sum + bar.close, 0) / 10 : null,
    tradingDays: upTo.length - 1
  };
  const bullish = computeBullishScore(upTo, indexUpTo, fundamental);
  const bearish = computeBearishScore(upTo, indexUpTo, fundamental);
  const filters = applyFilters(row, dispositionSet);
  return { bullish, bearish, filters, upTo };
}

// Builds the data window covering lookback before signalStart and forward after signalEnd.
function buildWindow() {
  const start = new Date(`${signalStart}T00:00:00Z`);
  const end = new Date(`${signalEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 20);
  end.setUTCDate(end.getUTCDate() + 35);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const window = buildWindow();
const dates = eachWeekday(window.start, window.end);
const groups = new Map();
for (const date of dates) {
  const rows = await fetchDailyPrices(date);
  for (const row of rows) {
    const key = `${row.code}|${row.market}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  console.log(`${date}: ${rows.length} quotes`);
}

const [index, fundamentals, disposition] = await Promise.all([fetchTaiex(), fetchFundamentals(), fetchDisposition()]);
const indexCloses = index.map((row) => ({ date: row.date, close: row.close }));
const signalDates = eachWeekday(signalStart, signalEnd);

const trades = [];
for (const signalDate of signalDates) {
  for (const [key, series] of groups) {
    const sorted = series.sort((a, b) => a.date.localeCompare(b.date));
    const scored = scoreAt(sorted, signalDate, indexCloses, fundamentals.get(key), disposition);
    if (!scored) continue;
    const forward = sorted.filter((bar) => bar.date > signalDate).slice(0, 20);
    if (forward.length < 1) continue;
    const signal = { signalDate, model: "bullish", code: sorted[0].code, name: sorted[0].name, market: sorted[0].market, entryPrice: scored.upTo.at(-1).close };
    if (scored.bullish.passed && scored.filters.passed) trades.push(buildTradeRecord(signal, forward));
    signal.model = "bearish";
    if (scored.bearish.passed && scored.filters.passed) trades.push(buildTradeRecord(signal, forward));
  }
  console.log(`${signalDate}: ${trades.length} cumulative trades`);
}

const bullishTrades = trades.filter((trade) => trade.model === "bullish");
const bearishTrades = trades.filter((trade) => trade.model === "bearish");
const bullishSummary = summarizeTrades(bullishTrades);
const bearishSummary = summarizeTrades(bearishTrades);

// Baseline: average 20-day forward return of all liquid stocks (liquidity-matched).
const baselineReturns = [];
for (const [key, series] of groups) {
  const sorted = series.sort((a, b) => a.date.localeCompare(b.date));
  for (const signalDate of signalDates) {
    const upTo = sorted.filter((bar) => bar.date <= signalDate);
    if (upTo.length < 2) continue;
    const avgVolume = upTo.reduce((sum, bar) => sum + bar.volume, 0) / upTo.length;
    if (avgVolume < 500000) continue;
    const forward = sorted.filter((bar) => bar.date > signalDate).slice(0, 20);
    if (forward.length < 1) continue;
    baselineReturns.push((forward.at(-1).close / upTo.at(-1).close - 1) * 100);
  }
}
const baselineSummary = summarizeTrades(baselineReturns.map((value) => ({ netReturn: value })));

// Index average 20-day forward return.
const indexReturns = [];
for (let i = 0; i < indexCloses.length; i += 1) {
  const j = i + 20;
  if (j < indexCloses.length) indexReturns.push((indexCloses[j].close / indexCloses[i].close - 1) * 100);
}
const indexSummary = summarizeTrades(indexReturns.map((value) => ({ netReturn: value })));

const output = {
  generatedAt: new Date().toISOString(),
  signalRange: { start: signalStart, end: signalEnd },
  models: {
    bullish: { summary: bullishSummary, comparison: compareToBaseline(bullishSummary, indexSummary, baselineSummary), trades: bullishTrades },
    bearish: { summary: bearishSummary, comparison: compareToBaseline(bearishSummary, indexSummary, baselineSummary), trades: bearishTrades }
  },
  benchmarks: { index: indexSummary, baseline: baselineSummary }
};

await mkdir(new URL("../../data/shared/", import.meta.url), { recursive: true });
await writeFile(new URL("../../data/shared/evaluation.json", import.meta.url), JSON.stringify(output, null, 2), "utf8");
// A small summary file for the UI, omitting the full trade records.
const summary = {
  generatedAt: output.generatedAt,
  signalRange: output.signalRange,
  models: {
    bullish: { summary: output.models.bullish.summary, comparison: output.models.bullish.comparison },
    bearish: { summary: output.models.bearish.summary, comparison: output.models.bearish.comparison }
  },
  benchmarks: output.benchmarks
};
await writeFile(new URL("../../data/shared/evaluation-summary.json", import.meta.url), JSON.stringify(summary, null, 2), "utf8");
console.log(`Saved evaluation: ${bullishTrades.length} bullish, ${bearishTrades.length} bearish trades.`);
