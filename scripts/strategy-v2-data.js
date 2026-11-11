import { parseTaiexMonth, mergeBars, listMonthsEndingAt } from "../market-risk-scanner/scripts/persist-ohlcv-history.js";

const TWSE = "https://www.twse.com.tw/rwd/zh";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchOfficial(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Official feed HTTP ${response.status}`);
  return response.json();
}
const number = (v) => {
  const text = String(v ?? "").replaceAll(",", "").trim();
  if (!text || text === "--" || text === "-") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

export function parseListedDay(payload, expectedDate) {
  if (payload?.stat !== "OK" || payload.date !== expectedDate.replaceAll("-", "")) throw new Error("Official daily report date/status mismatch");
  const table = payload.tables?.find((t) => t.fields?.includes("證券代號") && t.fields.includes("開盤價"));
  const fields = ["證券代號", "證券名稱", "成交股數", "開盤價", "最高價", "最低價", "收盤價"];
  if (!table?.data?.length || fields.some((f) => !table.fields.includes(f))) throw new Error("Missing official OHLCV fields");
  const indexes = fields.map((f) => table.fields.indexOf(f));
  const rows = [];
  for (const r of table.data) {
    const [code, name, volume, open, high, low, close] = indexes.map((i) => r[i]);
    if (!/^[1-8]\d{3}$/.test(String(code)) || String(name).includes("-DR")) continue;
    const b = { date: expectedDate, volume: number(volume), open: number(open), high: number(high), low: number(low), close: number(close) };
    if (Object.values(b).some((x) => x === null) || b.low <= 0 || b.volume < 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close)) continue;
    rows.push({ key: `${code}|上市`, name: String(name).trim(), bar: b });
  }
  if (!rows.length) throw new Error("No valid common-stock OHLCV rows");
  return rows;
}

// One whole-market request per missing trading date replaces hundreds of
// per-symbol requests and never backdates an undated/latest-only response.
export async function refreshV2History(existing, asOfDate, config, request = fetchOfficial, delayMs = 1000) {
  let index = [];
  const sources = { index: {}, daily: { ...existing.sources?.daily } };
  for (const month of listMonthsEndingAt(asOfDate, 6)) {
    const payload = await request(`${TWSE}/TAIEX/MI_5MINS_HIST?response=json&date=${month.replace("-", "")}01`);
    if (payload.stat !== "OK") throw new Error(`Index month unavailable: ${month}`);
    const bars = parseTaiexMonth(payload).filter((b) => b.date <= asOfDate);
    index = mergeBars(index, bars);
    sources.index[month] = { fetched: bars.length, fetchedAt: new Date().toISOString() };
    await sleep(delayMs);
  }
  if (index.at(-1)?.date !== asOfDate) throw new Error("Latest expected index close unavailable");
  const url = (d) => `${TWSE}/afterTrading/MI_INDEX?response=json&date=${d.replaceAll("-", "")}&type=ALLBUT0999`;
  const latest = parseListedDay(await request(url(asOfDate)), asOfDate);
  const universe = new Set(latest.filter((r) => r.bar.close >= config.minPrice && r.bar.close <= config.maxPrice && r.bar.volume > 0).map((r) => r.key));
  const stocks = Object.fromEntries(Object.entries(existing.stocks || {}).map(([k, v]) => [k, v.filter((b) => b.date <= asOfDate)]));
  const names = { ...existing.names };
  const ingest = (rows) => {
    for (const row of rows) if (universe.has(row.key)) {
      stocks[row.key] = mergeBars(stocks[row.key] || [], [row.bar]);
      names[row.key] = row.name;
    }
  };
  ingest(latest);
  sources.daily[asOfDate] = { fetchedAt: new Date().toISOString(), rowCount: latest.length };
  const targetDates = index.slice(-config.minBars).map((b) => b.date).reverse();
  let requests = 1;
  for (const date of targetDates.filter((d) => d !== asOfDate)) {
    const cached = sources.daily[date] && [...universe].every((key) => (stocks[key] || []).some((b) => b.date === date));
    if (cached) continue;
    await sleep(delayMs);
    // Stop on a provider failure. Do not keep hammering a throttled endpoint.
    const rows = parseListedDay(await request(url(date)), date);
    ingest(rows);
    sources.daily[date] = { fetchedAt: new Date().toISOString(), rowCount: rows.length };
    requests++;
    if (requests % 10 === 0) console.log(`V2 daily repair: ${requests}/${targetDates.length} dates fetched`);
  }
  return { meta: { version: "ohlcv-history-v2", updatedAt: new Date().toISOString(), asOfDate, universeSource: "TWSE MI_INDEX price-filtered ordinary share research pool", universeKeys: [...universe].sort() }, index, stocks, names, sources, skipped: [] };
}
