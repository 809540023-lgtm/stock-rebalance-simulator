import test from "node:test";
import assert from "node:assert/strict";
import { buildMessages, findMarketEvents } from "../scripts/check-line-limit-up.js";

const today = "2026-08-10";
const base = { "^": "20260810", y: "100", u: "110", w: "90", h: "101", l: "99", z: "100" };

test("detects limit-up, limit-down, and configured decline events", () => {
  const quotes = [
    { ...base, c: "3149", n: "正達", z: "110", h: "110" },
    { ...base, c: "8021", n: "尖點", z: "90", l: "90" },
    { ...base, c: "4919", n: "新唐", z: "96.9", l: "96.8" },
    { ...base, c: "8996", n: "高力", z: "98", l: "97.5" }
  ];
  const events = findMarketEvents(quotes, today, new Map(), {
    declineAlertPct: 3,
    notifyOn: new Set(["limit-up", "limit-down", "decline"])
  });

  assert.deepEqual(events.map((event) => [event.code, event.type]), [
    ["3149", "limit-up"],
    ["8021", "limit-down"],
    ["4919", "decline"]
  ]);
  assert.equal(events.filter((event) => event.code === "8021").length, 1);
});

test("ignores stale quotes and formats LINE alerts", () => {
  const stale = findMarketEvents([{ ...base, c: "3149", "^": "20260809", z: "110", h: "110" }], today);
  assert.equal(stale.length, 0);

  const events = findMarketEvents([{ ...base, c: "4919", n: "新唐", z: "96.5", l: "96.5" }], today);
  const messages = buildMessages(events, { date: today, hour: "10", minute: "05" });
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /4919 新唐｜跌幅警示/);
  assert.match(messages[0].text, /當日漲跌：-3\.50%/);
});
