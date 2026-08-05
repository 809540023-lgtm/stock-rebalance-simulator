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

## LINE 漲停監控

網站頁面會顯示目前的監控範圍；雲端工作流程 `.github/workflows/check-line-limit-up.yml` 會在交易時段查詢 TWSE MIS。預設為風險排行前 50 檔上市股票，設定檔位於 `data/line-watchlist.json`。若在 `symbols` 填入股票代號，則改用自訂清單。通知需要 GitHub Actions Secrets：`LINE_USER_ID`，以及 `LINE_CHANNEL_ACCESS_TOKEN` 或 `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET`。

通知以當日漲停價欄位判定，並以 `data/line-limit-up-state.json` 做每日去重。GitHub Actions 是約 5 分鐘輪詢，不保證逐筆成交等級的即時性。

風險分數是研究篩選指標，不構成投資建議。
