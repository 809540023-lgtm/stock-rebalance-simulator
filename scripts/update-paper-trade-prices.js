import { readFile, writeFile } from "node:fs/promises";

const positionsPath = "data/paper-trade-positions.json";
const outputPath = "data/paper-trade-latest.json";
const misBaseUrl = process.env.TWSE_MIS_BASE_URL || "https://mis.twse.com.tw";

function parsePrice(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value) {
  const text = String(value || "").replaceAll("-", "").replaceAll("/", "");
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : "";
}

const portfolio = JSON.parse(await readFile(positionsPath, "utf8"));
const codes = [...new Set((portfolio.positions || []).filter((position) => position.status === "holding").map((position) => String(position.code)))];
if (!codes.length) throw new Error("目前沒有持有中的實測股票。");

const params = new URLSearchParams({
  ex_ch: codes.map((code) => `tse_${code}.tw`).join("|"),
  json: "1",
  delay: "0",
  _: String(Date.now())
});
const response = await fetch(`${misBaseUrl}/stock/api/getStockInfo.jsp?${params}`, {
  headers: { Accept: "application/json", "User-Agent": "stock-rebalance-paper-trade-close/1.0" },
  signal: AbortSignal.timeout(20000)
});
if (!response.ok) throw new Error(`TWSE MIS failed: HTTP ${response.status}`);
const payload = await response.json();
const quotes = Array.isArray(payload.msgArray) ? payload.msgArray : [];
const stocks = {};

for (const quote of quotes) {
  const code = String(quote.c || "").trim();
  const close = parsePrice(quote.z) || parsePrice(quote.pz);
  const date = normalizeDate(quote["^"] || quote.d);
  if (!codes.includes(code) || !close || !date) continue;
  stocks[code] = {
    name: String(quote.n || code),
    close,
    high: parsePrice(quote.h),
    low: parsePrice(quote.l),
    date,
    time: String(quote.t || quote["%"] || "")
  };
}

if (Object.keys(stocks).length !== codes.length) {
  throw new Error(`MIS 只回傳 ${Object.keys(stocks).length}/${codes.length} 檔有效行情。`);
}

const marketDate = Object.values(stocks).map((stock) => stock.date).sort().at(-1);
const output = {
  source: "Taiwan Stock Exchange MIS",
  fetchedAt: new Date().toISOString(),
  marketDate,
  stocks
};

try {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  if (existing.marketDate === output.marketDate && JSON.stringify(existing.stocks) === JSON.stringify(output.stocks)) {
    console.log(`實測股票收盤資料已是最新：${output.marketDate}`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== "ENOENT") console.warn(`無法比較既有資料：${error.message}`);
}

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`已更新 ${codes.length} 檔實測股票收盤資料：${marketDate}`);
