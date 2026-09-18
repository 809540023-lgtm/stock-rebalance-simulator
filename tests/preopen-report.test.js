import test from "node:test";
import assert from "node:assert/strict";
import { buildPreopenReport } from "../market-risk-scanner/scripts/build-preopen-report.js";

const bullish = {
  dataDate: "2026-08-17",
  stale: false,
  candidates: [
    { code: "1111", name: "甲", market: "上市", endPrice: 20, score: 80, tradingEligible: true, reasons: ["轉強"] },
    { code: "2222", name: "乙", market: "上市", endPrice: 21, score: 70, tradingEligible: false, reasons: ["量縮"] }
  ]
};

const bearish = {
  dataDate: "2026-08-16",
  stale: true,
  staleWarning: "空頭資料過期",
  candidates: [
    { code: "3333", name: "丙", market: "上櫃", endPrice: 18, score: 90, tradingEligible: true, predictedChangePct: -2.1, reasons: ["跌破短均"] }
  ]
};

test("buildPreopenReport caps candidates and filters ineligible rows", () => {
  const report = buildPreopenReport({
    bullish,
    bearish,
    now: new Date("2026-08-18T23:00:00Z"),
    config: { maxLongCandidates: 5, maxShortCandidates: 10, maxPrice: 50, minAvgVolume20: 500000, minAvgTurnover20: 10000000 }
  });
  assert.equal(report.timezone, "Asia/Taipei");
  assert.equal(report.intendedRunTime, "07:00");
  assert.equal(report.longCandidates.length, 1);
  assert.equal(report.shortCandidates.length, 1);
  assert.equal(report.longCandidates[0].code, "1111");
  assert.equal(report.shortCandidates[0].action, "watch-short");
});

test("buildPreopenReport warns when snapshots are stale or date-mismatched", () => {
  const report = buildPreopenReport({
    bullish,
    bearish,
    config: { maxLongCandidates: 5, maxShortCandidates: 10, maxPrice: 50, minAvgVolume20: 500000, minAvgTurnover20: 10000000 }
  });
  assert.ok(report.warnings.includes("空頭資料過期"));
  assert.ok(report.warnings.includes("多空候選資料日期不一致"));
});

import { buildStrictPreopenReport } from "../market-risk-scanner/scripts/build-preopen-report.js";

function isoAddDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function makeBars(dataDate, n = 65, start = 20) {
  const bars = [];
  for (let i = 0; i < n; i += 1) {
    const close = Number((start + i * 0.2).toFixed(2));
    bars.push({
      date: isoAddDays(dataDate, -(n - 1 - i)),
      open: Number((close - 0.1).toFixed(2)),
      high: Number((close + 0.2).toFixed(2)),
      low: Number((close - 0.2).toFixed(2)),
      close,
      volume: 600000
    });
  }
  return bars;
}
function makeIndex(dataDate, n = 65) {
  const bars = [];
  for (let i = 0; i < n; i += 1) {
    bars.push({
      date: isoAddDays(dataDate, -(n - 1 - i)),
      open: 43000, high: 43000, low: 43000, close: 43000, volume: 0
    });
  }
  return bars;
}
const alignedBullish = { dataDate: "2026-08-17", stale: false, candidates: [{ code: "1111", name: "甲", market: "上市", endPrice: 30, score: 80, tradingEligible: true, reasons: ["轉強"] }] };
const alignedBearish = { dataDate: "2026-08-17", stale: false, candidates: [{ code: "3333", name: "丙", market: "上市", endPrice: 18, score: 80, tradingEligible: true, reasons: ["走弱"] }] };
const config = { maxLongCandidates: 5, maxShortCandidates: 10, maxPrice: 50, minAvgVolume20: 500000, minAvgTurnover20: 10000000 };

test("buildStrictPreopenReport uses the full engine when OHLCV is aligned", () => {
  const ohlcv = {
    meta: { asOfDate: "2026-08-17" },
    index: makeIndex("2026-08-17"),
    stocks: { "1111|上市": makeBars("2026-08-17") },
    names: { "1111|上市": "甲" }
  };
  const report = buildStrictPreopenReport({ bullish: alignedBullish, bearish: alignedBearish, ohlcv, config, now: new Date("2026-08-18T00:00:00Z") });
  assert.equal(report.modelStatus, "preopen-research-engine-full");
  assert.equal(report.longCandidates.length, 1);
  assert.equal(report.longCandidates[0].code, "1111");
  assert.equal(report.dataDate, "2026-08-17");
});

test("buildStrictPreopenReport falls back to legacy when no OHLCV history exists", () => {
  const report = buildStrictPreopenReport({
    bullish: alignedBullish,
    bearish: alignedBearish,
    ohlcv: null,
    config,
    now: new Date("2026-08-18T00:00:00Z")
  });
  assert.equal(report.modelStatus, "legacy-snapshot-plus-preopen-report");
  assert.equal(report.longCandidates[0].code, "1111");
});

test("buildStrictPreopenReport falls back when the index is not aligned", () => {
  const ohlcv = {
    meta: { asOfDate: "2026-08-17" },
    index: makeIndex("2026-06-30"), // does not reach dataDate
    stocks: { "1111|上市": makeBars("2026-08-17") },
    names: { "1111|上市": "甲" }
  };
  const report = buildStrictPreopenReport({ bullish: alignedBullish, bearish: alignedBearish, ohlcv, config });
  assert.equal(report.modelStatus, "legacy-snapshot-plus-preopen-report");
});
