import { appendFile } from "node:fs/promises";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const userId = process.env.LINE_USER_ID?.trim();
const siteUrl = process.env.INVESTMENT_REMINDER_URL || "https://stock-rebalance-simulator.onrender.com";
const customText = process.env.INVESTMENT_REMINDER_TEXT;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

async function writeSummary(message) {
  if (summaryPath) await appendFile(summaryPath, `${message}\n`, "utf8");
}

if (!token || !userId) {
  const missing = [
    !token && "LINE_CHANNEL_ACCESS_TOKEN",
    !userId && "LINE_USER_ID"
  ].filter(Boolean).join(", ");
  console.error(`Missing required GitHub Actions secrets: ${missing}.`);
  await writeSummary(`## LINE reminder failed\n\nMissing required secrets: \`${missing}\`.`);
  process.exit(1);
}

const now = new Date();
const formatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: process.env.REMINDER_TIMEZONE || "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const messageText = (customText || [
  "投資提醒",
  `時間：${formatter.format(now)}`,
  "",
  "今天可以打開投資管理表，更新股票目前價格，確認是否該投入本週/本月資金。",
  "",
  `工具：${siteUrl}`
].join("\n")).slice(0, 5000);

const response = await fetch("https://api.line.me/v2/bot/message/push", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  signal: AbortSignal.timeout(15000),
  body: JSON.stringify({
    to: userId,
    messages: [
      {
        type: "text",
        text: messageText
      }
    ]
  })
});

if (!response.ok) {
  const body = await response.text();
  console.error(`LINE push failed: ${response.status} ${response.statusText}`);
  console.error(body);
  await writeSummary(`## LINE reminder failed\n\nLINE Messaging API returned HTTP ${response.status}. Check the channel token, User ID, and whether the user has added the bot as a friend.`);
  process.exit(1);
}

console.log("LINE investment reminder sent.");
await writeSummary(`## LINE reminder sent\n\nDelivered at ${formatter.format(now)} (${process.env.REMINDER_TIMEZONE || "Asia/Taipei"}).`);
