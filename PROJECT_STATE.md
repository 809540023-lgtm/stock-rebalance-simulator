# Project State

Last updated: 2026-08-18

## Purpose

The project is a Taiwan stock research and paper-trading system. It contains asset-rebalancing simulations, a market risk scanner, paper-trade tracking, fee-aware return calculations, and LINE alert workflows.

## Important Interfaces

- `index.html`: original stock rebalancing and investment simulator.
- `market-risk-scanner/index.html`: Taiwan market decline and risk scanner.
- `paper-trade-tracker/index.html`: visual paper-trade tracker.

## Important Data

- `market-risk-scanner/data/market-risk.json`: latest generated all-market risk snapshot.
- `data/paper-trade-positions.json`: recorded paper-trade positions and fee assumptions.
- `data/paper-trade-latest.json`: dedicated latest prices for paper-trade holdings.
- `data/twse-latest.json`: broader TWSE snapshot.
- `data/line-watchlist.json`: monitored symbols.

## Recorded Paper Trades

- 1446 Macroblock-related listing name `宏和`: 1,000 shares at TWD 13.95 on 2026-08-12.
- 3346 Laster Tech `麗清`: 1,000 shares at TWD 21.20 on 2026-08-12.
- Do not record later candidates as purchased without an actual user-confirmed fill.

## Fee Assumptions

- Commission: 0.1425% per side.
- Minimum commission: TWD 20 per order.
- Normal stock sale transaction tax: 0.3%.
- Same-day stock day-trade sale tax: 0.15% through the current statutory period; verify official rules before use.

## Strategy Findings

- **Core strategy rule (user-confirmed, 2026-08-18, successfully executed intraday)**: 開盤前先篩選出 50 檔上漲潛力股與 50 檔下跌潛力股。當大盤普跌時，盤中下達指令：在早上篩選出的「50 檔有潛力上漲的股票」中，挑出「目前正在跌停或跌幅最高」的股票，這些作為**多頭指標（買進標的）**，而非空頭指標。下次遇到相同情況（大盤普跌）時，依照此規則執行。此為研究策略描述，不代表保證獲利。
- The original risk score identifies stocks that fell quickly; it is not by itself a bullish reversal score.
- A bullish candidate now requires stabilization and confirmation: no new low, higher low or breakout, rising short moving average, improving up-volume, relative strength, acceptable fundamentals, liquidity, and no disposition restriction.
- A bearish continuation candidate requires recent weakness, a lower low, price below short moving averages, failed rebound, sufficient volume, normal trading eligibility, and a conditional breakdown trigger.
- Do not chase a stock that already fell near limit-down; rebound risk is high.

## Bullish and Bearish Models (Priority 1)

- `market-risk-scanner/scripts/models.js` implements two independent deterministic scores, separate from the decline-risk score.
- Bullish reversal score: no new low, higher low, short moving averages turning up, price above the short MA, improving up-volume, relative strength vs the index, and acceptable fundamentals.
- Bearish continuation score: price below short MAs, lower low, recent weakness, failed rebound, down-volume confirmation, sufficient liquidity, and a conditional breakdown trigger.
- `applyFilters` gates candidates by price ceiling (default 50), minimum average volume, disposition status, and trading eligibility.
- `update-risk-data.js` fetches the TWSE disposition list (`/v1/announcement/punish`) and writes `candidates.bullish` / `candidates.bearish` into `market-risk.json`.
- `save-shared-candidates.js` writes the latest snapshots to `data/shared/bullish-latest.json` and `data/shared/bearish-latest.json`, plus immutable per-date history to `data/shared/*-history.json` (first snapshot per date is kept, never overwritten). Each snapshot keeps the top 50 candidates per model. Wired into `update-market-risk-scanner.yml` after data generation.
- `index.html` shows separate bullish and bearish candidate tabs as visual score cards (colored score bar, rank, code/name/market/price, reason chips) with a stale-data warning.
- `data/shared/` contains the generated candidate snapshots; treat them as research signals, not investment advice.

## Long-Term Evaluation (Priority 2)

- `market-risk-scanner/scripts/evaluation.js` provides pure `buildTradeRecord`, `summarizeTrades`, and `compareToBaseline` functions.
- `market-risk-scanner/scripts/evaluate-candidates.js` generates historical signals and forward returns, writing `data/shared/evaluation.json`.
- Trade records store signal date, entry/target/stop, MFE/MAE, exit reason, gross/net return, and 3/5/20-day returns. Net return subtracts commission (0.1425% per side) and 0.3% sale tax.
- Benchmarks: TAIEX 20-day forward return and a liquidity-matched baseline (average volume >= 500,000).
- Latest run (signals 2026-06-15 to 2026-07-20): bullish 3,221 trades (win 43.5%, avg net -1.08%), bearish 4,160 trades (win 55.9%, avg net +0.06%). Both beat the baseline (-5.32%) and index (-1.45%).
- `data/shared/evaluation-summary.json` is a small summary of `evaluation.json` for the UI.
- `market-risk-scanner/scripts/factor-analysis.js` (ported from alphalens) computes IC, quantile returns, and factor spread per model; shown in the history tab.
- `market-risk-scanner/scripts/price-prediction.js` (ported from StockPricePrediction) predicts next price/change via OLS linear regression; shown on candidate cards.
- The scanner UI has a "今日下單追蹤" tab that auto-loads the top 10 bullish (buy) and top 10 bearish (short) candidates, lets the user enter fill price/quantity, and computes live P/L (stored in localStorage).
- Note: the TAIEX index for the current month is only available after month-end, so the index series may lag the stock quotes.

## Visual Interface (Priority 3)

- `market-risk-scanner/index.html` has four tabs: 多頭候選, 空頭候選, 實際持倉, 歷史績效.
- The holdings tab reads `data/paper-trade-positions.json` and `data/paper-trade-latest.json`, showing buy/current price and estimated P/L, separate from unfilled candidates.
- The history tab reads `data/shared/evaluation-summary.json` and shows model summaries and benchmark comparison.
- The status line shows the snapshot generation timestamp and stale-data warnings; candidate cards show per-rule reasons.

## Recent Research Examples

- 2303 UMC: simulated entry TWD 123; it reached the TWD 129.50 5% alert level intraday on 2026-08-13. Holding through the 2026-08-17 close at TWD 121.50 would have produced a loss instead, showing the importance of executing exits.
- 4720 Tex Year: simulated entry TWD 20.05; it did not reach TWD 21.10 and broke the TWD 19.50 risk exit. Holding to TWD 18.10 materially increased the loss.
- 3033 Weikeng: latest bearish research candidate as of the 2026-08-17 close. The plan was conditional only: consider a short after a break below TWD 46.50 that fails to reclaim TWD 46.70; avoid chasing a large gap down. This is not a recorded trade.

## Automation

- GitHub Actions update market data and paper-trade prices.
- LINE workflows monitor configured events, but deployment credentials and LINE delivery must be verified separately.
- Previous GitHub CLI authentication became invalid. Local commits may be ahead of `origin/main`; inspect before pushing.

## Verification

The current Node unit tests pass with:

```bash
node --test tests/*.test.js
```

Browser tests may require a local HTTP server and Playwright browser permissions.

