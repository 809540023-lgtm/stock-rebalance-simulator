import test from "node:test";
import assert from "node:assert/strict";
import { buildMessages, findPositionEvents, targetPriceForGain } from "../scripts/check-paper-trade-alerts.js";

const portfolio = {
  evaluationTradingDate: "2026-08-17",
  alertGainPct: 5,
  positions: [
    { id: "1446-20260812", code: "1446", name: "宏和", buyPrice: 13.95, quantity: 1000, targetPrice: 14.65, status: "holding" },
    { id: "3346-20260812", code: "3346", name: "麗清", buyPrice: 21.2, quantity: 1000, targetPrice: 22.3, status: "holding" }
  ]
};

test("rounds 5% targets up to a valid Taiwan tick", () => {
  assert.equal(targetPriceForGain(13.95, 5), 14.65);
  assert.equal(targetPriceForGain(21.2, 5), 22.3);
});

test("detects an intraday 5% target once the high reaches it", () => {
  const quotes = [
    { c: "1446", "^": "20260812", z: "14.60", h: "14.65" },
    { c: "3346", "^": "20260812", z: "22.25", h: "22.25" }
  ];
  const events = findPositionEvents(quotes, portfolio, "2026-08-12");
  assert.equal(events.length, 1);
  assert.equal(events[0].code, "1446");
  assert.equal(events[0].type, "target");
});

test("creates a third-trading-day evaluation event and LINE message", () => {
  const events = findPositionEvents([{ c: "3346", "^": "20260817", z: "21.80", h: "22.00", t: "13:25:00" }], portfolio, "2026-08-17");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "evaluation");
  const messages = buildMessages(events, { date: "2026-08-17", hour: "13", minute: "25" });
  assert.match(messages[0].text, /三個交易日接近收盤投報率/);
  assert.match(messages[0].text, /3346 麗清/);
});
