import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPreopenFeatures,
  netTradeReturn,
  preopenEligibility,
  rankPreopenCandidates,
  roundToTaiwanTick,
  scoreLongReversal,
  scoreShortContinuation,
  simulateNextOpenPlan,
  taipeiPreopenContext
} from "../market-risk-scanner/scripts/preopen-research.js";

function bar(date, close, extra = {}) {
  return {
    date,
    open: extra.open ?? close,
    high: extra.high ?? close + 0.2,
    low: extra.low ?? close - 0.2,
    close,
    volume: extra.volume ?? 800000
  };
}

function dates(count, start = "2026-05-01") {
  const cursor = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, () => {
    const out = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return out;
  });
}

function stockSeries(code, closes, overrides = {}) {
  const ds = dates(closes.length);
  return {
    code,
    name: `測試${code}`,
    market: "上市",
    commonStock: true,
    adjustmentVerified: true,
    dayTradeAllowed: true,
    sellFirstAllowed: true,
    marginShortAllowed: true,
    ...overrides,
    bars: closes.map((close, index) => bar(ds[index], close, { volume: overrides.volume ?? 900000 }))
  };
}

test("Taipei pre-open context finds the previous official session", () => {
  const context = taipeiPreopenContext("2026-08-17", ["2026-08-14", "2026-08-17"]);
  assert.equal(context.marketOpen, true);
  assert.equal(context.previousSession, "2026-08-14");
  assert.equal(context.cutoff, "2026-08-17T07:00:00+08:00");
});

test("Taiwan tick rounding follows exchange price bands", () => {
  assert.equal(roundToTaiwanTick(49.98, "up"), 50);
  assert.equal(roundToTaiwanTick(103.24, "down"), 103);
  assert.equal(roundToTaiwanTick(1002, "nearest"), 1000);
});

test("feature building rejects stale or misaligned index data", () => {
  const closes = Array.from({ length: 61 }, (_, i) => 20 + i * 0.01);
  const stock = stockSeries("1234", closes);
  const indexBars = stock.bars.slice(0, -1).map((item) => ({ date: item.date, close: 10000 }));
  assert.throws(() => buildPreopenFeatures(stock, indexBars, stock.bars.at(-1).date), /aligned/);
});

test("eligibility blocks disposition and unverified adjustment data", () => {
  const closes = Array.from({ length: 61 }, (_, i) => 20 + i * 0.01);
  const stock = stockSeries("1234", closes, { adjustmentVerified: false, disposition: true });
  const indexBars = stock.bars.map((item) => ({ date: item.date, close: 10000 + Number(item.close) }));
  const features = buildPreopenFeatures(stock, indexBars, stock.bars.at(-1).date);
  const eligibility = preopenEligibility(features, "long", "intraday");
  assert.equal(eligibility.passed, false);
  assert.ok(eligibility.reasons.includes("處置股"));
  assert.ok(eligibility.reasons.includes("價格未確認除權息調整"));
});

test("long and short scores are separate directional models", () => {
  const risingAfterDip = [
    ...Array.from({ length: 41 }, (_, i) => 32 - i * 0.2),
    ...Array.from({ length: 20 }, (_, i) => 24 + i * 0.25)
  ];
  const falling = [
    ...Array.from({ length: 41 }, (_, i) => 35 - i * 0.05),
    ...Array.from({ length: 20 }, (_, i) => 33 - i * 0.35)
  ];
  const indexCloses = Array.from({ length: 61 }, (_, i) => 10000 + i);
  const longStock = stockSeries("1111", risingAfterDip);
  const shortStock = stockSeries("2222", falling);
  const longFeatures = buildPreopenFeatures(longStock, longStock.bars.map((b, i) => ({ date: b.date, close: indexCloses[i] })), longStock.bars.at(-1).date);
  const shortFeatures = buildPreopenFeatures(shortStock, shortStock.bars.map((b, i) => ({ date: b.date, close: indexCloses[i] })), shortStock.bars.at(-1).date);
  assert.ok(scoreLongReversal(longFeatures).score > scoreShortContinuation(longFeatures).score);
  assert.ok(scoreShortContinuation(shortFeatures).score > scoreLongReversal(shortFeatures).score);
});

test("netTradeReturn includes minimum commission and stock tax", () => {
  const result = netTradeReturn({ side: "long", entryPrice: 20, exitPrice: 21, shares: 1000 });
  assert.equal(result.gross, 1000);
  assert.equal(result.commission, 58.42);
  assert.equal(result.tax, 63);
  assert.equal(result.net, 878.58);
});

test("short net return taxes the opening sell side", () => {
  const result = netTradeReturn({ side: "short", entryPrice: 20, exitPrice: 19, shares: 1000 });
  assert.equal(result.gross, 1000);
  assert.equal(result.tax, 60);
  assert.equal(result.net, 884.42);
});

test("next-open plan uses next open and treats same-bar stop before target", () => {
  const plan = simulateNextOpenPlan(
    { side: "long", asOfDate: "2026-08-01" },
    [
      { date: "2026-08-02", open: 100, high: 106, low: 96, close: 104, volume: 1000000 }
    ]
  );
  assert.equal(plan.filled, true);
  assert.equal(plan.entryPrice, 100.5);
  assert.equal(plan.exitReason, "stop");
  assert.equal(plan.exitPrice, 97.4);
});

test("locked limit day is reported as unfilled", () => {
  const plan = simulateNextOpenPlan(
    { side: "short", asOfDate: "2026-08-01" },
    [{ date: "2026-08-02", open: 20, high: 20, low: 20, close: 20, volume: 0 }]
  );
  assert.equal(plan.filled, false);
  assert.equal(plan.reason, "locked-limit");
});

test("candidate ranking returns capped long and short lists", () => {
  const longCloses = [
    ...Array.from({ length: 41 }, (_, i) => 30 - i * 0.1),
    ...Array.from({ length: 20 }, (_, i) => 26 + i * 0.2)
  ];
  const shortCloses = [
    ...Array.from({ length: 41 }, (_, i) => 32 - i * 0.02),
    ...Array.from({ length: 20 }, (_, i) => 31 - i * 0.25)
  ];
  const stocks = [
    stockSeries("1111", longCloses),
    stockSeries("2222", shortCloses)
  ];
  const indexBars = stocks[0].bars.map((b, i) => ({ date: b.date, close: 10000 + i * 2 }));
  const result = rankPreopenCandidates(stocks, indexBars, stocks[0].bars.at(-1).date, {
    maxLongCandidates: 5,
    maxShortCandidates: 10,
    minBars: 61,
    minPrice: 5,
    maxPrice: 50,
    minAvgVolume20: 100000,
    minAvgTurnover20: 1000000,
    maxAbsDailyReturnPct: 7,
    longTargetPct: 5,
    longStopPct: 3,
    shortTargetPct: 5,
    shortStopPct: 3,
    commissionRate: 0.001425,
    minCommission: 20,
    stockTaxRate: 0.003,
    dayTradeTaxRate: 0.0015,
    slippageBps: 5,
    timezone: "Asia/Taipei",
    cutoffHour: 7
  });
  assert.equal(result.long.length, 1);
  assert.equal(result.short.length, 1);
  assert.equal(result.long[0].side, "long");
  assert.equal(result.short[0].side, "short");
});
