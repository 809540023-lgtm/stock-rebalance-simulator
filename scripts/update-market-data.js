import { mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const response = await fetch(endpoint, {
  headers: { "User-Agent": "stock-rebalance-simulator/1.0" },
  signal: AbortSignal.timeout(30000)
});

if (!response.ok) {
  throw new Error(`TWSE API failed: ${response.status} ${response.statusText}`);
}

const rows = await response.json();
if (!Array.isArray(rows) || !rows.length) throw new Error("TWSE API returned no rows.");

function rocDateToIso(value) {
  const text = String(value || "");
  if (!/^\d{7}$/.test(text)) return text;
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
}

const stocks = {};
for (const row of rows) {
  const close = Number(row.ClosingPrice);
  if (!row.Code || !Number.isFinite(close) || close <= 0) continue;
  stocks[String(row.Code).toUpperCase()] = {
    name: String(row.Name || ""),
    close,
    change: Number(row.Change) || 0,
    date: rocDateToIso(row.Date)
  };
}

const marketDates = Object.values(stocks).map((item) => item.date).filter(Boolean).sort();
const output = {
  source: "Taiwan Stock Exchange OpenAPI / STOCK_DAY_ALL",
  sourceUrl: endpoint,
  fetchedAt: new Date().toISOString(),
  marketDate: marketDates.at(-1) || "",
  stocks
};

try {
  const existing = JSON.parse(await readFile("data/twse-latest.json", "utf8"));
  const unchanged = existing.marketDate === output.marketDate
    && JSON.stringify(existing.stocks) === JSON.stringify(output.stocks);
  if (unchanged) {
    console.log(`TWSE closing prices are already current for ${output.marketDate}.`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== "ENOENT") console.warn(`Existing market data could not be compared: ${error.message}`);
}

await mkdir("data", { recursive: true });
await writeFile("data/twse-latest.json", JSON.stringify(output), "utf8");
console.log(`Saved ${Object.keys(stocks).length} TWSE closing prices for ${output.marketDate}.`);
