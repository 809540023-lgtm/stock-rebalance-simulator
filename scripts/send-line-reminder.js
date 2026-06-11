const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const userId = process.env.LINE_USER_ID;
const siteUrl = process.env.INVESTMENT_REMINDER_URL || "https://stock-rebalance-simulator.onrender.com";
const customText = process.env.INVESTMENT_REMINDER_TEXT;

if (!token || !userId) {
  console.error("Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_USER_ID.");
  process.exit(1);
}

const now = new Date();
const formatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: process.env.REMINDER_TIMEZONE || "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const messageText = customText || [
  "投資提醒",
  `時間：${formatter.format(now)}`,
  "",
  "今天可以打開投資管理表，更新股票目前價格，確認是否該投入本週/本月資金。",
  "",
  `工具：${siteUrl}`
].join("\n");

const response = await fetch("https://api.line.me/v2/bot/message/push", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  },
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
  process.exit(1);
}

console.log("LINE investment reminder sent.");
