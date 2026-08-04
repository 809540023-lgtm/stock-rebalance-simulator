import { mkdir, readFile, writeFile } from "node:fs/promises";

const startDate = process.env.RISK_START_DATE || process.argv[2] || "2026-07-10";
const endDate = process.env.RISK_END_DATE || process.argv[3] || "2026-08-04";
const twseBase = process.env.TWSE_BASE_URL || "https://www.twse.com.tw";
const tpexBase = process.env.TPEX_BASE_URL || "https://www.tpex.org.tw";

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
  throw new Error("RISK_START_DATE and RISK_END_DATE must be ISO dates, with start before end.");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "stock-rebalance-simulator/1.0" },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
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
    return fields.some((field) => String(field).includes("證券代號"))
      && fields.some((field) => String(field).includes("收盤價"));
  });
  if (!table) return [];
  const fields = table.fields || [];
  const codeIndex = tableColumn(fields, ["證券代號"]);
  const nameIndex = tableColumn(fields, ["證券名稱"]);
  const closeIndex = tableColumn(fields, ["收盤價"]);
  const changeIndex = tableColumn(fields, ["漲跌價差"]);
  const volumeIndex = tableColumn(fields, ["成交股數"]);
  return (table.data || []).map((row) => ({
    market: "上市",
    code: String(row[codeIndex] || "").trim(),
    name: String(row[nameIndex] || "").trim(),
    date,
    close: parseNumber(row[closeIndex]),
    change: parseNumber(row[changeIndex]),
    volume: parseNumber(row[volumeIndex]) || 0
  })).filter((row) => isCommonStock(row.code) && Number.isFinite(row.close) && row.close > 0);
}

function parseTpexDaily(payload, date) {
  const rows = Array.isArray(payload.aaData) ? payload.aaData : [];
  return rows.map((row) => ({
    market: "上櫃",
    code: String(row[0] || "").trim(),
    name: String(row[1] || "").trim(),
    date,
    close: parseNumber(row[2]),
    change: parseNumber(row[3]),
    volume: parseNumber(row[8]) || 0
  })).filter((item) => isCommonStock(item.code) && Number.isFinite(item.close) && item.close > 0);
}

async function fetchDailyPrices(date) {
  const twseUrl = `${twseBase}/rwd/zh/afterTrading/MI_INDEX?response=json&date=${dateToCompact(date)}&type=ALLBUT0999`;
  const tpexUrl = `${tpexBase}/web/stock/aftertrading/DAILY_CLOSE_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(isoToRoc(date))}`;
  const [twseResult, tpexResult] = await Promise.allSettled([fetchJson(twseUrl), fetchJson(tpexUrl)]);
  const rows = [];
  const warnings = [];
  if (twseResult.status === "fulfilled") rows.push(...parseTwseDaily(twseResult.value, date));
  else warnings.push(`上市 ${date}: ${twseResult.reason.message}`);
  if (tpexResult.status === "fulfilled") rows.push(...parseTpexDaily(tpexResult.value, date));
  else warnings.push(`上櫃 ${date}: ${tpexResult.reason.message}`);
  return { rows, warnings };
}

async function fetchTaiex() {
  const months = [...new Set([startDate.slice(0, 7), endDate.slice(0, 7)])];
  const rows = [];
  for (const month of months) {
    const payload = await fetchJson(`${twseBase}/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date=${dateToCompact(dateToMonthEnd(`${month}-01`))}`);
    for (const row of payload.data || []) {
      const match = String(row[0] || "").match(/(\d{2,3})\/(\d{2})\/(\d{2})/);
      if (!match) continue;
      const date = `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
      const close = parseNumber(row[4]);
      if (riskDateInRange(date, startDate, endDate) && Number.isFinite(close)) {
        rows.push({
          date,
          open: parseNumber(row[1]),
          high: parseNumber(row[2]),
          low: parseNumber(row[3]),
          close
        });
      }
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.map((row, index) => {
    const previous = rows[index - 1]?.close;
    const changePoints = Number.isFinite(previous) ? row.close - previous : 0;
    return { ...row, changePoints, changePct: Number.isFinite(previous) ? changePoints / previous * 100 : 0 };
  });
}

function riskDateInRange(date, start, end) {
  return date >= start && date <= end;
}

async function fetchFundamentals() {
  const output = new Map();
  try {
    const rows = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL");
    for (const row of rows) {
      if (row.Code) output.set(`${row.Code}|上市`, {
        pe: parseNumber(row.PEratio),
        dividendYield: parseNumber(row.DividendYield),
        pb: parseNumber(row.PBratio)
      });
    }
  } catch (error) {
    console.warn(`TWSE fundamentals unavailable: ${error.message}`);
  }
  try {
    const payload = await fetchJson(`${tpexBase}/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&o=json&d=${encodeURIComponent(isoToRoc(endDate))}`);
    for (const row of payload.aaData || []) {
      output.set(`${row[0]}|上櫃`, {
        pe: parseNumber(row[2]),
        dividendYield: parseNumber(row[5]),
        pb: parseNumber(row[6])
      });
    }
  } catch (error) {
    console.warn(`TPEx fundamentals unavailable: ${error.message}`);
  }
  return output;
}

function percentile(values, value) {
  if (!values.length) return 0;
  if (values.length === 1) return 100;
  const below = values.filter((item) => item <= value).length - 1;
  return Math.max(0, Math.min(100, below / (values.length - 1) * 100));
}

function fundamentalRisk(fundamental) {
  if (!fundamental) return { score: 40, reasons: ["基本面資料缺值"] };
  let score = 0;
  const reasons = [];
  if (!Number.isFinite(fundamental.pe) || fundamental.pe <= 0) {
    score += 30;
    reasons.push("本益比缺值或非正");
  } else if (fundamental.pe > 40) {
    score += 20;
    reasons.push("本益比偏高");
  }
  if (!Number.isFinite(fundamental.dividendYield)) {
    score += 15;
    reasons.push("殖利率缺值");
  } else if (fundamental.dividendYield < 1) {
    score += 10;
    reasons.push("殖利率偏低");
  }
  if (!Number.isFinite(fundamental.pb) || fundamental.pb <= 0) {
    score += 20;
    reasons.push("淨值比缺值或非正");
  } else if (fundamental.pb > 4) {
    score += 20;
    reasons.push("淨值比偏高");
  }
  return { score: Math.min(100, score), reasons };
}

function calculateStockRisk(quotes, fundamental) {
  const ordered = quotes.sort((a, b) => a.date.localeCompare(b.date));
  const startPrice = ordered[0].close;
  const endPrice = ordered.at(-1).close;
  const returns = [];
  let peak = startPrice;
  let maxDrawdownPct = 0;
  let downDays = 0;
  let currentStreak = 0;
  let maxDownStreak = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    peak = Math.max(peak, item.close);
    maxDrawdownPct = Math.min(maxDrawdownPct, (item.close / peak - 1) * 100);
    if (index === 0) continue;
    const dailyPct = (item.close / ordered[index - 1].close - 1) * 100;
    returns.push({ date: item.date, value: dailyPct });
    if (dailyPct < 0) {
      downDays += 1;
      currentStreak += 1;
      maxDownStreak = Math.max(maxDownStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  const fastest = returns.reduce((best, item) => item.value < best.value ? item : best, { date: "", value: 0 });
  const allVolumes = ordered.map((item) => item.volume).filter((item) => item > 0);
  const downVolumes = ordered.slice(1).filter((item, index) => returns[index].value < 0).map((item) => item.volume).filter((item) => item > 0);
  const average = allVolumes.length ? allVolumes.reduce((sum, value) => sum + value, 0) / allVolumes.length : 0;
  const downAverage = downVolumes.length ? downVolumes.reduce((sum, value) => sum + value, 0) / downVolumes.length : 0;
  const fundamentalResult = fundamentalRisk(fundamental);
  return {
    market: ordered[0].market,
    code: ordered[0].code,
    name: ordered[0].name,
    startDate: ordered[0].date,
    endDate: ordered.at(-1).date,
    startPrice,
    endPrice,
    cumulativePct: (endPrice / startPrice - 1) * 100,
    fastestDeclinePct: fastest.value,
    fastestDeclineDate: fastest.date,
    maxDrawdownPct,
    downDays,
    tradingDays: Math.max(0, ordered.length - 1),
    downVolumeRatio: average && downAverage ? downAverage / average : 0,
    maxDownStreak,
    pe: fundamental?.pe ?? null,
    dividendYield: fundamental?.dividendYield ?? null,
    pb: fundamental?.pb ?? null,
    fundamentalRisk: fundamentalResult.score,
    reasons: fundamentalResult.reasons
  };
}

function rankStocks(groups, fundamentals) {
  const rows = [...groups.values()]
    .filter((quotes) => quotes.length >= 2)
    .map((quotes) => calculateStockRisk(quotes, fundamentals.get(`${quotes[0].code}|${quotes[0].market}`)));
  const values = {
    speed: rows.map((row) => Math.abs(Math.min(0, row.fastestDeclinePct))),
    cumulative: rows.map((row) => Math.abs(Math.min(0, row.cumulativePct))),
    drawdown: rows.map((row) => Math.abs(row.maxDrawdownPct)),
    downRatio: rows.map((row) => row.tradingDays ? row.downDays / row.tradingDays : 0),
    volume: rows.map((row) => row.downVolumeRatio)
  };
  for (const row of rows) {
    const score = 0.30 * percentile(values.speed, Math.abs(Math.min(0, row.fastestDeclinePct)))
      + 0.25 * percentile(values.cumulative, Math.abs(Math.min(0, row.cumulativePct)))
      + 0.20 * percentile(values.drawdown, Math.abs(row.maxDrawdownPct))
      + 0.10 * percentile(values.downRatio, row.tradingDays ? row.downDays / row.tradingDays : 0)
      + 0.10 * percentile(values.volume, row.downVolumeRatio)
      + 0.05 * row.fundamentalRisk;
    row.riskScore = Number(score.toFixed(2));
    if (row.fastestDeclinePct <= -7) row.reasons.unshift("單日急跌接近跌停");
    else if (row.fastestDeclinePct <= -5) row.reasons.unshift("單日跌幅很快");
    if (row.cumulativePct <= -10) row.reasons.push("區間累積跌幅大");
    if (row.maxDownStreak >= 3) row.reasons.push("連跌天數偏長");
    if (row.downVolumeRatio >= 1.5) row.reasons.push("下跌日量能放大");
  }
  return rows.sort((a, b) => b.riskScore - a.riskScore);
}

const dates = eachWeekday(startDate, endDate);
const groups = new Map();
const warnings = [];
for (const date of dates) {
  const result = await fetchDailyPrices(date);
  warnings.push(...result.warnings);
  for (const row of result.rows) {
    const key = `${row.code}|${row.market}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  console.log(`${date}: ${result.rows.length} quotes`);
}

const [index, fundamentals] = await Promise.all([fetchTaiex(), fetchFundamentals()]);
const stocks = rankStocks(groups, fundamentals);
const output = {
  source: {
    twse: `${twseBase}/rwd/zh/afterTrading/MI_INDEX`,
    tpex: `${tpexBase}/web/stock/aftertrading/DAILY_CLOSE_quotes/stk_quote_result.php`,
    taiex: `${twseBase}/rwd/zh/TAIEX/MI_5MINS_HIST`,
    fundamentals: "TWSE BWIBBU_ALL plus TPEx daily PERatio analysis"
  },
  generatedAt: new Date().toISOString(),
  range: { start: startDate, end: endDate, tradingDays: index.length },
  index,
  stocks,
  warnings: warnings.slice(0, 20)
};

if (!index.length || !stocks.length) throw new Error("The official endpoints returned insufficient risk-scan data.");
await mkdir("data", { recursive: true });
await writeFile("data/market-risk.json", JSON.stringify(output), "utf8");
console.log(`Saved ${stocks.length} stock risk rows and ${index.length} index rows for ${startDate} to ${endDate}.`);
