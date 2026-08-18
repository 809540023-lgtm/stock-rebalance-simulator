import test from "node:test";
import assert from "node:assert/strict";
import { predictNextPrice, predictDirection, predictChangePct } from "../market-risk-scanner/scripts/price-prediction.js";

test("predictNextPrice predicts above the last close for an uptrend", () => {
  const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const predicted = predictNextPrice(closes, 5);
  assert.ok(predicted > closes.at(-1));
});

test("predictNextPrice predicts below the last close for a downtrend", () => {
  const closes = [19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
  const predicted = predictNextPrice(closes, 5);
  assert.ok(predicted < closes.at(-1));
});

test("predictDirection returns 1 for uptrend and -1 for downtrend", () => {
  assert.equal(predictDirection([10, 11, 12, 13, 14], 5), 1);
  assert.equal(predictDirection([14, 13, 12, 11, 10], 5), -1);
});

test("predictNextPrice returns null for too few points", () => {
  assert.equal(predictNextPrice([10, 11], 5), null);
});

test("predictChangePct is positive for an uptrend", () => {
  const pct = predictChangePct([10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 5);
  assert.ok(pct > 0);
});
