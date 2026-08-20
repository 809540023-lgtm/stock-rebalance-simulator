import test from "node:test";
import assert from "node:assert/strict";
import { rsi, macd, kdj, bollinger } from "../market-risk-scanner/scripts/technical-indicators.js";

test("RSI is high after a strong uptrend and low after a downtrend", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const down = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
  assert.ok(rsi(up).at(-1) > 70);
  assert.ok(rsi(down).at(-1) < 30);
});

test("RSI stays within 0-100", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
  rsi(closes).filter((v) => v != null).forEach((v) => assert.ok(v >= 0 && v <= 100));
});

test("MACD histogram is positive for an uptrend", () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i * 1.5);
  const m = macd(up);
  assert.ok(m.hist.at(-1) > 0);
});

test("Bollinger upper band is above lower band", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 8);
  const b = bollinger(closes);
  const i = b.upper.length - 1;
  assert.ok(b.upper[i] > b.middle[i]);
  assert.ok(b.middle[i] > b.lower[i]);
});

test("KDJ values stay within a reasonable 0-100 range", () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 6);
  const highs = closes.map((v) => v + 1);
  const lows = closes.map((v) => v - 1);
  const { k, d } = kdj(highs, lows, closes);
  assert.ok(k.at(-1) >= 0 && k.at(-1) <= 100);
  assert.ok(d.at(-1) >= 0 && d.at(-1) <= 100);
});
