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

風險分數是研究篩選指標，不構成投資建議。
