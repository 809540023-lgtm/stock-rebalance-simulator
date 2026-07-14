# 股票分批賣出與回補模擬器

這是一個單檔靜態網頁工具，用來模擬持有單一股票或 ETF 時，依照價格條件分批賣出、回檔買回後的資產變化。

## 功能

- 輸入目前價格、初始持股、平均成本與現金
- 設定價格路徑，例如 `103, 108, 100, 110`
- 設定多筆交易規則，例如漲到 108 賣 5%、跌到 100 用現金補回
- 比較策略操作與完全持有不動的資產差異
- 匯出 CSV、PNG、列印分析表與 JSON 案例備份
- 買進規劃支援既有成本、定期投入、手續費及每月價格情境
- 從證交所官方 OpenAPI 帶入上市股票與 ETF 的最新每日收盤價

## 使用方式

直接開啟 `index.html` 即可使用，不需要安裝套件或啟動伺服器。

GitHub Actions 會在台股交易日下午 15:30 更新 `data/twse-latest.json`。網站顯示的是最新收盤資料，不是盤中即時報價；上櫃商品目前仍需人工輸入。

## LINE 投資提醒機器人

專案內含 GitHub Actions 排程：`.github/workflows/line-investment-reminder.yml`。

預設每天台北時間 09:00 執行一次。GitHub Actions 排程可能因平台忙碌而延後數分鐘。

需要在 GitHub repo 的 `Settings -> Secrets and variables -> Actions` 新增：

- `LINE_CHANNEL_ACCESS_TOKEN`：LINE Messaging API channel access token
- `LINE_USER_ID`：要接收提醒的 LINE user ID
- `INVESTMENT_REMINDER_TEXT`：可選，自訂提醒文字
- `INVESTMENT_REMINDER_URL`：可選，預設為 Render 網站網址

設定完成後，可到 `Actions -> LINE investment reminder -> Run workflow` 手動測試。

也可以在已登入 GitHub CLI 的電腦執行：

```bash
gh secret set LINE_CHANNEL_ACCESS_TOKEN --repo 809540023-lgtm/stock-rebalance-simulator
gh secret set LINE_USER_ID --repo 809540023-lgtm/stock-rebalance-simulator
```

指令會安全地要求輸入值，不要把 token 寫進程式碼或聊天訊息。若執行失敗，Actions 摘要會直接指出缺少哪個 Secret 或 LINE API 回傳的狀態。

> 本工具僅供情境試算，不構成投資建議。
