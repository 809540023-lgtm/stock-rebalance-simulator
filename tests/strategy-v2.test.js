import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildV2Report, calendarSessions, validateSeries, activeV2, executionGate, V2_VERSION } from "../market-risk-scanner/scripts/strategy-v2.js";
import { monthsToRefresh } from "../market-risk-scanner/scripts/persist-ohlcv-history.js";
import { freezeReport, readJson } from "../scripts/run-strategy-v2.js";
import { advanceSimulation, observedQuote, reportUsable, closePosition } from "../scripts/strategy-v2-simulation.js";
import { summarizeV2 } from "../scripts/strategy-v2-summary.js";
import { parseListedDay, refreshV2History } from "../scripts/strategy-v2-data.js";
import { lineRetryKey, v2DailyMessage, notifyV2Daily } from "../scripts/strategy-v2-line.js";

const config = JSON.parse(await readFile(new URL("../data/shared/strategy-v2-config.json", import.meta.url)));
const calendar = [{ Date: "1150101", Name: "開國紀念日", Description: "放假" }, { Date: "1150102", Name: "開始交易日", Description: "開始交易" }];
const sessions = calendarSessions(calendar, 2026);
const dates = sessions.filter((d) => d <= "2026-11-11").slice(-70);
const bars = (fall = false) => dates.map((date, i) => {
  const close = fall ? 40 - i * 0.1 : 20 + i * 0.1;
  return { date, open: close + (fall ? 0.05 : -0.05), high: close + 0.1, low: close - 0.1, close, volume: 2000000 };
});
const index = dates.map((date, i) => ({ date, open: 1000, high: 1000, low: 1000, close: 1000, volume: 0 }));
const history = { index, stocks: { "1111|上市": bars(), "2222|上市": bars(true) }, names: { "1111|上市": "測試多", "2222|上市": "測試空" } };
const before = new Date("2026-11-12T06:50:00+08:00");
const build = (extra = {}) => buildV2Report({ ohlcv: history, calendar, config, tradeDate: "2026-11-12", now: before, ...extra });
const verified = { tradeDate: "2026-11-12", source: "test-fixture", verifiedAt: "2026-11-12T06:00:00+08:00", adjustmentVerified: true, commonStock: true, dayTradeAllowed: true, disposition: false, suspended: false, alteredTrading: false, sellFirstAllowed: true, brokerInventoryVerified: true, shortPriceRuleVerified: true, availableShares: 5000, borrowCostTwd: 30, minimumShortPrice: 0 };
function seal(report) {
  const { reportId, ...content } = report;
  return { ...content, reportId: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}
function executable(side = "long") {
  const row = { rank: 1, code: "1111", market: "上市", name: "測試", side, close: 20, triggerPrice: side === "long" ? 20.05 : 19.95, stopPct: 2, targetPct: 3, verification: verified, executionEligible: true };
  return seal({ version: V2_VERSION, tradeDate: "2026-11-12", dataDate: "2026-11-11", generatedAt: before.toISOString(), cutoff: "2026-11-12T07:00:00+08:00", config, status: "ready", preview: false, longCandidates: side === "long" ? [row] : [], shortCandidates: side === "short" ? [row] : [], contrarianWatchlist: [] });
}
const quote = (time = "09:05:00", price = "20.05") => ({ c: "1111", ex: "tse", d: "20261112", t: time, z: price, a: price + "_", b: price + "_", h: "21", l: "19", v: "1000" });
const at = (time) => new Date("2026-11-12T" + time + "+08:00");
const advance = (extra = {}) => advanceSimulation({ report: executable(), config, now: at("09:05:00"), quotes: [quote()], ...extra });

test("V2 activation uses Taipei midnight, not host/UTC date", () => {
  assert.equal(activeV2(new Date("2026-11-11T15:59:59Z")), false);
  assert.equal(activeV2(new Date("2026-11-11T16:00:00Z")), true);
});
test("official whole-market bars are schema mapped and date checked", () => {
  const payload = { stat: "OK", date: "20261111", tables: [{ fields: ["證券名稱", "證券代號", "成交股數", "開盤價", "最高價", "最低價", "收盤價"], data: [["測試", "1111", "1,000,000", "20", "21", "19", "20.5"], ["ETF", "0050", "1000", "20", "21", "19", "20.5"]] }] };
  assert.deepEqual(parseListedDay(payload, "2026-11-11")[0].bar, { date: "2026-11-11", volume: 1000000, open: 20, high: 21, low: 19, close: 20.5 });
  assert.equal(parseListedDay(payload, "2026-11-11").length, 1);
  assert.throws(() => parseListedDay(payload, "2026-11-10"), /mismatch/);
  assert.throws(() => parseListedDay({ ...payload, tables: [] }, "2026-11-11"), /fields/);
});
test("whole-market refresh repairs missing dates and reuses verified history", async () => {
  const calls = [];
  const request = async (url) => {
    const u = new URL(url), rawDate = u.searchParams.get("date");
    calls.push(url);
    if (u.pathname.includes("MI_5MINS_HIST")) return { stat: "OK", data: index.filter((b) => b.date.replaceAll("-", "").startsWith(rawDate.slice(0, 6))).map((b) => ["115/" + b.date.slice(5).replace("-", "/"), 1000, 1000, 1000, 1000]) };
    return { stat: "OK", date: rawDate, tables: [{ fields: ["證券代號", "證券名稱", "成交股數", "開盤價", "最高價", "最低價", "收盤價"], data: [["1111", "測試", "2000000", "20", "21", "19", "20"]] }] };
  };
  const first = await refreshV2History({ stocks: {}, names: {} }, "2026-11-11", config, request, 0);
  assert.equal(first.stocks["1111|上市"].length, 61);
  assert.equal(first.index.at(-1).date, "2026-11-11");
  assert.deepEqual(first.meta.universeKeys, ["1111|上市"]);
  calls.length = 0;
  const again = await refreshV2History(first, "2026-11-11", config, request, 0);
  assert.equal(calls.filter((u) => u.includes("afterTrading")).length, 1);
  assert.deepEqual(again.stocks, first.stocks);
  await assert.rejects(() => refreshV2History(first, "2026-11-12", config, request, 0), /expected index close/);
});
test("calendar distinguishes holidays from special opening rows", () => {
  assert.ok(!sessions.includes("2026-01-01"));
  assert.ok(sessions.includes("2026-01-02"));
  assert.throws(() => calendarSessions(calendar, 2027));
  assert.throws(() => calendarSessions([], 2026));
});
test("refresh repairs a partially cached active month and historic holes", () => {
  assert.deepEqual(monthsToRefresh([{ date: "2026-11-03" }], ["2026-11"]), ["2026-11"]);
  assert.deepEqual(monthsToRefresh([{ date: "2026-10-01" }], ["2026-11", "2026-10"], [{ date: "2026-10-02" }]), ["2026-11", "2026-10"]);
});
test("series rejects duplicated, future, missing, and invalid OHLC bars", () => {
  assert.equal(validateSeries(bars(), sessions, "2026-11-11").length, 61);
  assert.throws(() => validateSeries([...bars(), bars().at(-1)], sessions, "2026-11-11"), /Duplicate/);
  assert.throws(() => validateSeries([...bars(), { ...bars().at(-1), date: "2026-11-12" }], sessions, "2026-11-11"), /Future/);
  assert.throws(() => validateSeries(bars().slice(0, -1), sessions, "2026-11-11"), /Missing/);
  assert.throws(() => validateSeries([{ ...bars()[0], low: 500 }, ...bars().slice(1)], sessions, "2026-11-11"), /OHLC/);
});
test("independent confirmed models produce at most configured counts, with no fabricated qualifications", () => {
  const r = build();
  assert.equal(r.status, "ready");
  assert.equal(r.longCandidates.length, 1);
  assert.equal(r.shortCandidates.length, 1);
  assert.equal(r.longCandidates[0].code, "1111");
  assert.equal(r.shortCandidates[0].code, "2222");
  assert.equal(r.longCandidates[0].executionEligible, false);
  assert.equal(r.shortCandidates[0].shortTradable, false);
  assert.ok(r.contrarianWatchlist.every((r) => r.executionEligible === false));
});
test("requested five-long and ten-short caps are independent and never padded", () => {
  const stocks = {};
  for (let i = 0; i < 20; i++) { stocks[`${1100 + i}|上市`] = bars(); stocks[`${2200 + i}|上市`] = bars(true); }
  const r = build({ ohlcv: { ...history, stocks } });
  assert.equal(config.maxLongCandidates, 5);
  assert.equal(config.maxShortCandidates, 10);
  assert.equal(r.longCandidates.length, 5);
  assert.equal(r.shortCandidates.length, 10);
  assert.deepEqual(r.longCandidates.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.equal(build({ ohlcv: { ...history, stocks: {} } }).longCandidates.length, 0);
});
test("only qualification schema fields are published, never extra credentials", () => {
  const r = build({ verification: { "1111|上市": { ...verified, accessToken: "dummy-test-only", accountNumber: "dummy" } } });
  assert.deepEqual(r.longCandidates[0].verification, verified);
});
test("market regime prevents blindly shorting a broad bull trend", () => {
  const r = build({ ohlcv: { ...history, index: dates.map((date, i) => ({ date, open: 1000 + i, high: 1000 + i, low: 1000 + i, close: 1000 + i, volume: 0 })) } });
  assert.equal(r.regime, "bull");
  assert.equal(r.shortCandidates.length, 0);
});
test("disposition stocks are excluded and unknown verification fails closed", () => {
  const r = build({ verification: { "1111|上市": { disposition: true } } });
  assert.equal(r.longCandidates.length, 0);
  assert.equal(executionGate({}, "short", "2026-11-12", before).allowed, false);
  assert.equal(executionGate(verified, "short", "2026-11-12", before).allowed, true);
  assert.equal(executionGate({ ...verified, tradeDate: "2026-11-11" }, "short", "2026-11-12", before).allowed, false);
  assert.equal(executionGate({ ...verified, borrowCostTwd: null }, "short", "2026-11-12", before).allowed, false);
});
test("late, holiday, and stale-index reports never fall back to legacy candidates", () => {
  assert.equal(build({ now: at("07:00:00") }).status, "missed-cutoff");
  assert.equal(build({ tradeDate: "2026-11-14" }).status, "market-closed");
  const stale = build({ ohlcv: { ...history, index: index.slice(0, -1) } });
  assert.equal(stale.status, "data-blocked");
  assert.deepEqual(stale.longCandidates, []);
});
test("frozen report is immutable, preview cannot become a trading report", async () => {
  const dir = await mkdtemp(tmpdir() + "/stock-v2-");
  const path = pathToFileURL(dir + "/day.json");
  try {
    const r = build();
    await freezeReport(path, r);
    assert.deepEqual(await freezeReport(path, { ...r, longCandidates: [] }), r);
    assert.deepEqual(await readJson(path), r);
    await assert.rejects(() => freezeReport(path, { ...r, preview: true }));
    assert.equal(reportUsable(seal({ ...executable(), preview: true }), "2026-11-12"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("report hash, version, date and deadline are enforced before simulation", () => {
  const r = executable();
  assert.equal(reportUsable(r, "2026-11-12"), true);
  assert.equal(reportUsable({ ...r, longCandidates: [] }, "2026-11-12"), false);
  assert.equal(reportUsable(r, "2026-11-13"), false);
  assert.equal(advance({ report: { ...r, version: "old" } }).status, "blocked");
  assert.equal(advance({ report: null, now: at("15:00:00") }).finalized, true);
});
test("stale quotes, previous close fallbacks, missing volume and future ticks cannot fill", () => {
  assert.equal(observedQuote({ ...quote(), z: "-", y: "20" }, "2026-11-12", at("09:05:00"), config), null);
  assert.equal(observedQuote(quote("09:00:00"), "2026-11-12", at("09:05:00"), config), null);
  assert.equal(observedQuote({ ...quote(), d: "20261111" }, "2026-11-12", at("09:05:00"), config), null);
  assert.equal(observedQuote({ ...quote(), v: "0" }, "2026-11-12", at("09:05:00"), config), null);
  assert.equal(observedQuote(quote("09:06:00"), "2026-11-12", at("09:05:00"), config), null);
});
test("entries use observed ask plus slippage, never the signal close", () => {
  const p = advance().positions[0];
  assert.equal(p.status, "open");
  assert.ok(p.entryPrice > 20.05);
  assert.equal(p.entryAt, "2026-11-12T09:05:00+08:00");
  assert.equal(p.quantity % 1000, 0);
  assert.ok(p.quantity * p.entryPrice <= config.initialCapital * config.maxPositionPct / 100);
});
test("no fills without verification, depth, valid gap, or an entry window", () => {
  const r = executable(); r.longCandidates[0].verification = null;
  assert.equal(advance({ report: seal(r) }).positions[0].status, "watch");
  assert.equal(advance({ quotes: [{ ...quote(), a: "-" }] }).positions[0].status, "watch");
  assert.equal(advance({ quotes: [{ ...quote(), a: "20", b: "21" }] }).positions[0].status, "watch");
  assert.equal(advance({ quotes: [quote("09:05:00", "23")] }).positions[0].status, "watch");
  assert.equal(advance({ quotes: [quote("10:05:00")], now: at("10:05:00") }).positions[0].status, "unfilled");
  assert.equal(advance({ quotes: [{ ...quote(), h: "20.05", l: "20.05" }] }).positions[0].status, "watch");
});
test("daily high/low before entry cannot retrospectively trigger take profit", () => {
  const previous = advance({ quotes: [{ ...quote(), h: "40", l: "10" }] });
  const next = advance({ previous, quotes: [{ ...quote("09:06:00"), h: "40", l: "10" }], now: at("09:06:00") });
  assert.equal(next.positions[0].status, "open");
});
test("gap stop exits at observed executable price and closed positions never reopen", () => {
  const previous = advance();
  const stopped = advance({ previous, quotes: [quote("09:06:00", "18")], now: at("09:06:00") });
  assert.equal(stopped.positions[0].exitType, "stopLoss");
  assert.ok(stopped.positions[0].exitPrice < stopped.positions[0].stopPrice);
  const again = advance({ previous: stopped, quotes: [quote("09:07:00", "22")], now: at("09:07:00") });
  assert.deepEqual(again.positions[0], stopped.positions[0]);
});
test("late force-close and observation gaps remain unresolved instead of fabricated profits", () => {
  const previous = advance();
  const late = advance({ previous, quotes: [quote("13:30:00")], now: at("13:30:00") });
  assert.equal(late.positions[0].status, "unresolved");
  assert.equal(late.books.atr.netPnl, null);
  const gap = advance({ previous, quotes: [quote("09:15:00")], now: at("09:15:00") });
  assert.equal(gap.positions[0].status, "unresolved");
});
test("force-close uses a quote within the configured real observation window", () => {
  const previous = advance();
  previous.positions[0].lastObservedAt = "2026-11-12T12:59:30+08:00";
  const result = advance({ previous, quotes: [quote("13:00:30")], now: at("13:00:30") });
  assert.equal(result.positions[0].exitType, "forceClose");
  assert.equal(result.positions[0].exitAt, "2026-11-12T13:00:30+08:00");
});
test("short accounting taxes opening sale and records actual buy-back side", () => {
  const p = closePosition({ side: "short", entryPrice: 20, quantity: 1000, verification: verified }, 19, "2026-11-12T10:00:00+08:00", "takeProfit", config);
  assert.equal(p.sellAmount, 20000);
  assert.equal(p.buyAmount, 19000);
  assert.equal(p.tax, 60);
  assert.equal(p.borrowCost, 30);
  assert.equal(p.netPnl, 854.42);
});
test("summary separates versions and includes zero-return completed trades", () => {
  const day = (date, net, count = 1) => ({ version: V2_VERSION, marketDate: date, finalized: true, status: "final", books: { atr: { netPnl: net, closedCount: count, unresolvedCount: 0 }, baseline: { netPnl: net, closedCount: count, unresolvedCount: 0 } } });
  const r = summarizeV2([day("2026-11-12", 0), day("2026-11-13", -100)], 1000);
  assert.equal(r.books.atr.flatDays, 1);
  assert.equal(r.books.atr.maxDrawdownPct, 10);
  assert.ok(Math.abs(r.books.atr.netPct + 10) < 1e-9);
  assert.throws(() => summarizeV2([day("2026-11-12", 0), day("2026-11-12", 0)], 1000), /Duplicate/);
  assert.throws(() => summarizeV2([{ ...day("2026-11-12", 0), version: "old" }], 1000), /mix/);
  assert.equal(summarizeV2([day("2026-11-12", 0, 0)], 1000).books.atr.netPnl, null);
});
test("LINE daily notice is current, finalized, once-only and contains no fabricated gain", async () => {
  const snapshot = { ...advance({ report: null, now: at("13:05:00") }) };
  assert.match(v2DailyMessage(snapshot), /尚無完整成交績效/);
  assert.match(lineRetryKey(snapshot.marketDate, "daily"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  let calls = 0;
  const send = async () => { calls++; return true; };
  const sent = await notifyV2Daily({ snapshot, send, now: at("13:05:00") });
  assert.ok(sent["2026-11-12"]);
  await notifyV2Daily({ snapshot, sent, send, now: at("13:10:00") });
  await notifyV2Daily({ snapshot: { ...snapshot, finalized: false }, send, now: at("13:10:00") });
  await notifyV2Daily({ snapshot, send, now: new Date("2026-11-13T13:05:00+08:00") });
  assert.equal(calls, 1);
  assert.deepEqual(await notifyV2Daily({ snapshot, send: async () => false, now: at("13:05:00") }), {});
});
