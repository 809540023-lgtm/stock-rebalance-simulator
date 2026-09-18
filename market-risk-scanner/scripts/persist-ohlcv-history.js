// Persists 61+ trading days of daily OHLCV history per candidate stock plus
// the TAIEX index, so preopen-research.js's strict feature engine can fully
// replace the legacy snapshot ranking in the published pre-open report.
//
// Sources (official, verified):
//   - Listed (上市): TWSE STOCK_DAY monthly endpoint -> full OHLCV per stock.
//   - OTC (上櫃):   TPEx OpenAPI tpex_mainboard_daily_close_quotes (whole OTC
//                   market per trading day; includes Open/High/Low/Close).
//   - TAIEX index:  TWSE MI_5MINS_HIST monthly endpoint (open/high/low/close).
//
// Persistence is incremental: months/days already represented in the history
// file are not re-fetched, and fetching uses bounded concurrency, so a daily
// run only refetches the most recent month plus any newly added candidates.
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const OHLCV_VERSION = "ohlcv-history-v1";
export const DEFAULT_OHLCV_CONFIG = {
  maxCandidates: 30, // top N per model; keeps the daily per-stock fetch bounded
  lookbackMonths: 6,
  otcLookbackDays: 110, // ~6 months of weekdays for the OTC per-day whole-market fetch
  concurrency: 2
};

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);
const HISTORY_PATH = new URL("ohlcv-history.json", SHARED_DIR);
const TWSE_BASE = process.env.TWSE_BASE_URL || "https://www.twse.com.tw";
const TPEX_OPENAPI = process.env.TPEX_OPENAPI_BASE_URL || "https://www.tpex.org.tw/openapi/v1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Referer: "https://www.tpex.org.tw/openapi/",
          "User-Agent": "stock-rebalance-simulator/1.0 (ohlcv persistence)"
        },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.trimStart().startsWith("<")) throw new Error("provider returned HTML instead of JSON");
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(900 * (attempt + 1));
    }
  }
  throw new Error(`${url}: ${lastError?.message || "request failed"}`);
}

// --- Pure parsing / conversion helpers (unit-tested) ---

export function rocDateToIso(value) {
  const text = String(value).trim();
  const parts = text.includes("/") ? text.split("/") : [text.slice(0, 3), text.slice(3, 5), text.slice(5, 7)];
  const [roc, month, day] = parts.map((part) => Number(part));
  if (!Number.isFinite(roc) || !Number.isFinite(month) || !Number.isFinite(day)
    || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`invalid ROC date ${value}`);
  }
  return `${roc + 1911}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isoToRocDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function parseNumber(value) {
  const text = String(value ?? "").replaceAll(",", "").replace(/<[^>]+>/g, "").trim();
  if (!text || text === "--" || text === "-" || text === "X") return null;
  const n = Number(text.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function isCommonStock(code) {
  return /^\d{4}$/.test(String(code).trim());
}

function normalizeBar(date, open, high, low, close, volume) {
  const bar = {
    date,
    open: parseNumber(open),
    high: parseNumber(high),
    low: parseNumber(low),
    close: parseNumber(close),
    volume: parseNumber(volume) || 0
  };
  const values = [bar.open, bar.high, bar.low, bar.close];
  if (bar.date === "" || values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  if (!(bar.high >= Math.max(bar.open, bar.close, bar.low)) || !(bar.low <= Math.min(bar.open, bar.close, bar.high))) return null;
  return bar;
}

// Parse a TWSE STOCK_DAY monthly payload into daily bars for one listed stock.
export function parseTwseStockDayMonth(payload) {
  const rows = payload?.data || [];
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const date = rocDateToIso(row[0]);
    // fields: 日期, 成交股數, 成交金額, 開盤價, 最高價, 最低價, 收盤價, ...
    const bar = normalizeBar(date, row[3], row[4], row[5], row[6], row[1]);
    if (bar) out.push(bar);
  }
  return out;
}

// Parse a day of the TPEx OpenAPI OTC whole-market payload into code-keyed bars.
export function parseTpexOpenapiDay(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  const out = {};
  for (const row of rows) {
    const code = String(row.SecuritiesCompanyCode || "").trim();
    if (!isCommonStock(code)) continue;
    const bar = normalizeBar(rocDateToIso(row.Date), row.Open, row.High, row.Low, row.Close, row.TradingShares);
    if (bar) out[code] = bar;
  }
  return out;
}

// Parse a TWSE MI_5MINS_HIST monthly payload into TAIEX daily bars.
export function parseTaiexMonth(payload) {
  const rows = payload?.data || [];
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const match = String(row[0]).match(/(\d{2,3})\/(\d{2})\/(\d{2})/);
    if (!match) continue;
    const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
    const bar = normalizeBar(date, row[1], row[2], row[3], row[4], 0);
    if (bar) out.push(bar);
  }
  return out;
}

// Merge incoming bars into an existing date-keyed list (dedupe + sort).
export function mergeBars(existing, incoming) {
  const byDate = new Map((existing || []).map((bar) => [bar.date, bar]));
  for (const bar of incoming || []) if (bar) byDate.set(bar.date, bar);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// List the N calendar months (YYYY-MM) ending at (and including) the given date.
export function listMonthsEndingAt(isoDate, count) {
  const [year, month] = isoDate.split("-").map(Number);
  const months = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i += 1) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return months;
}

// Which of `months` (YYYY-MM) are already represented by at least one bar.
export function monthsNotPresent(existingBars, months) {
  const present = new Set((existingBars || []).map((bar) => bar.date.slice(0, 7)));
  return months.filter((month) => !present.has(month));
}

// Bounded concurrency over an array of items.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function eachMondayToFriday(isoFrom, isoTo) {
  const days = [];
  const cursor = new Date(`${isoFrom}T00:00:00Z`);
  const last = new Date(`${isoTo}T00:00:00Z`);
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday > 0 && weekday < 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function addDays(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Read the candidate universe (code + market) from the latest shared snapshots.
export function readCandidateUniverse(bullish, bearish, maxCandidates = DEFAULT_OHLCV_CONFIG.maxCandidates) {
  const out = [];
  const seen = new Set();
  const push = (candidates) => (candidates || []).forEach((row) => {
    if (!/^\d{4}$/.test(String(row.code)) || !String(row.market)) return;
    const key = `${row.code}|${row.market}`;
    if (!seen.has(key)) { seen.add(key); out.push({ code: String(row.code), market: String(row.market), name: row.name || "" }); }
  });
  push((bullish?.candidates || []).slice(0, maxCandidates));
  push((bearish?.candidates || []).slice(0, maxCandidates));
  return out;
}

// Fetch the OHLCV pieces that are still missing and merge them into what exists.
export async function refreshOhlcvHistory({ bullish, bearish, existingIndex, existingStocks, maxCandidates }) {
  const universe = readCandidateUniverse(bullish, bearish, maxCandidates);
  const listed = universe.filter((s) => s.market === "上市");
  const otc = universe.filter((s) => s.market === "上櫃");

  const today = new Date().toISOString().slice(0, 10);
  const months = listMonthsEndingAt(today, DEFAULT_OHLCV_CONFIG.lookbackMonths);
  const otcLookbackTo = addDays(today, -DEFAULT_OHLCV_CONFIG.otcLookbackDays);
  const daysForOtc = eachMondayToFriday(otcLookbackTo, today);
  const concurrency = Number(process.env.OHLCV_CONCURRENCY) || DEFAULT_OHLCV_CONFIG.concurrency;

  const index = mergeBars([], existingIndex);
  const stocks = {};
  for (const [key, bars] of Object.entries(existingStocks || {})) stocks[key] = mergeBars([], bars);
  const names = {};
  for (const stock of universe) names[`${stock.code}|${stock.market}`] = stock.name || "";
  const sources = { index: {}, listed: {}, otc: {} };
  const skipped = [];

  // Index (TAIEX) — only fetch months not already represented.
  await mapLimit(monthsNotPresent(existingIndex, months), concurrency, async (month) => {
    const date = `${month}-01`;
    try {
      const payload = await fetchJson(`${TWSE_BASE}/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${date.replaceAll("-", "")}`);
      const bars = parseTaiexMonth(payload);
      index.push(...mergeBars([], bars));
      sources.index[month] = { fetched: bars.length, at: new Date().toISOString() };
    } catch (error) {
      sources.index[month] = { error: error.message };
      skipped.push(`index ${month}: ${error.message}`);
    }
    await sleep(60);
  });

  // Listed: per-stock STOCK_DAY per missing month, bounded concurrency.
  const listedJobs = [];
  for (const stock of listed) {
    const key = `${stock.code}|${stock.market}`;
    for (const month of monthsNotPresent(stocks[key] || [], months)) {
      listedJobs.push({ key, stock, month });
    }
  }
  await mapLimit(listedJobs, concurrency, async (job) => {
    const { key, stock, month } = job;
    const date = `${month}-01`;
    try {
      const payload = await fetchJson(`${TWSE_BASE}/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date.replaceAll("-", "")}&stockNo=${stock.code}`);
      const bars = parseTwseStockDayMonth(payload);
      stocks[key] = mergeBars(stocks[key] || [], bars);
      sources.listed[key] = sources.listed[key] || {};
      sources.listed[key][month] = { fetched: bars.length };
    } catch (error) {
      sources.listed[key] = sources.listed[key] || {};
      sources.listed[key][month] = { error: error.message };
      skipped.push(`${key} ${month}: ${error.message}`);
    }
    await sleep(60);
  });

  // OTC: whole-market per-day openapi, extracting only OTC candidate codes.
  if (otc.length) {
    const otcCodes = new Set(otc.map((s) => s.code));
    await mapLimit(daysForOtc, concurrency, async (day) => {
      const roc = isoToRocDate(day);
      try {
        const payload = await fetchJson(`${TPEX_OPENAPI}/tpex_mainboard_daily_close_quotes?l=zh-tw&d=${encodeURIComponent(roc)}&s=0,asc,0`);
        const dayBars = parseTpexOpenapiDay(payload);
        for (const code of otcCodes) {
          const bar = dayBars[code];
          if (bar) {
            const key = `${code}|上櫃`;
            stocks[key] = mergeBars(stocks[key] || [], [bar]);
            sources.otc[key] = sources.otc[key] || { days: {} };
            sources.otc[key].days[bar.date] = 1;
          }
        }
      } catch (error) {
        sources.otc[day] = { error: error.message };
        skipped.push(`otc ${day}: ${error.message}`);
      }
      await sleep(60);
    });
  }

  return { universe, index: mergeBars([], index), stocks, names, sources, skipped };
}

export async function saveOhlcvHistory() {
  const [bullish, bearish, existing] = await Promise.all([
    readJson(new URL("bullish-latest.json", SHARED_DIR)),
    readJson(new URL("bearish-latest.json", SHARED_DIR)),
    readJson(HISTORY_PATH, null)
  ]);
  if (!bullish && !bearish) throw new Error("No shared candidate snapshots found.");
  const previous = existing && existing.stocks ? existing.stocks : {};
  const prevIndex = Array.isArray(existing?.index) ? existing.index : [];
  const prevNames = existing && existing.names ? existing.names : {};
  const maxCandidates = Number(process.env.OHLCV_MAX_CANDIDATES) || DEFAULT_OHLCV_CONFIG.maxCandidates;

  const { universe, index, stocks, names, sources, skipped } = await refreshOhlcvHistory({
    bullish,
    bearish,
    existingIndex: prevIndex,
    existingStocks: previous,
    maxCandidates
  });

  // asOfDate = latest date present across all stock bars.
  const allDates = Object.values(stocks).flat().map((bar) => bar.date).sort();
  const asOfDate = allDates.at(-1) || index.at(-1)?.date || new Date().toISOString().slice(0, 10);

  const history = {
    meta: { version: OHLCV_VERSION, updatedAt: new Date().toISOString(), asOfDate },
    index,
    stocks,
    names: { ...prevNames, ...names },
    sources,
    skipped: skipped.slice(0, 50)
  };

  await mkdir(SHARED_DIR, { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");
  return {
    asOfDate,
    indexBars: index.length,
    universe: universe.length,
    stockKeys: Object.keys(stocks),
    skipped
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const result = await saveOhlcvHistory();
  console.log(`Saved OHLCV history asOf ${result.asOfDate}: ${result.universe} candidates, ${result.indexBars} index bars, ${result.stockKeys.length} stock series.`);
  if (result.skipped.length) console.log(`Skipped ${result.skipped.length} fetches (see history.skipped). First: ${result.skipped.slice(0, 5).join(" | ")}`);
}
