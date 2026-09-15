import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, buildSummaryText, priceTick } from "../scripts/simulate-preopen-candidates.js";

const report = {
  dataDate: "2026-09-15",
  longCandidates: [
    { rank: 1, code: "3380", name: "明泰", close: 29.95, side: "long" },
    { rank: 2, code: "3591", name: "艾笛森", close: 23.65, side: "long" }
  ],
  shortCandidates: [
    { rank: 1, code: "2367", name: "燿華", close: 39.9, side: "short" }
  ]
};

function quote(code, { z, h, l, t = "10:00:00" }) {
  return { c: code, "^": "20260915", t, z: String(z), h: String(h), l: String(l) };
}

// Mid-session, before 13:00 force-close.
const mid = { date: "2026-09-15", time: "10:05:00", minutes: 10 * 60 + 5 };

test("priceTick follows Taiwan tick sizes", () => {
  assert.equal(priceTick(9.5), 0.01);
  assert.equal(priceTick(25), 0.05);
  assert.equal(priceTick(75), 0.1);
  assert.equal(priceTick(300), 0.5);
});

test("long candidate takes profit at +6% when the day high reaches the target", () => {
  const quotes = [
    quote("3380", { z: 29.8, h: 31.8, l: 29.5 }), // high 31.8 >= 29.95*1.06=31.75
    quote("3591", { z: 23.5, h: 23.7, l: 23.4 }),
    quote("2367", { z: 40.5, h: 40.8, l: 40.0 })
  ];
  const snap = buildSnapshot(quotes, report, mid);
  const p = snap.positions.find((x) => x.code === "3380");
  assert.equal(p.exitType, "takeProfit");
});

test("long candidate stops out at -4% when the day low breaches it", () => {
  const quotes = [
    quote("3380", { z: 29.5, h: 29.9, l: 28.5 }), // low 28.5 <= 29.95*0.96=28.75
    quote("3591", { z: 23.5, h: 23.7, l: 23.4 }),
    quote("2367", { z: 40.5, h: 40.8, l: 40.0 })
  ];
  const snap = buildSnapshot(quotes, report, mid);
  const p = snap.positions.find((x) => x.code === "3380");
  assert.equal(p.exitType, "stopLoss");
});

test("short candidate takes profit when the low falls 6% below basis", () => {
  const quotes = [
    quote("3380", { z: 30.0, h: 30.2, l: 29.8 }),
    quote("3591", { z: 23.5, h: 23.7, l: 23.4 }),
    quote("2367", { z: 39.0, h: 40.0, l: 37.3 }) // low 37.3 <= 39.9*0.94=37.51
  ];
  const snap = buildSnapshot(quotes, report, mid);
  const p = snap.positions.find((x) => x.code === "2367");
  assert.equal(p.exitType, "takeProfit");
});

test("positions are forced closed after 13:00", () => {
  const late = { date: "2026-09-15", time: "13:05:00", minutes: 13 * 60 + 5 };
  const quotes = [
    quote("3380", { z: 29.9, h: 30.0, l: 29.8 }),
    quote("3591", { z: 23.5, h: 23.7, l: 23.4 }),
    quote("2367", { z: 40.5, h: 40.8, l: 40.0 })
  ];
  const snap = buildSnapshot(quotes, report, late);
  for (const p of snap.positions) assert.equal(p.exitType, "forceClose");
  assert.equal(snap.exitCount.forceClose, 3);
});

test("buildSummaryText embeds the strategy line and exit labels", () => {
  const snap = buildSnapshot(
    [quote("3380", { z: 29.8, h: 31.8, l: 29.5 }), quote("3591", { z: 23.5, h: 23.7, l: 23.4 }), quote("2367", { z: 40.5, h: 40.8, l: 40.0 })],
    report,
    mid
  );
  const text = buildSummaryText(snap, mid);
  assert.match(text, /\+6%停利/);
  assert.match(text, /-4%停損/);
  assert.match(text, /🟢停利/);
});
