import test from "node:test";
import assert from "node:assert/strict";
import { computeBullishScore, computeBearishScore, applyFilters, staleness, DEFAULT_CONFIG } from "../market-risk-scanner/scripts/models.js";

function seriesFromCloses(closes, volume = 1000000) {
  return closes.map((close, index) => ({ date: `2026-08-${String(index + 1).padStart(2, "0")}`, close, volume }));
}

// A recovering series: falls, then makes a higher low and climbs above its MAs.
const bullishCloses = [100, 98, 95, 92, 90, 91, 93, 95, 97, 99, 101, 103, 105, 107, 109];
// A falling series: makes lower lows and stays below its MAs.
const bearishCloses = [120, 118, 115, 112, 110, 108, 105, 103, 100, 98, 95, 93, 90, 88, 86];
const indexCloses = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];

test("bullish model scores a recovering series as passed", () => {
  const result = computeBullishScore(seriesFromCloses(bullishCloses), indexCloses, { pe: 15, dividendYield: 3, pb: 1.5 });
  assert.equal(result.passed, true);
  assert.ok(result.score >= 60, `expected score >= 60, got ${result.score}`);
  assert.ok(result.reasons.includes("低點墊高"));
  assert.ok(result.reasons.includes("短均線轉多"));
});

test("bullish model rejects a falling series", () => {
  const result = computeBullishScore(seriesFromCloses(bearishCloses), indexCloses, { pe: 15, dividendYield: 3, pb: 1.5 });
  assert.equal(result.passed, false);
  assert.ok(result.score < 60);
});

test("bearish model scores a falling series as passed", () => {
  const result = computeBearishScore(seriesFromCloses(bearishCloses), indexCloses, { pe: 15, dividendYield: 3, pb: 1.5 });
  assert.equal(result.passed, true);
  assert.ok(result.score >= 60, `expected score >= 60, got ${result.score}`);
  assert.ok(result.reasons.includes("跌破短均線"));
  assert.ok(result.reasons.includes("低點下移"));
});

test("bearish model rejects a recovering series", () => {
  const result = computeBearishScore(seriesFromCloses(bullishCloses), indexCloses, { pe: 15, dividendYield: 3, pb: 1.5 });
  assert.equal(result.passed, false);
  assert.ok(result.score < 60);
});

test("insufficient data returns a zero score", () => {
  const result = computeBullishScore(seriesFromCloses([100, 101, 102]), indexCloses, null);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("資料不足"));
});

test("applyFilters rejects a disposition stock", () => {
  const stock = { code: "1234", endPrice: 50, avgVolume: 2000000, ma10: 48, tradingDays: 20 };
  const result = applyFilters(stock, new Set(["1234"]));
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("處置股"));
});

test("applyFilters rejects low liquidity", () => {
  const stock = { code: "1234", endPrice: 50, avgVolume: 1000, ma10: 48, tradingDays: 20 };
  const result = applyFilters(stock, new Set());
  assert.ok(result.reasons.some((reason) => reason.includes("日均量不足")));
});

test("applyFilters rejects a stock that already ran up too far", () => {
  const stock = { code: "1234", endPrice: 100, avgVolume: 2000000, ma10: 50, tradingDays: 20 };
  const result = applyFilters(stock, new Set());
  assert.ok(result.reasons.some((reason) => reason.includes("追價")));
});

test("applyFilters passes a clean liquid stock", () => {
  const stock = { code: "1234", endPrice: 50, avgVolume: 2000000, ma10: 48, tradingDays: 20 };
  const result = applyFilters(stock, new Set());
  assert.equal(result.passed, true);
  assert.equal(result.tradingEligible, true);
});

test("default price ceiling excludes stocks above 50", () => {
  assert.equal(DEFAULT_CONFIG.maxPrice, 50);
  const stock = { code: "1234", endPrice: 51, avgVolume: 2000000, ma10: 48, tradingDays: 20 };
  const result = applyFilters(stock, new Set());
  assert.ok(result.reasons.some((reason) => reason.includes("價格超過上限 50")));
});

test("tradingEligible is false for a disposition stock", () => {
  const stock = { code: "1234", endPrice: 50, avgVolume: 2000000, ma10: 48, tradingDays: 20 };
  const result = applyFilters(stock, new Set(["1234"]));
  assert.equal(result.tradingEligible, false);
});

test("staleness flags data older than the threshold", () => {
  const result = staleness("2026-08-10", "2026-08-18T00:00:00Z");
  assert.equal(result.stale, true);
  assert.match(result.warning, /已超過/);
});

test("staleness keeps fresh data unmarked", () => {
  const result = staleness("2026-08-17", "2026-08-18T00:00:00Z");
  assert.equal(result.stale, false);
  assert.equal(result.warning, null);
});
