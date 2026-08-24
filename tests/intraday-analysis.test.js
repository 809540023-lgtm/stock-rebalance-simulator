import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTwseShortEligibility,
  priceTick,
  roundToTick
} from "../market-risk-scanner/scripts/analyze-intraday-market.js";

test("roundToTick creates valid Taiwan stock prices", () => {
  assert.equal(priceTick(8.41), 0.01);
  assert.equal(priceTick(19.05), 0.05);
  assert.equal(roundToTick(19.05 * 1.01, "up"), 19.25);
  assert.equal(roundToTick(19.05 * 0.97, "down"), 18.45);
});

test("TWSE margin restrictions exclude stopped or zero-limit shorts", () => {
  const fields = [
    "代號", "名稱", "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額",
    "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額", "資券互抵", "註記"
  ];
  const row = (code, limit, note) => [code, code, "0", "0", "0", "0", "0", "1", "0", "0", "0", "0", "0", limit, "0", note];
  const result = parseTwseShortEligibility({ tables: [{ fields, data: [
    row("3011", "29,293", " "),
    row("3576", "0", "OX "),
    row("9999", "0", " ")
  ] }] });

  assert.equal(result.get("3011").allowed, true);
  assert.equal(result.get("3011").nextDayLimit, 29293);
  assert.equal(result.get("3576").allowed, false);
  assert.equal(result.get("9999").allowed, false);
});
