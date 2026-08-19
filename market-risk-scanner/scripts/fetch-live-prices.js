// Fetches live prices for the current bullish/bearish candidates and writes
// data/shared/live-prices.json. Run by GitHub Actions during trading hours so
// the static site can read live prices without hitting browser CORS limits.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Referer: "https://mis.twse.com.tw/", "User-Agent": "stock-rebalance-simulator/1.0" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchLivePrices() {
  const bullish = (await readJson(new URL("bullish-latest.json", SHARED_DIR), { candidates: [] })).candidates || [];
  const bearish = (await readJson(new URL("bearish-latest.json", SHARED_DIR), { candidates: [] })).candidates || [];
  const codes = [...new Set([...bullish.slice(0, 10), ...bearish.slice(0, 10)].map((c) => String(c.code)))];
  const prices = {};
  if (codes.length) {
    const ex_ch = codes.map((c) => "tse_" + c + ".tw").join("|");
    const data = await fetchJson(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${ex_ch}&json=1&delay=0`);
    for (const row of data.msgArray || []) {
      if (row.z !== "-" && row.z != null) prices[row.c] = Number(row.z);
    }
  }
  return {
    fetchedAt: new Date().toISOString(),
    marketDate: new Date().toISOString().slice(0, 10),
    prices
  };
}

// CLI entry point.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").at(-1))) {
  const output = await fetchLivePrices();
  await mkdir(SHARED_DIR, { recursive: true });
  await writeFile(new URL("live-prices.json", SHARED_DIR), JSON.stringify(output, null, 2), "utf8");
  console.log(`Saved ${Object.keys(output.prices).length} live prices.`);
}
