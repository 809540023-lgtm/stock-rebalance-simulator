import { createHash } from "node:crypto";
import { V2_VERSION, taipeiDate } from "../market-risk-scanner/scripts/strategy-v2.js";

// Stable per-day keys also protect retries after a successful push but failed
// git commit. LINE's retry deduplication lasts 24 hours; only send today's data.
export function lineRetryKey(date, phase) {
  const h = createHash("sha256").update(`${V2_VERSION}:${date}:${phase}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function v2DailyMessage(snapshot) {
  const states = { final: "當日觀測結束", incomplete: "資料不完整，待核對", blocked: "盤前資料未通過，不模擬" };
  const positions = (snapshot.positions || []).filter((p) => p.book === "atr");
  const b = snapshot.books?.atr;
  return [
    `新版策略每日觀測｜${snapshot.marketDate}`,
    states[snapshot.status] || snapshot.status,
    `已平倉 ${b?.closedCount || 0} 筆｜待核對 ${b?.unresolvedCount || 0} 筆｜只觀察 ${positions.filter((p) => p.status === "watch").length} 檔`,
    b?.closedCount > 0 && Number.isFinite(b.netPnl) ? `費稅後模擬淨損益 ${b.netPnl.toFixed(2)} 元` : "尚無完整成交績效，不列虛擬獲利。",
    ...positions.map((p) => `${p.side === "long" ? "多" : "空"} ${p.code} ${p.name}｜${p.status === "closed" ? `模擬已平倉，淨損益 ${p.netPnl.toFixed(2)} 元` : p.note || "未成交"}`),
    "觀測價模擬，非券商成交；未確認交易資格或券源不模擬進場。"
  ].join("\n");
}

export async function notifyV2Daily({ snapshot, sent = {}, send, now = new Date() }) {
  if (!snapshot.finalized || snapshot.marketDate !== taipeiDate(now) || snapshot.status === "market-closed" || sent[snapshot.marketDate]) return sent;
  if (!await send(v2DailyMessage(snapshot), lineRetryKey(snapshot.marketDate, "daily"))) return sent;
  return { ...sent, [snapshot.marketDate]: { acceptedAt: now.toISOString(), reportId: snapshot.reportId || null } };
}
