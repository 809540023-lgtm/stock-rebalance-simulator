import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateFiles, mergeHistory, DEFAULT_MAX_CANDIDATES } from "../market-risk-scanner/scripts/save-shared-candidates.js";

const marketData = {
  generatedAt: "2026-08-18T04:00:00Z",
  range: { start: "2026-08-10", end: "2026-08-17" },
  candidates: {
    bullish: [
      { market: "上市", code: "1515", name: "力山", endPrice: 34.25, bullishScore: 100, reasons: ["低點墊高"], tradingEligible: true },
      { market: "上市", code: "0001", name: "測試", endPrice: 60, bullishScore: 90, reasons: ["站上短均線"], tradingEligible: false }
    ],
    bearish: [
      { market: "上櫃", code: "6001", name: "弱股", endPrice: 20, bearishScore: 80, reasons: ["跌破短均線"], tradingEligible: true }
    ]
  }
};

test("buildCandidateFiles produces latest snapshots with staleness info", () => {
  const files = buildCandidateFiles(marketData, { staleAfterDays: 1 });
  assert.equal(files.bullish.count, 2);
  assert.equal(files.bearish.count, 1);
  assert.equal(files.bullish.dataDate, "2026-08-17");
  assert.equal(files.bullish.stale, false);
  assert.equal(files.bullish.candidates[0].score, 100);
  assert.equal(files.bullish.candidates[0].reasons.join(","), "低點墊高");
  assert.equal(files.bullish.candidates[0].tradingEligible, true);
  // sorted by score descending
  assert.ok(files.bullish.candidates[0].score >= files.bullish.candidates[1].score);
});

test("mergeHistory keeps the first record per date and never overwrites", () => {
  const existing = { records: [{ date: "2026-08-17", count: 2, candidates: [{ code: "1515" }] }] };
  const merged = mergeHistory(existing, { date: "2026-08-17", count: 5, candidates: [{ code: "9999" }] });
  assert.equal(merged.records.length, 1);
  assert.equal(merged.records[0].count, 2);
  assert.equal(merged.records[0].candidates[0].code, "1515");
});

test("buildCandidateFiles limits candidates to the configured maximum", () => {
  const many = { ...marketData, candidates: { bullish: Array.from({ length: 80 }, (_, i) => ({ market: "上市", code: String(1000 + i), name: "股", endPrice: 30, bullishScore: 100 - i, reasons: ["低點墊高"], tradingEligible: true })), bearish: [] } };
  const files = buildCandidateFiles(many, { maxCandidates: 50 });
  assert.equal(files.bullish.count, 50);
  assert.equal(files.bullish.candidates.length, 50);
  assert.equal(DEFAULT_MAX_CANDIDATES, 50);
});

test("mergeHistory appends a new data date", () => {
  const existing = { records: [{ date: "2026-08-17", count: 2, candidates: [] }] };
  const merged = mergeHistory(existing, { date: "2026-08-18", count: 3, candidates: [] });
  assert.equal(merged.records.length, 2);
  assert.equal(merged.records.at(-1).date, "2026-08-18");
});
