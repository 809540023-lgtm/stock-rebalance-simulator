import test from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyReport, buildSummaryText } from "../scripts/weekly-strategy-summary.js";

const sample = (overrides = {}) => ({
  marketDate: "2026-09-15",
  netPnl: 1000,
  netPct: 3,
  grossPnl: 1500,
  fees: 500,
  investedCapital: 100000,
  exitCount: { takeProfit: 1, stopLoss: 0, forceClose: 0, holding: 0 },
  ...overrides
});

test("buildWeeklyReport aggregates a single profitable day", () => {
  const r = buildWeeklyReport([sample()]);
  assert.equal(r.window.days, 1);
  assert.equal(r.metrics.cumulativeNetPnl, 1000);
  assert.equal(r.metrics.winRate, 100);
  assert.equal(r.metrics.winDays, 1);
  assert.equal(r.metrics.lossDays, 0);
  assert.equal(r.metrics.maxDrawdown, 0);
});

test("buildWeeklyReport sorts by date and mixes win/loss days", () => {
  const records = [
    sample({ marketDate: "2026-09-17", netPnl: -300, exitCount: { stopLoss: 1 } }),
    sample({ marketDate: "2026-09-15", netPnl: 500 }),
    sample({ marketDate: "2026-09-16", netPnl: 200 })
  ];
  const r = buildWeeklyReport(records);
  assert.equal(r.window.start, "2026-09-15");
  assert.equal(r.window.end, "2026-09-17");
  assert.equal(r.window.days, 3);
  assert.equal(r.metrics.cumulativeNetPnl, 400);
  assert.equal(r.metrics.winRate, 2 / 3 * 100);
  assert.equal(r.metrics.lossDays, 1);
  assert.equal(r.metrics.maxDrawdown, 300); // peak 700, trough 400
  assert.equal(r.exitCount.stopLoss, 1);
});

test("maxDrawdown tracks peak-to-trough on cumulative curve", () => {
  const records = [
    sample({ date: "1", netPnl: 1000 }),
    sample({ netPnl: -500 }),
    sample({ netPnl: 800 })
  ].map((r, i) => ({ ...r, marketDate: String(i + 1) }));
  const r = buildWeeklyReport(records);
  // cumulative: 1000 -> 500 -> 1300 ; peak 1000, drawdown 1000-500=500 (then new peak 1300)
  assert.equal(r.metrics.maxDrawdown, 500);
});

test("buildWeeklyReport ignores records without a valid netPnl", () => {
  const records = [sample(), { marketDate: "2026-09-16", netPnl: null }];
  const r = buildWeeklyReport(records);
  assert.equal(r.window.days, 1);
});

test("buildSummaryText renders cumulative profit and win rate in Chinese", () => {
  const r = buildWeeklyReport([sample({ netPnl: 1000 })]);
  const text = buildSummaryText(r);
  assert.match(text, /開盤前候選策略/);
  assert.match(text, /累計淨損益/);
  assert.match(text, /勝率/);
});
