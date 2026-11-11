// Sends the latest pre-open report as a LINE push message (plain text summary).
// Auth: prefer a long-lived LINE_CHANNEL_ACCESS_TOKEN, otherwise derive one
// from LINE_CHANNEL_ID + LINE_CHANNEL_SECRET at runtime (same as the other
// LINE scripts). Reads the recipient from LINE_USER_ID.
// Secrets are read from the environment only; never commit them.
import { readFile } from "node:fs/promises";
import { activeV2, taipeiDate, taipeiTime } from "./strategy-v2.js";
import { reportUsable } from "../../scripts/strategy-v2-simulation.js";
import { lineRetryKey } from "../../scripts/strategy-v2-line.js";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);
const REPORT_PATH = new URL(activeV2() ? "strategy-v2-latest.json" : "preopen-report.json", SHARED_DIR);

const MESSAGING_API = "https://api.line.me/v2/bot/message/push";
const userId = process.env.LINE_USER_ID?.trim();

if (!userId) {
  console.error("Missing recipient LINE_USER_ID environment variable.");
  process.exit(1);
}

async function getLineAccessToken() {
  const longLived = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (longLived) return longLived;
  const channelId = process.env.LINE_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) {
    throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN，或 LINE_CHANNEL_ID 與 LINE_CHANNEL_SECRET。");
  }
  const response = await fetch("https://api.line.me/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: channelId, client_secret: channelSecret })
  });
  if (!response.ok) throw new Error(`LINE token request failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("LINE token endpoint 沒有回傳 access token。");
  return payload.access_token;
}

const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));

function rowLine(row) {
  const dir = row.side === "long" ? "📈 做多" : "📉 放空";
  const change = row.predictedChangePct == null ? "n/a" : `${row.predictedChangePct.toFixed(2)}%`;
  return `${row.rank}. ${dir} ${row.code} ${row.name} 收${row.close} (預估${change})`;
}

const lines = [];
lines.push(`📊 台股開盤前研究報告 · ${report.dataDate}`);
lines.push(`版本: ${report.version}`);
lines.push("");
lines.push(`【做多候選｜${report.longCandidates.length} 檔】`);
report.longCandidates.forEach((c) => lines.push(rowLine(c)));
lines.push("");
lines.push(`【放空候選｜${report.shortCandidates.length} 檔】`);
report.shortCandidates.forEach((c) => lines.push(rowLine(c)));
lines.push("");
lines.push("⚠️ 研究候選清單，非保證獲利、非自動下單。放空需確認庫存/融券限制，做多待開盤確認價位。");

let message = lines.join("\n");
if (activeV2()) {
  const current = reportUsable(report, taipeiDate()) && taipeiTime() < "09:00:00";
  const rows = [...(report.longCandidates || []), ...(report.shortCandidates || [])];
  message = [
    `台股新版策略｜${taipeiDate()}｜11/12 起獨立記錄`,
    `報告狀態：${current ? "盤前名單已固定" : "僅狀態通知，無當前可執行名單"}`,
    `資料日：${report.dataDate || "未確認"}`,
    ...(current ? rows.map((r) => `${r.side === "long" ? "多" : "空"} ${r.code} ${r.name}｜條件分 ${r.score}｜觸發參考 ${r.triggerPrice}｜${r.executionEligible ? "待觸發，僅模擬" : "資格未確認，只觀察"}`) : []),
    ...(report.warnings || []).slice(0, 3),
    "最多5多/10空，不湊數。未接券商，不代表實際可成交；研究訊號不是下單指令。"
  ].join("\n");
}
const token = await getLineAccessToken();

const response = await fetch(MESSAGING_API, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(activeV2() ? { "X-Line-Retry-Key": lineRetryKey(taipeiDate(), "preopen") } : {})
  },
  signal: AbortSignal.timeout(15000),
  body: JSON.stringify({
    to: userId,
    messages: [{ type: "text", text: message }]
  })
});

if (!response.ok && !(activeV2() && response.status === 409 && response.headers.get("x-line-accepted-request-id"))) {
  const body = await response.text();
  console.error(`LINE send failed (HTTP ${response.status}): ${body}`);
  process.exit(1);
}

console.log(`LINE push sent (${message.length} chars).`);
