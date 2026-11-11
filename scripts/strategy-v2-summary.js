import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { V2_VERSION, V2_EFFECTIVE_DATE } from "../market-risk-scanner/scripts/strategy-v2.js";
import { readJson, atomicJson } from "./run-strategy-v2.js";

const ROOT = new URL("../", import.meta.url);
export function summarizeV2(records, initialCapital, now = new Date()) {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error("Positive initial capital required");
  const byDate = new Map();
  for (const r of records) {
    if (r.version !== V2_VERSION || r.marketDate < V2_EFFECTIVE_DATE) throw new Error("Cannot mix strategy versions");
    if (byDate.has(r.marketDate)) throw new Error("Duplicate simulation date");
    byDate.set(r.marketDate, r);
  }
  const rows = [...byDate.values()].filter((r) => r.status !== "market-closed").sort((a, b) => a.marketDate.localeCompare(b.marketDate));
  const books = {};
  for (const book of ["atr", "baseline"]) {
    let equity = initialCapital, peak = initialCapital, maxDrawdownPct = 0, closedCount = 0, winDays = 0, lossDays = 0, flatDays = 0;
    const perDay = [];
    for (const r of rows) {
      const b = r.books?.[book];
      if (!r.finalized || !b || b.unresolvedCount !== 0 || typeof b.netPnl !== "number" || !Number.isFinite(b.netPnl)) continue;
      equity += b.netPnl; peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, (peak - equity) / peak * 100);
      closedCount += b.closedCount;
      if (b.closedCount > 0) { if (b.netPnl > 0) winDays++; else if (b.netPnl < 0) lossDays++; else flatDays++; }
      perDay.push({ marketDate: r.marketDate, netPnl: b.netPnl, closedCount: b.closedCount, equity });
    }
    const tradingDays = winDays + lossDays + flatDays;
    books[book] = { initialCapital, closedCount, netPnl: closedCount ? Number((equity - initialCapital).toFixed(2)) : null, netPct: closedCount ? (equity / initialCapital - 1) * 100 : null, maxDrawdownPct: closedCount ? maxDrawdownPct : null, winDays, lossDays, flatDays, winRate: tradingDays ? winDays / tradingDays * 100 : null, noTradeDays: perDay.filter((d) => !d.closedCount).length, perDay, incompleteCoverage: perDay.length !== rows.length };
  }
  return { version: V2_VERSION, effectiveDate: V2_EFFECTIVE_DATE, generatedAt: now.toISOString(), completeDays: rows.filter((r) => r.finalized && r.status === "final").length, incompleteDays: rows.filter((r) => !r.finalized || r.status !== "final").length, books, promotionApproved: false, warnings: ["僅統計完整模擬日；無成交不等於策略成功，缺漏日不得當作零損益。", "比較的是同一新版訊號的兩種出場方式，並非舊選股模型已重跑完成。", "至少先持續觀察 20-30 個交易日，再配合更長歷史及時間順序驗證；不以單段獲利自動升級。"] };
}

export async function runV2Summary() {
  const dir = new URL("data/shared/strategy-v2-simulations/", ROOT);
  let files;
  try { files = await readdir(dir); } catch (e) { if (e.code !== "ENOENT") throw e; files = []; }
  const rows = [];
  for (const file of files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) rows.push(await readJson(new URL(file, dir)));
  const config = await readJson(new URL("data/shared/strategy-v2-config.json", ROOT));
  const result = summarizeV2(rows, config.initialCapital);
  await atomicJson(new URL("data/shared/strategy-v2-summary.json", ROOT), result);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runV2Summary()));
