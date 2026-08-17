# 台股下跌速度與風險掃描器

這是一個獨立工具，不會修改原本的股票分批賣出與投資管理模擬器。

## 功能

- 分析上市與上櫃股票的區間跌幅
- 找出最快單日跌幅、最大回撤、連跌與下跌放量股票
- 顯示台灣加權指數的每日漲跌
- 顯示本益比、殖利率、股價淨值比與風險分數
- 匯出 CSV、列印分析結果

## 開啟

從專案根目錄啟動靜態伺服器後，開啟：

market-risk-scanner/index.html

每日資料由 .github/workflows/update-market-risk-scanner.yml 更新，資料檔位於 market-risk-scanner/data/market-risk.json。

## LINE 價格異動監控

網站頁面會顯示目前的監控範圍；雲端工作流程 `.github/workflows/check-line-limit-up.yml` 會在交易時段查詢 TWSE MIS。設定檔位於 `data/line-watchlist.json`，現在固定監控截圖中的 16 檔上市股票。通知需要 GitHub Actions Secrets：`LINE_USER_ID`，以及 `LINE_CHANNEL_ACCESS_TOKEN` 或 `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET`。

通知以當日漲停價、跌停價及跌幅門檻判定，並以 `data/line-market-alert-state.json` 做每日、每事件去重。GitHub Actions 是約 5 分鐘輪詢，不保證逐筆成交等級的即時性。

## 多頭反轉與空頭延續候選

- 多頭反轉與空頭延續是兩套獨立的確定性評分，與下跌風險分數分開，不構成買賣指令。
- 多頭反轉分數：近期未創新低、低點墊高、短均線轉多、站上短均線、上漲量能、相對大盤強勢與基本面。
- 空頭延續分數：跌破短均線、低點下移、近期走弱、反彈失敗、下跌量能、流動性與跌破觸發價。
- 候選清單套用價格上限（預設 50 元）、最低日均量、處置股與交易資格過濾。
- 模型邏輯位於 `scripts/models.js`，資料由 `scripts/update-risk-data.js` 寫入 `data/market-risk.json` 的 `candidates` 欄位。
- `scripts/save-shared-candidates.js` 將最新候選寫入 `data/shared/bullish-latest.json` 與 `data/shared/bearish-latest.json`，並以每日為單位累積不可覆寫的歷史到 `data/shared/bullish-history.json` 與 `data/shared/bearish-history.json`。
- 資料日期過期時，頁面會顯示過期警告。

風險分數是研究篩選指標，不構成投資建議。
