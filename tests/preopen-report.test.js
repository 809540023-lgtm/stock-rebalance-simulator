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
