// Combines the latest complete daily-model snapshot with official TWSE MIS
// intraday quotes. The output is a research watchlist, not an order list.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const scannerRoot = new URL("../", import.meta.url);
const inputPath = new URL("data/market-risk.json", scannerRoot);
const outputPath = new URL("data/intraday-analysis.json", scannerRoot);
const misBaseUrl = process.env.TWSE_MIS_BASE_URL || "https://mis.twse.com.tw";
const expectedDate = process.env.MARKET_DATE || new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function number(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function priceTick(price) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

export function roundToTick(price, direction) {
  const tick = priceTick(price);
  const units = direction === "up"
    ? Math.ceil((price - 1e-9) / tick)
    : Math.floor((price + 1e-9) / tick);
  return Number((units * tick).toFixed(2));
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function compactDate(value) {
  return String(value || "").replaceAll("-", "");
}

function marketChannel(stock) {
  return `${stock.market === "上櫃" ? "otc" : "tse"}_${stock.code}.tw`;
}

function firstBookPrice(value) {
  return number(String(value || "").split("_").find(Boolean));
}

function quotePrice(quote) {
  const traded = number(quote.z);
  if (traded) return { price: traded, estimated: false };
  const bid = firstBookPrice(quote.b);
  const ask = firstBookPrice(quote.a);
  if (bid && ask) return { price: (bid + ask) / 2, estimated: true };
  return { price: bid || ask || number(quote.o) || number(quote.y), estimated: true };
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Referer: "https://mis.twse.com.tw/",
          "User-Agent": "stock-rebalance-simulator-intraday/1.0"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }
  throw lastError;
}

async function fetchQuotes(stocks) {
  const byCode = new Map();
  for (const batch of chunks(stocks, 30)) {
    const params = new URLSearchParams({
      ex_ch: batch.map(marketChannel).join("|"),
      json: "1",
      delay: "0",
      _: String(Date.now())
    });
    const payload = await fetchJson(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`);
    for (const quote of payload.msgArray || []) {
      const code = String(quote.c || "").trim();
      if (code) byCode.set(code, quote);
    }
  }
  return byCode;
}

async function fetchIndexQuote() {
  const params = new URLSearchParams({ ex_ch: "tse_t00.tw", json: "1", delay: "0", _: String(Date.now()) });
  const payload = await fetchJson(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`);
  const quote = payload.msgArray?.[0];
  if (!quote) throw new Error("TWSE MIS did not return the TAIEX quote.");
  return quote;
}

async function fetchTwseShortEligibility(date) {
  const url = new URL("https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("selectType", "ALL");
  url.searchParams.set("response", "json");
  const payload = await fetchJson(url);
  return parseTwseShortEligibility(payload);
}

export function parseTwseShortEligibility(payload) {
  const table = (payload.tables || []).find((item) => item.fields?.includes("代號") && item.fields?.includes("註記"));
  if (!table) throw new Error("TWSE margin report does not contain the expected stock table.");
  const fields = table.fields;
  const codeIndex = fields.indexOf("代號");
  const noteIndex = fields.indexOf("註記");
  // The second limit column belongs to short selling in the grouped report.
  const limitIndexes = fields.map((field, index) => field === "次一營業日限額" ? index : -1).filter((index) => index >= 0);
  const shortLimitIndex = limitIndexes.at(-1);
  const output = new Map();
  for (const row of table.data || []) {
    const code = String(row[codeIndex] || "").trim();
    const note = String(row[noteIndex] || "").trim();
    const nextDayLimit = Number(String(row[shortLimitIndex] || "0").replaceAll(",", "")) || 0;
    if (code) output.set(code, {
      allowed: !note.includes("X") && nextDayLimit > 0,
      nextDayLimit,
      note: note || null
    });
  }
  return output;
}

function enrich(stock, quote, indexChangePct) {
  if (!quote || String(quote["^"] || quote.d || "") !== compactDate(expectedDate)) return null;
  const previousClose = number(quote.y);
  const current = quotePrice(quote);
  if (!previousClose || !current.price) return null;
  const changePct = (current.price / previousClose - 1) * 100;
  const relativePct = changePct - indexChangePct;
  return {
    market: stock.market,
    code: stock.code,
    name: stock.name,
    previousClose,
    currentPrice: Number(current.price.toFixed(2)),
    estimatedPrice: current.estimated,
    changePct: Number(changePct.toFixed(2)),
    relativePct: Number(relativePct.toFixed(2)),
    quoteTime: quote.t || quote["%"] || null,
    avgVolume: stock.avgVolume,
    cumulativePct: stock.cumulativePct,
    bullishScore: stock.bullishScore,
    bearishScore: stock.bearishScore,
    predictedChangePct: stock.predictedChangePct,
    bullishReasons: stock.bullishReasons,
    bearishReasons: stock.bearishReasons,
    tradingEligible: stock.tradingEligible
  };
}

function bearishRank(row) {
  const relativeWeakness = clamp(50 + (-row.relativePct * 12));
  const currentWeakness = clamp(50 + (-row.changePct * 10));
  const trendWeakness = clamp(50 + (-Number(row.cumulativePct || 0) * 3));
  const forecastWeakness = clamp(50 + (-Number(row.predictedChangePct || 0) * 8));
  return 0.35 * row.bearishScore + 0.30 * relativeWeakness + 0.15 * currentWeakness
    + 0.10 * trendWeakness + 0.10 * forecastWeakness;
}

function bullishRank(row) {
  const relativeStrength = clamp(50 + (row.relativePct * 12));
  const currentStrength = clamp(50 + (row.changePct * 8));
  const forecastStrength = clamp(50 + (Number(row.predictedChangePct || 0) * 8));
  const chasePenalty = row.changePct > 6 ? Math.min(20, (row.changePct - 6) * 4) : 0;
  return 0.45 * row.bullishScore + 0.30 * relativeStrength + 0.10 * currentStrength
    + 0.15 * forecastStrength - chasePenalty;
}

function pickLists(rows, shortEligibility) {
  const bearish = rows
    .filter((row) => row.bearishScore >= 60
      && row.market === "上市"
      && row.relativePct < 0
      && row.changePct > -7
      && Number(row.predictedChangePct) <= 0
      && shortEligibility.get(String(row.code))?.allowed)
    .map((row) => ({
      ...row,
      researchScore: Number(bearishRank(row).toFixed(2)),
      observationTrigger: roundToTick(row.currentPrice * 0.99, "down"),
      riskReference: roundToTick(row.currentPrice * 1.03, "up"),
      shortSale: shortEligibility.get(String(row.code)),
      reasons: [
        `盤中落後大盤 ${Math.abs(row.relativePct).toFixed(2)}%`,
        `空方模型 ${row.bearishScore.toFixed(0)} 分`,
        `短期預測 ${row.predictedChangePct.toFixed(2)}% 與空方一致`
      ],
      direction: "bearish"
    }))
    .sort((left, right) => right.researchScore - left.researchScore)
    .slice(0, 10);

  const bullish = rows
    .filter((row) => row.bullishScore >= 60
      && row.relativePct > 0
      && row.changePct > -3
      && row.changePct < 6
      && Number(row.predictedChangePct) >= 0)
    .map((row) => ({
      ...row,
      researchScore: Number(bullishRank(row).toFixed(2)),
      observationTrigger: roundToTick(row.currentPrice * 1.01, "up"),
      riskReference: roundToTick(row.currentPrice * 0.97, "down"),
      reasons: [
        `盤中領先大盤 ${row.relativePct.toFixed(2)}%`,
        `多方模型 ${row.bullishScore.toFixed(0)} 分`,
        `短期預測 +${row.predictedChangePct.toFixed(2)}% 與多方一致`
      ],
      direction: "bullish"
    }))
    .sort((left, right) => right.researchScore - left.researchScore)
    .slice(0, 5);
  return { bearish, bullish };
}

export async function analyzeIntradayMarket() {
  const daily = JSON.parse(await readFile(inputPath, "utf8"));
  const eligible = daily.stocks.filter((stock) => stock.filterPassed && stock.tradingEligible && stock.endPrice <= 50);
  const [indexQuote, stockQuotes, shortEligibility] = await Promise.all([
    fetchIndexQuote(),
    fetchQuotes(eligible),
    fetchTwseShortEligibility(expectedDate)
  ]);
  const indexDate = String(indexQuote["^"] || indexQuote.d || "");
  if (indexDate !== compactDate(expectedDate)) {
    throw new Error(`TWSE MIS index date ${indexDate || "missing"} does not match ${expectedDate}.`);
  }
  const indexPreviousClose = number(indexQuote.y);
  const indexCurrent = quotePrice(indexQuote).price;
  if (!indexPreviousClose || !indexCurrent) throw new Error("TWSE MIS index quote is incomplete.");
  const indexChangePct = (indexCurrent / indexPreviousClose - 1) * 100;
  const rows = eligible.map((stock) => enrich(stock, stockQuotes.get(String(stock.code)), indexChangePct)).filter(Boolean);
  const lists = pickLists(rows, shortEligibility);
  return {
    generatedAt: new Date().toISOString(),
    marketDate: expectedDate,
    source: "TWSE MIS intraday quotes plus the latest complete TWSE/TPEx daily-model snapshot",
    dailyModelDate: daily.range.end,
    index: {
      name: indexQuote.n,
      current: Number(indexCurrent.toFixed(2)),
      previousClose: indexPreviousClose,
      changePoints: Number((indexCurrent - indexPreviousClose).toFixed(2)),
      changePct: Number(indexChangePct.toFixed(2)),
      quoteTime: indexQuote.t || indexQuote["%"] || null
    },
    coverage: { eligibleStocks: eligible.length, liveQuotes: rows.length },
    candidates: lists,
    cautions: [
      "研究分數不是報酬保證，也不是自動下單指令。",
      "看空候選已排除證交所次一營業日融券註記 X 或限額為 0 的股票，但實際券源與借券成本仍須向券商確認。",
      "沒有最新成交價時以最佳買賣價中間值估算，estimatedPrice 會標示 true。"
    ]
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const output = await analyzeIntradayMarket();
  await mkdir(new URL("data/", scannerRoot), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}
