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
- `scripts/save-shared-candidates.js` 將最新候選（每模型前 50 名）寫入 `data/shared/bullish-latest.json` 與 `data/shared/bearish-latest.json`，並以每日為單位累積不可覆寫的歷史到 `data/shared/bullish-history.json` 與 `data/shared/bearish-history.json`。
- 候選以視覺化卡片呈現：彩色分數條、排名、代號/名稱/市場/價格與通過原因標籤。
- 資料日期過期時，頁面會顯示過期警告。

## 長期評估

- `scripts/evaluation.js` 提供純函式 `buildTradeRecord`、`summarizeTrades` 與 `compareToBaseline`。
- `scripts/evaluate-candidates.js` 產生歷史訊號並計算未來報酬，寫入 `data/shared/evaluation.json`。
- 每筆交易記錄訊號日期、進場/目標/停損價、MFE/MAE、出場原因、毛報酬與淨報酬，以及 3/5/20 日報酬。淨報酬扣除手續費（單邊 0.1425%）與 0.3% 證交稅。
- 基準：加權指數 20 日未來報酬，以及流動性匹配基準（日均量 >= 500,000 的全部股票）。
- UI 的「歷史績效」分頁讀取輕量摘要 `data/shared/evaluation-summary.json`（完整交易記錄在 `evaluation.json`）。
- `scripts/factor-analysis.js`（移植自 alphalens）計算模型分數的 IC、分位報酬與因子價差，顯示於歷史績效分頁。
- `scripts/price-prediction.js`（移植自 StockPricePrediction）以線性迴歸預測下一收盤價與漲跌幅，顯示於候選卡片。

## 視覺介面分頁

- 多頭候選、空頭候選、實際持倉、歷史績效四個分頁。
- 實際持倉分頁讀取 `data/paper-trade-positions.json` 與 `data/paper-trade-latest.json`，顯示買進/最新價與損益，與未成交候選分開。
- 候選卡片顯示每條規則的通過原因；狀態列顯示快照產生時間與過期警告。

風險分數是研究篩選指標，不構成投資建議。
