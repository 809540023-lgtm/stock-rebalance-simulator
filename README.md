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

- `LINE_CHANNEL_ID`：LINE Messaging API Channel ID
- `LINE_CHANNEL_SECRET`：LINE Messaging API Channel secret
- `LINE_CHANNEL_ACCESS_TOKEN`：可選；若未設定，排程會使用 Channel ID 與 secret 自動取得短效 token
- `LINE_USER_ID`：要接收提醒的 LINE user ID
- `INVESTMENT_REMINDER_TEXT`：可選，自訂提醒文字
- `INVESTMENT_REMINDER_URL`：可選，預設為 Render 網站網址

設定完成後，可到 `Actions -> LINE investment reminder -> Run workflow` 手動測試。

## LINE 價格異動監控

`.github/workflows/check-line-limit-up.yml` 會在台灣交易時段以約 5 分鐘頻率查詢證交所 MIS 即時行情。現在固定監控 `data/line-watchlist.json` 中的 16 檔上市股票；觸及漲停、跌停或當日跌幅首次達到設定門檻時發送 LINE。同一股票的每種事件同一交易日只通知一次。

- 監控設定：`data/line-watchlist.json`
- `symbols` 填入代號後，會改用自訂上市股票清單
- `declineAlertPct` 設定跌幅通知門檻，目前為 3
- `notifyOn` 可控制 `limit-up`、`limit-down`、`decline` 三種事件
- `symbols` 留白時，才會依 `limit` 取風險掃描器的上市排行
- 需要已有的 `LINE_CHANNEL_ACCESS_TOKEN`，或 `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET`，以及 `LINE_USER_ID`
- 通知狀態會寫入 `data/line-market-alert-state.json`，避免重複推播

GitHub Actions 排程可能延遲數分鐘；這是雲端輪詢提醒，不是券商逐筆行情或自動下單服務。證交所即時行情也可能因網路、交易狀態或官方服務限制而暫時無法取得。

也可以在已登入 GitHub CLI 的電腦執行：

```bash
gh secret set LINE_CHANNEL_ID --repo 809540023-lgtm/stock-rebalance-simulator
gh secret set LINE_CHANNEL_SECRET --repo 809540023-lgtm/stock-rebalance-simulator
gh secret set LINE_USER_ID --repo 809540023-lgtm/stock-rebalance-simulator
```

指令會安全地要求輸入值，不要把 token 寫進程式碼或聊天訊息。若執行失敗，Actions 摘要會直接指出缺少哪個 Secret 或 LINE API 回傳的狀態。

## 買入實測追蹤器

`paper-trade-tracker/index.html` 獨立記錄實際成交測試。目前記錄 2026-08-12 買進宏和（1446）一張、成交價 13.95，以及麗清（3346）一張、成交價 21.20。

- 原始買入紀錄：`data/paper-trade-positions.json`
- 5% 可成交通知價：宏和 14.65、麗清 22.30
- 三個交易日評估日：2026-08-17，13:25 後以接近收盤的最新成交價計算
- `.github/workflows/check-paper-trade-alerts.yml` 在交易時段每 5 分鐘檢查 TWSE MIS
- `.github/workflows/update-paper-trade-prices.yml` 於交易日 13:40 更新 `data/paper-trade-latest.json`
- 通知去重狀態：`data/paper-trade-alert-state.json`
- 網站同時顯示帳面損益及「現在賣出」預估淨損益；淨額預設採 0.1425% 買賣手續費（每筆最低 NT$20）及 0.3% 股票證交稅
- LINE 5% 觸價通知依成交價漲幅判斷，未計入交易成本及股利

> 本工具僅供情境試算，不構成投資建議。
