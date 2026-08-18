import test from "node:test";
import assert from "node:assert/strict";
import { buildTradeRecord, summarizeTrades, compareToBaseline, FEE_RATE } from "../market-risk-scanner/scripts/evaluation.js";

function bars(closes, highs = null, lows = null) {
  return closes.map((close, index) => ({ date: `2026-08-${String(index + 1).padStart(2, "0")}`, close, high: highs?.[index] ?? close, low: lows?.[index] ?? close }));
}

const signal = { signalDate: "2026-08-01", model: "bullish", code: "1234", name: "測試", market: "上市", entryPrice: 100 };

test("bullish trade exits at target when the high reaches it", () => {
  const forward = bars([101, 102, 103, 104, 105, 106], [101, 102, 103, 104, 105, 106]);
  const trade = buildTradeRecord(signal, forward);
  assert.equal(trade.exitReason, "target");
  assert.equal(trade.exitPrice, 105);
  assert.equal(trade.grossReturn, 5);
  assert.equal(trade.netReturn, Number((5 - FEE_RATE * 100).toFixed(2)));
  assert.equal(trade.forward3d.returnPct, 3);
  assert.equal(trade.forward5d.returnPct, 5);
});

test("bullish trade exits at stop when the low breaks it", () => {
  const forward = bars([99, 98, 97, 96, 95, 94], [99, 98, 97, 96, 95, 94], [99, 98, 97, 96, 95, 94]);
  const trade = buildTradeRecord(signal, forward);
  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 95);
  assert.equal(trade.grossReturn, -5);
});

test("bullish trade exits at the last close when neither target nor stop is hit", () => {
  const forward = bars([100, 100, 100, 100, 100, 100]);
  const trade = buildTradeRecord(signal, forward);
  assert.equal(trade.exitReason, "time");
  assert.equal(trade.exitPrice, 100);
  assert.equal(trade.grossReturn, 0);
});

test("bearish trade profits when the price falls to target", () => {
  const bearishSignal = { ...signal, model: "bearish" };
  const forward = bars([99, 98, 97, 96, 95, 94], [99, 98, 97, 96, 95, 94], [99, 98, 97, 96, 95, 94]);
  const trade = buildTradeRecord(bearishSignal, forward);
  assert.equal(trade.exitReason, "target");
  assert.equal(trade.exitPrice, 95);
  assert.equal(trade.grossReturn, 5);
});

test("trade records MFE and MAE from forward highs and lows", () => {
  const forward = bars([101, 99, 102, 98, 103, 97], [101, 99, 102, 98, 103, 97], [100, 99, 100, 98, 100, 97]);
  const trade = buildTradeRecord(signal, forward);
  assert.equal(trade.mfe, 3);
  assert.equal(trade.mae, 3);
});

test("summarizeTrades computes win rate, profit factor, and max drawdown", () => {
  const trades = [
    { netReturn: 5 }, { netReturn: 3 }, { netReturn: -2 }, { netReturn: 4 }, { netReturn: -1 }
  ];
  const summary = summarizeTrades(trades);
  assert.equal(summary.sampleSize, 5);
  assert.equal(summary.winRate, 60);
  assert.equal(summary.avgNetReturn, Number(((5 + 3 - 2 + 4 - 1) / 5).toFixed(2)));
  assert.equal(summary.profitFactor, Number(((5 + 3 + 4) / (2 + 1)).toFixed(2)));
  assert.ok(summary.maxDrawdown >= 0);
});

test("summarizeTrades returns zeros for an empty sample", () => {
  const summary = summarizeTrades([]);
  assert.equal(summary.sampleSize, 0);
  assert.equal(summary.winRate, 0);
  assert.equal(summary.profitFactor, 0);
});

test("compareToBaseline reports the model edge over index and baseline", () => {
  const comparison = compareToBaseline({ avgNetReturn: 2 }, { avgNetReturn: 0.5 }, { avgNetReturn: 0.2 });
  assert.equal(comparison.edgeVsIndex, 1.5);
  assert.equal(comparison.edgeVsBaseline, 1.8);
});
