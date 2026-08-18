import test from "node:test";
import assert from "node:assert/strict";
import { computeIC, quantileReturns, quantileSpread } from "../market-risk-scanner/scripts/factor-analysis.js";

test("computeIC is ~+1 for a perfect positive rank relationship", () => {
  const result = computeIC([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
  assert.ok(Math.abs(result.ic - 1) < 0.001);
  assert.equal(result.sampleSize, 5);
});

test("computeIC is ~-1 for a perfect negative rank relationship", () => {
  const result = computeIC([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]);
  assert.ok(Math.abs(result.ic + 1) < 0.001);
});

test("computeIC returns null for too few points", () => {
  const result = computeIC([1, 2], [3, 4]);
  assert.equal(result.ic, null);
});

test("quantileReturns orders buckets by factor and top beats bottom when predictive", () => {
  // Higher factor => higher forward return.
  const factors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const returns = factors.map((f) => f * 1);
  const quantiles = quantileReturns(factors, returns, 5);
  assert.equal(quantiles.length, 5);
  assert.equal(quantiles[0].quantile, 1);
  assert.equal(quantiles.at(-1).quantile, 5);
  assert.ok(quantiles.at(-1).avgReturn > quantiles[0].avgReturn);
  assert.ok(quantileSpread(quantiles) > 0);
});

test("quantileReturns returns empty when below bucket count", () => {
  assert.equal(quantileReturns([1, 2], [1, 2], 5).length, 0);
});
