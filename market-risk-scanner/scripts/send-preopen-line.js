// Sends the latest pre-open report as a LINE push message (plain text summary).
// Reads LINE_CHANNEL_ACCESS_TOKEN and LINE_USER_ID from the environment.
// These are expected to be set as GitHub Actions secrets; never commit them.
import { readFile } from "node:fs/promises";

const SHARED_DIR = new URL("../../data/shared/", import.meta.url);
const REPORT_PATH = new URL("preopen-report.json", SHARED_DIR);

const MESSAGING_API = "https://api.line.me/v2/bot/message/push";
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const userId = process.env.LINE_USER_ID;

if (!token || !userId) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_USER_ID environment variable.");
  process.exit(1);
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

const response = await fetch(MESSAGING_API, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  },
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
