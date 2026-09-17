// Builds a rolling strategy summary from the per-day simulation records in
// data/preopen-simulation-history.json and optionally pushes it to LINE.
// Pure logic lives in buildWeeklyReport(records) so it can be unit-tested.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const historyPath = new URL("data/preopen-simulation-history.json", ROOT);
const latestPath = new URL("data/shared/strategy-weekly-latest.json", ROOT);
const historyWeeklyPath = new URL("data/shared/strategy-weekly-history.json", ROOT);

const dryRun = process.env.LINE_DRY_RUN === "true";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  const n = num(value);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
}

function pct(value) {
  const n = num(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// Pure, testable report builder over the per-day simulation records.
export function buildWeeklyReport(records, generatedAt = new Date().toISOString()) {
  const rows = [...records]
    .filter((r) => r && num(r.netPnl))
    .sort((a, b) => String(a.marketDate || "").localeCompare(String(b.marketDate || "")));

  const days = rows.length;
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0; // in TWD, cumulative peak-to-trough
  let win = 0;
  let investedSum = 0;
  let grossSum = 0;
  let feesSum = 0;
  const exit = { takeProfit: 0, stopLoss: 0, forceClose: 0, holding: 0 };
  const perDay = [];

  for (const r of rows) {
    const net = num(r.netPnl);
    cumulative += net;
    investedSum += num(r.investedCapital);
    grossSum += num(r.grossPnl);
    feesSum += num(r.fees);
    if (net > 0) win += 1;
    const ec = r.exitCount || {};
    for (const k of Object.keys(exit)) exit[k] += num(ec[k]);
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    perDay.push({ date: r.marketDate, netPnl: net });
  }

  const avgInvested = days ? investedSum / days : 0;
  const totalNetPct = avgInvested ? (cumulative / avgInvested) * 100 : 0;

  return {
    version: "weekly-strategy-summary-v1",
    generatedAt,
    window: {
      days,
      start: days ? rows[0].marketDate : null,
      end: days ? rows[days - 1].marketDate : null
    },
    metrics: {
      cumulativeNetPnl: cumulative,
      totalNetPct,
      avgDailyNetPnl: days ? cumulative / days : 0,
      winDays: win,
      lossDays: days - win,
      winRate: days ? (win / days) * 100 : 0,
      maxDrawdown,
      maxDrawdownPct: avgInvested ? (maxDrawdown / avgInvested) * 100 : 0,
      grossPnl: grossSum,
      fees: feesSum,
      avgInvestedCapital: avgInvested
    },
    exitCount: exit,
    perDay
  };
}

// Renders a plain-text (LINE-friendly) summary in Chinese, mirroring the other
// LINE script formatting conventions.
export function buildSummaryText(report, quoteNote) {
  const lines = [];
  lines.push("📊 開盤前候選策略 · 週報/累計");
  const w = report.window;
  lines.push(`區間：${w.start} ~ ${w.end}（${w.days} 個交易日）`);
  lines.push("");
  const m = report.metrics;
  lines.push(`累計淨損益：${money(m.cumulativeNetPnl)}（${m.cumulativeNetPnl >= 0 ? "盈" : "虧"}）`);
  lines.push(`累計投報率（按平均投入）：${pct(m.totalNetPct)}`);
  lines.push(`日均淨損益：${money(m.avgDailyNetPnl)}`);
  lines.push(`勝率：${m.winDays}/${w.days} 天獲利（${pct(m.winRate)}）`);
  lines.push(`最大累計回撤：${money(m.maxDrawdown)}（${pct(m.maxDrawdownPct)}）`);
  lines.push("");
  const e = report.exitCount;
  lines.push(`出場：停利 ${e.takeProfit}｜停損 ${e.stopLoss}｜強平 ${e.forceClose}`);
  lines.push(`毛損益 ${money(m.grossPnl)}｜成本 ${money(m.fees)}`);
  lines.push("");
  lines.push(quoteNote || "來源：每日開盤前候選模擬紀錄；停利/停損用當日高低點判定，淨損益含成本。供研究參考、非下單依據。");
  return lines.join("\n");
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeSummary(message) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`, "utf8");
}

async function pushLine(text) {
  const userId = process.env.LINE_USER_ID?.trim();
  let token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) {
    const channelId = process.env.LINE_CHANNEL_ID?.trim();
    const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
    if (!channelId || !channelSecret) return false;
    const res = await fetch("https://api.line.me/oauth2/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: channelId, client_secret: channelSecret })
    });
    if (!res.ok) return false;
    const payload = await res.json();
    token = payload.access_token || "";
  }
  if (!userId || !token) return false;
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] })
  });
  return res.ok;
}

async function main() {
  const history = await readJson(historyPath, { simulations: [] });
  const records = history.simulations || [];
  const report = buildWeeklyReport(records);
  const text = buildSummaryText(report);

  await mkdir(new URL(".", latestPath), { recursive: true });
  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  // Immutable per-run history of weekly snapshots.
  const weekly = await readJson(historyWeeklyPath, { snapshots: [] });
  weekly.snapshots = weekly.snapshots || [];
  weekly.snapshots.push({ generatedAt: report.generatedAt, ...report.window, metrics: report.metrics, exitCount: report.exitCount, perDay: report.perDay });
  await writeFile(historyWeeklyPath, `${JSON.stringify(weekly, null, 2)}\n`, "utf8");

  console.log(text);
  await writeSummary(`## 開盤前候選策略週報\n\n\`\`\`\n${text}\n\`\`\``);

  if (!dryRun) {
    const sent = await pushLine(text);
    console.log(sent ? "LINE push sent." : "（LINE 未設定或缺少憑證，跳過推播）");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
