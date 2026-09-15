// Sends the latest pre-open report as a LINE push message (plain text summary).
// Auth: prefer a long-lived LINE_CHANNEL_ACCESS_TOKEN, otherwise derive one
// from LINE_CHANNEL_ID + LINE_CHANNEL_SECRET at runtime (same as the other
// LINE scripts). Reads the recipient from LINE_USER_ID.
// Secrets are read from the environment only; never commit them.
import { readFile } from "node:fs/promises";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);
const REPORT_PATH = new URL("preopen-report.json", SHARED_DIR);

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

const message = lines.join("\n");
const token = await getLineAccessToken();

const response = await fetch(MESSAGING_API, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
  signal: AbortSignal.timeout(15000),
  body: JSON.stringify({
    to: userId,
    messages: [{ type: "text", text: message }]
  })
});

if (!response.ok) {
  const body = await response.text();
  console.error(`LINE send failed (HTTP ${response.status}): ${body}`);
  process.exit(1);
}

console.log(`LINE push sent to ${userId} (${message.length} chars).`);
