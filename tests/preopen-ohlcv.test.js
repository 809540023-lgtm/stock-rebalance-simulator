import test from "node:test";
import assert from "node:assert/strict";
import {
  rocDateToIso,
  isoToRocDate,
  parseTwseStockDayMonth,
  parseTpexOpenapiDay,
  parseTaiexMonth,
  mergeBars,
  listMonthsEndingAt,
  monthsNotPresent,
  readCandidateUniverse
} from "../market-risk-scanner/scripts/persist-ohlcv-history.js";

const twsePayload = {
  data: [
    ["115/08/03", "3,200,963", "66,947,712", "20.60", "21.10", "20.60", "20.90", "+0.15", "1,062", ""],
    ["115/08/04", "4,318,091", "89,014,807", "20.70", "21.10", "20.35", "20.45", "-0.45", "1,957", ""],
    ["115/08/05", "930,152", "19,101,891", "20.55", "20.65", "20.40", "20.65", "+0.20", "511", ""]
  ]
};

test("rocDateToIso and isoToRocDate round-trip", () => {
  assert.equal(rocDateToIso("115/08/03"), "2026-08-03");
  assert.equal(rocDateToIso("1150918"), "2026-09-18");
  assert.equal(isoToRocDate("2026-08-03"), "115/08/03");
  assert.throws(() => rocDateToIso("not-a-date"));
});

test("parseTwseStockDayMonth extracts OHLCV bars", () => {
  const bars = parseTwseStockDayMonth(twsePayload);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars[0], { date: "2026-08-03", open: 20.6, high: 21.1, low: 20.6, close: 20.9, volume: 3200963 });
  assert.deepEqual(bars[1].close, 20.45);
});

test("parseTwseStockDayMonth rejects invalid OHLC", () => {
  const bad = { data: [["115/08/03", "0", "0", "20", "5", "25", "20", "0", "0", ""]] };
  assert.equal(parseTwseStockDayMonth(bad).length, 0);
});

test("parseTpexOpenapiDay extracts OHLCV and skips non-stock rows", () => {
  const day = [
    { Date: "1150918", SecuritiesCompanyCode: "3227", Open: "184.00", High: "186.00", Low: "182.50", Close: "186.00", TradingShares: "646205" },
    { Date: "1150918", SecuritiesCompanyCode: "00411A", Open: "9.99", High: "10.15", Low: "9.99", Close: "10.13", TradingShares: "90136009" }
  ];
  const out = parseTpexOpenapiDay(day);
  assert.ok(out["3227"]);
  assert.equal(out["3227"].date, "2026-09-18");
  assert.equal(out["3227"].high, 186.0);
  assert.ok(!out["00411A"]);
});

test("parseTaiexMonth converts index bars", () => {
  const payload = { data: [["115/08/03", "42,780.42", "43,784.19", "42,780.42", "43,386.41"]] };
  const bars = parseTaiexMonth(payload);
  assert.equal(bars[0].date, "2026-08-03");
  assert.equal(bars[0].high, 43784.19);
});

test("mergeBars dedupes by date and sorts", () => {
  const merged = mergeBars(
    [{ date: "2026-08-04", open: 1, high: 2, low: 1, close: 1.5, volume: 100 }],
    [{ date: "2026-08-03", open: 1, high: 2, low: 1, close: 1.4, volume: 90 },
      { date: "2026-08-04", open: 2, high: 3, low: 1, close: 2.5, volume: 110 }]
  );
  assert.deepEqual(merged.map((b) => b.date), ["2026-08-03", "2026-08-04"]);
  assert.equal(merged[1].close, 2.5); // later incoming wins
});

test("listMonthsEndingAt includes the ending month and rolls back years", () => {
  assert.deepEqual(listMonthsEndingAt("2026-03-10", 4), ["2026-03", "2026-02", "2026-01", "2025-12"]);
});

test("monthsNotPresent reports only months still missing bars", () => {
  const existing = [
    { date: "2026-07-03", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { date: "2026-08-03", open: 1, high: 1, low: 1, close: 1, volume: 1 }
  ];
  assert.deepEqual(monthsNotPresent(existing, ["2026-09", "2026-08", "2026-07", "2026-06"]), ["2026-09", "2026-06"]);
});

test("readCandidateUniverse dedupes and caps by market", () => {
  const bullish = { candidates: [
    { code: "1111", market: "上市" },
    { code: "2222", market: "上市" },
    { code: "3333", market: "上櫃" },
    { code: "bad1", market: "上市" }
  ] };
  const bearish = { candidates: [{ code: "1111", market: "上市" }, { code: "4444", market: "上櫃" }] };
  const universe = readCandidateUniverse(bullish, bearish, 10);
  assert.deepEqual(universe.map((s) => s.code), ["1111", "2222", "3333", "4444"]);
});
