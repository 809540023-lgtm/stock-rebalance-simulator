const escape = (x) => String(x ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = (x) => typeof x === "number" && Number.isFinite(x) ? x.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "尚無完整成交";
export const currentV2Report = (report, date) => report?.version === "strategy-v2-20261112" && report.tradeDate === date && !report.preview && report.status === "ready" && Date.parse(report.generatedAt) < Date.parse(report.cutoff);
async function json(path) {
  const response = await fetch("../data/shared/" + path, { cache: "no-cache" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}
export async function initializeV2() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const active = date >= "2026-11-12";
  const root = document.getElementById("strategyV2");
  if (!root) return { active, report: null };
  try {
    const report = await json(active ? "strategy-v2-latest.json" : "strategy-v2-preview.json");
    const summary = await json("strategy-v2-summary.json");
    const simulation = await json("strategy-v2-simulation-latest.json");
    const statuses = { ready: "研究名單已固定", "data-blocked": "資料未齊，停止選股", "missed-cutoff": "錯過盤前截止，停止選股", "market-closed": "休市", "not-effective": "尚未生效", "previous-close-not-final": "前日行情尚未完成" };
    const stale = active && report?.tradeDate !== date;
    const valid = active ? currentV2Report(report, date) : report?.status === "ready";
    const title = active ? "新版策略 V2" : "新版策略 V2 · 11/12 生效預覽";
    const cards = (rows) => rows.map((r) => '<article class="v2-stock"><strong>' + escape(r.code + " " + r.name) + '</strong><span>條件分 ' + escape(r.score) + '</span><p>觸發參考 ' + escape(r.triggerPrice) + ' 元</p><p>' + escape(r.reasons.join("、")) + '</p><small>' + (r.executionEligible ? "資格已提供，待觸發模擬" : "資格未確認，只觀察") + '</small></article>').join("") || '<p>沒有合格候選</p>';
    const atr = summary?.books?.atr, baseline = summary?.books?.baseline;
    const simCurrent = simulation?.marketDate === date;
    const observed = simCurrent ? simulation.positions || [] : [];
    const stateNames = { watch: "觀察", open: "模擬持有", closed: "模擬已平倉", unresolved: "待核對", unfilled: "未成交" };
    root.innerHTML = '<h2>' + title + '</h2><p class="v2-status" role="status">' + (stale ? "尚無今日報告，不使用昨日名單" : report?.preview ? "預覽，尚未固定正式名單" : statuses[report?.status] || "等待盤前報告") + '</p>' +
      '<dl class="v2-meta"><div><dt>交易日</dt><dd>' + escape(report?.tradeDate || "2026-11-12") + '</dd></div><div><dt>行情資料日</dt><dd>' + escape(report?.dataDate || "未確認") + '</dd></div><div><dt>產生時間（台北）</dt><dd>' + (report?.generatedAt ? escape(new Date(report.generatedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })) : "未產生") + '</dd></div><div><dt>盤前截止</dt><dd>07:00</dd></div></dl>' +
      '<p>' + escape((report?.warnings || []).join("；")) + '</p><h3>做多反轉 · 最多 5 檔</h3><div class="v2-stocks">' + cards(valid ? report.longCandidates : []) + '</div>' +
      '<h3>放空延續 · 最多 10 檔</h3><div class="v2-stocks">' + cards(valid ? report.shortCandidates : []) + '</div>' +
      '<details><summary>跌深買進實驗觀察池（' + (valid ? report.contrarianWatchlist?.length || 0 : 0) + '）</summary><p>' + escape(valid ? (report.contrarianWatchlist || []).map((r) => r.code + " " + r.name).join("、") : "尚無名單") + '</p></details>' +
      '<h3>11/12 起獨立績效</h3><div class="v2-table"><table><thead><tr><th>出場方式</th><th>完整成交筆數</th><th>累計淨損益（元）</th></tr></thead><tbody><tr><td>波動度停損停利</td><td>' + (atr?.closedCount || 0) + '</td><td>' + money(atr?.netPnl) + '</td></tr><tr><td>同訊號原 6% / 4% 出場</td><td>' + (baseline?.closedCount || 0) + '</td><td>' + money(baseline?.netPnl) + '</td></tr></tbody></table></div>' +
      '<p>完整日 ' + (summary?.completeDays || 0) + '；待核對日 ' + (summary?.incompleteDays || 0) + '。研究模擬，非券商成交。</p>' +
      '<h3>今日觀測狀態</h3><div class="v2-table"><table><thead><tr><th>股票 / 組別</th><th>狀態</th><th>模擬進場</th><th>模擬出場</th><th>淨損益</th></tr></thead><tbody>' +
      (observed.filter((p) => p.book === "atr").map((p) => '<tr><td>' + escape(p.code + " " + p.name + (p.side === "long" ? " / 多" : " / 空")) + '</td><td>' + escape(stateNames[p.status] || p.status) + '</td><td>' + escape(p.entryPrice ?? "未成交") + '</td><td>' + escape(p.exitPrice ?? "未成交") + '</td><td>' + (p.netPnl == null ? "未結算" : money(p.netPnl)) + '</td></tr>').join("") || '<tr><td colspan="5">尚無今日觀測紀錄</td></tr>') + '</tbody></table></div>';
    return { active, report: valid && active && !report.preview ? report : null };
  } catch (e) {
    root.innerHTML = '<h2>新版策略 V2 · 11/12 起</h2><p role="alert">新版資料讀取失敗，不回退舊候選：' + escape(e.message) + '</p>';
    return { active, report: null };
  }
}
