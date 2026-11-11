# Project State

Last updated: 2026-11-11

## Active Cutover: 2026-11-12 (Taipei)

This section supersedes the dated legacy strategy/automation descriptions below. Canonical working copy: `/Volumes/ag/練習學一支股票放空/stock-rebalance-simulator`. The earlier Documents path no longer exists.

- User-approved V2: **up to 5 long and 10 short research candidates**, no padding when conditions fail. Independent deterministic long-reversal / short-continuation rules; market-regime gate; the former buy-the-largest-decliner rule is an isolated observation-only experiment, not an entry instruction.
- Configuration: `data/shared/strategy-v2-config.json`; version `strategy-v2-20261112`. Effective at Taipei midnight on November 12. Price range TWD 5-50; 61 aligned official sessions; 20-session average volume >= 500,000 shares and turnover >= TWD 10 million; near-limit moves excluded. Scores measure rule conformity, not calibrated win probability.
- `scripts/strategy-v2-data.js` repairs current-month TAIEX data and uses TWSE whole-market daily OHLCV reports to build a price-filtered ordinary-share pool independently of old rankings. Live preview has 587 TWSE stocks, index current through 11/11, 380 exclusions, 0 long / 10 short, and 7 experimental watch names. This is **not full listed + OTC coverage**; missing/invalid dates are excluded, never synthesized.
- `scripts/run-strategy-v2.js`: prepare at 06:10, freeze before 07:00, publish at 07:00. Reports are date-keyed, hash-checked and create-once under `data/shared/strategy-v2-reports/`; `strategy-v2-latest.json` is the current pointer. Today only `strategy-v2-preview.json` has been generated, not a formal 11/12 report. Late/missing data blocks selection rather than falling back to V1. GitHub cron is best-effort, not exact-time or real-time infrastructure.
- `scripts/strategy-v2-simulation.js`: separate `strategy-v2-simulations/` daily records and `strategy-v2-simulation-latest.json`; observed bid/ask plus adverse tick-rounded slippage, 09:05-10:00 entry window, 13:00 force-close with 90-second grace. Missing/stale observations, observation gaps > 360 seconds and missed exits become unresolved, not invented fills. The 5-minute scheduled sampler cannot reconstruct every intraday tick.
- Conservative research sizing: TWD 300,000 virtual capital per comparison book, 0.25% per-entry risk budget and 10% maximum position notional; these are modeling assumptions, not the user's account balance. ATR stop (1-4%) / 1.5R target compared with original 6% / 4% exits **on the same new signals**, not a rerun of old model selection. Every closed trade includes two-sided commissions, minimum charges, 0.3% sale tax, slippage and verified short borrowing cost. No unverified discounted day-trade tax or margin-leverage return uplift.
- **Current execution gate is closed.** No broker/adjustment/eligibility verification feed has been configured; all live preview candidates are research-only. `STRATEGY_VERIFICATION_FILE` may point to a separately maintained JSON map keyed by `code|market`. Required proof fields: `tradeDate`, `source`, `verifiedAt`; `adjustmentVerified/commonStock/dayTradeAllowed=true`; `disposition/suspended/alteredTrading=false`. Shorts additionally require `sellFirstAllowed/brokerInventoryVerified/shortPriceRuleVerified=true`, `availableShares`, `borrowCostTwd`, `minimumShortPrice`. The file contains verification results, not credentials, and only whitelisted fields are published. Exchange margin quotas alone are NOT broker inventory confirmation. No automatic actual orders or purchased positions are created.
- `scripts/strategy-v2-summary.js`: only complete, same-version days are aggregated; incomplete days stay visible; no fills produce null performance, not a success rate. Initial 20-30-session observation is for diagnosis, not proof of an edge. Longer point-in-time, corporate-action-adjusted history and walk-forward validation remain pending.
- Scanner top section shows V2 status, dates, both candidate groups, experiment pool and separate performance. Legacy candidates are not substituted after cutover. LINE uses existing environment-backed recipient/auth settings: pre-open report/status, one finalized daily observation summary with retry deduplication, and weekly V2 summary. No production LINE message was sent during local testing; the first automatic 11/12 delivery still requires observation.

### Historical Audit

The existing `data/preopen-simulation-history.json` contains **31 daily simulation records**, not 61 trading-day performance observations. Raw sums through 11/11: gross TWD 20,190; recorded costs TWD 54,546.06; net TWD -34,356.05 (rounding difference of one cent between aggregate columns). These are legacy simulated values with timing/fill biases, not verified actual trading returns. Signal-close fills, post-entry use of daily extrema, late force-close prices and rewritable daily outputs must not be treated as executable performance. All old daily records, candidate archives and paper positions are preserved; V2 starts a separate series.

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

- **Intraday three-way confirmation (2026-08-24)**: `market-risk-scanner/scripts/analyze-intraday-market.js` combines the latest complete daily-model snapshot with official TWSE MIS quotes. Bearish research candidates must underperform the TAIEX and have a non-positive price forecast; bullish candidates must outperform the TAIEX and have a non-negative forecast. The output is saved to `market-risk-scanner/data/intraday-analysis.json`. Short-sale eligibility and available shares still require broker confirmation.
- **Next-session short filter (2026-08-24 close)**: bearish plans also read the official TWSE `MI_MARGN` report and exclude symbols whose next-session short limit is zero or whose note contains `X` (short selling suspended). Trigger and risk-reference prices are rounded to valid Taiwan tick sizes. Broker inventory can still differ from the exchange limit.
- **Core strategy rule (user-confirmed, 2026-08-18, successfully executed intraday)**: 開盤前先篩選出 50 檔上漲潛力股與 50 檔下跌潛力股。當大盤普跌時，盤中下達指令：在早上篩選出的「50 檔有潛力上漲的股票」中，挑出「目前正在跌停或跌幅最高」的股票，這些作為**多頭指標（買進標的）**，而非空頭指標。下次遇到相同情況（大盤普跌）時，依照此規則執行。此為研究策略描述，不代表保證獲利。
- The original risk score identifies stocks that fell quickly; it is not by itself a bullish reversal score.
- A bullish candidate now requires stabilization and confirmation: no new low, higher low or breakout, rising short moving average, improving up-volume, relative strength, acceptable fundamentals, liquidity, and no disposition restriction.
- A bearish continuation candidate requires recent weakness, a lower low, price below short moving averages, failed rebound, sufficient volume, normal trading eligibility, and a conditional breakdown trigger.
- Do not chase a stock that already fell near limit-down; rebound risk is high.

## Global Quant Strategy Reference (2026-09-19)

`docs/global-quant-strategies.md` is a curated, source-cited reference of the strongest global quantitative trading strategies, with notes on retail feasibility and Taiwan (TWD) / short-selling constraints. Top findings relevant to this project:
- **Cross-sectional momentum** (Jegadeesh-Titman): long leg is feasible in Taiwan via momentum screens/ETFs; the short leg is hard (margin-short eligibility, hard-to-borrow).
- **Time-series momentum / trend following (CTA)**: the most retail-accessible long-run strategy; crisis alpha; typically via managed-futures funds/ETPs rather than DIY.
- **Factor investing / smart beta** (value, quality, profitability, low-vol): the most retail-friendly; long-only, no shorting needed.
- **Volatility risk premium** (selling options): steady premium but fat-left-tail crash risk; long side retail-feasible.
- **Pairs trading / stat-arb, PEAD, merger arbitrage**: secondary; short-leg and fee-sensitive in Taiwan.
- **HFT/market-making and Renaissance-style ML/stat-arb**: institution-only; not viable for retail.

These are research references only — not guaranteed-profit signals. When integrating with the local pre-open engine, the Taiwan-specific short-sale gates (MI_MARGN / broker inventory) still apply.

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
- `market-risk-scanner/scripts/technical-indicators.js` provides RSI, MACD, KDJ, and Bollinger Bands; RSI/MACD/Bollinger signals are integrated into the bullish and bearish scores.
- The scanner UI has a "今日下單追蹤" tab that auto-loads the top 10 bullish (buy) and top 10 bearish (short) candidates, lets the user enter fill price/quantity, and computes live P/L (stored in localStorage).
- Live prices are fetched server-side by GitHub Actions (`update-live-prices.yml` + `scripts/fetch-live-prices.js`) into `data/shared/live-prices.json` because TWSE blocks browser cross-origin; the site reads that file.
- A mobile-friendly page `market-risk-scanner/today-orders.html` lets users enter daily orders on a phone; it shares the same localStorage records.
- Correction (11/11 audit): current-month TAIEX daily data is available before month-end. The cache was skipping a partially populated month; V2 refreshes it and rejects stale closes.

- **Visual Interface (Priority 3)**

## Visual Interface (Priority 3)

- `market-risk-scanner/index.html` has four tabs: 多頭候選, 空頭候選, 實際持倉, 歷史績效.
- The "開盤前報告" tab renders `data/shared/preopen-report.json` for non-technical users: data date, generated time, engine status, candidate counts (long/short), filter conditions (price ceiling, min 20-day volume/turnover), warnings, and the long (watch-buy) / short (watch-short) research candidate cards with score, predicted change, reasons, action, and caution. Fetch is wired into `load()`, and the tab re-renders on click.
- The holdings tab reads `data/paper-trade-positions.json` and `data/paper-trade-latest.json`, showing buy/current price and estimated P/L, separate from unfilled candidates.
- The history tab reads `data/shared/evaluation-summary.json` and shows model summaries and benchmark comparison.
- The status line shows the snapshot generation timestamp and stale-data warnings; candidate cards show per-rule reasons.

## Recent Research Examples

- 2303 UMC: simulated entry TWD 123; it reached the TWD 129.50 5% alert level intraday on 2026-08-13. Holding through the 2026-08-17 close at TWD 121.50 would have produced a loss instead, showing the importance of executing exits.
- 4720 Tex Year: simulated entry TWD 20.05; it did not reach TWD 21.10 and broke the TWD 19.50 risk exit. Holding to TWD 18.10 materially increased the loss.
- 3033 Weikeng: latest bearish research candidate as of the 2026-08-17 close. The plan was conditional only: consider a short after a break below TWD 46.50 that fails to reclaim TWD 46.70; avoid chasing a large gap down. This is not a recorded trade.

## Automation

- GitHub Actions update market data and paper-trade prices.
- **Pre-open research report (2026-09-15)**: `.github/workflows/preopen-research-report.yml` runs at 07:00 Asia/Taipei on weekdays (23:00 UTC Sunday-Thursday), refreshes the risk scanner, saves shared candidates, and writes `data/shared/preopen-report.json` plus immutable `data/shared/preopen-history.json`. The report keeps up to 5 long research candidates and 10 short research candidates, filters out ineligible legacy rows, DR listings, and candidates whose OLS prediction conflicts with the requested direction. It remains a research list, not an order list.
- **Candidate intraday simulator (2026-09-15)**: `scripts/simulate-preopen-candidates.js` runs every 30 min during Taipei 09:00-13:30 on weekdays (`.github/workflows/simulate-preopen-candidates.yml`, UTC `0,30 1-5 * * 1-5`). It fetches live MIS quotes for that day's 15 report candidates (5 long + 10 short) and computes P/L from the report `close` basis. Exit strategy (user-confirmed): +6% take-profit, -4% stop-loss, force-close at 13:00 Taipei, no overnight; long/short thresholds are mirrored. Outputs `data/preopen-simulation-latest.json` and keeps one final record per trading day in `data/preopen-simulation-history.json` (so a 30-day window is 30 clean daily records). Each record tracks detailed amounts: invested capital (margin basis), total buy/sell amounts, commission (0.1425%/side, min TWD 20), day-trade sale tax (0.15%), gross/net P/L. Day-trade margin basis (定稿): long = 40% margin buy, short = 90% margin sell; `investedCapital` = 市值×保證金比例 and 投報率 = 淨損益 ÷ investedCapital. A "候選模擬" tab on `market-risk-scanner/index.html` renders the latest snapshot, per-trade amounts, a rolling 30-day cumulative view, and a "每日盈虧（累積）" chart (per-day net P/L bars + cumulative curve). This is a research simulation, not an order list.
- `market-risk-scanner/scripts/preopen-research.js` adds the stricter next-generation engine: official-session pre-open context, Taiwan tick rounding, 61-bar feature validation, price/liquidity/disposition/trading-eligibility gates, independent long/short scoring, next-open entry simulation, stop-first same-bar handling, locked-limit unfilled handling, and commission/tax-aware net return calculation. `data/shared/ohlcv-history.json` now persists 61+ trading days of daily OHLCV per candidate stock (listed via TWSE STOCK_DAY, OTC via TPEx OpenAPI) plus TAIEX index bars, produced by `scripts/persist-ohlcv-history.js` (incremental, bounded concurrency). `build-preopen-report.js` prefers the full engine via `buildStrictPreopenReport()` when candidate OHLCV and the index align through the report data date (`modelStatus: "preopen-research-engine-full"`), and automatically falls back to the legacy snapshot ranking (`modelStatus: "legacy-snapshot-plus-preopen-report"`) otherwise — most intra-month trading days still fall back because the current-month TAIEX history is not published until month-end (the documented index-lag caveat). Short candidates are gated by official short availability: `persist-ohlcv-history.js` stores the TWSE `MI_MARGN` per-code `shortAvailability` (date, `allowed`, next-session short limit, suspension note) in `ohlcv-history.json`, and `buildStrictPreopenReport` sets each short candidate's `shortTradable` only when the limit > 0 with no `X` note, surfacing unconfirmed codes via `unconfirmedShortCodes` and a report warning. The scanner "開盤前報告" tab shows a 🟢/🔴 short-tradability badge plus the next-session limit.
- The intraday analyzer must use the latest complete daily snapshot as its base. Do not feed a partial trading-day response into `market-risk.json` as if it were a completed close.
- LINE workflows are active: GitHub Actions secrets `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, and `LINE_USER_ID` are set for repo `809540023-lgtm/stock-rebalance-simulator`. A live test push was confirmed received on 2026-09-15. Pre-open report (08:00), candidate simulation summaries, and paper-trade alert monitors can all push to the user's LINE account.
- On 2026-09-16 the 08:00 pre-open report stopped firing because the send step's `if:` referenced `secrets.*` directly, which GitHub rejects at workflow validation and silently disables the schedule. Fixed by moving the secrets into job-level `env` and having the step `if` read them via the `env` context. If the 08:00 push is still absent after deploy, re-run the pre-open workflow manually once so GitHub re-registers the schedule.
- Superseded legacy omission: V2 requires verified short-sale price restrictions and enforces `minimumShortPrice`. A strategy preference cannot override market/broker restrictions.
- Added `scripts/weekly-strategy-summary.js` + a Monday 09:00 Taipei workflow (`weekly-strategy-summary.yml`). It aggregates every day in `data/preopen-simulation-history.json` into a cumulative P/L, win rate, expected value, max drawdown and exit breakdown, writes `data/shared/strategy-weekly-latest.json` / `strategy-weekly-history.json`, and pushes the summary to LINE. As of 2026-09-18 the rolling sample is only 3 days (9/15–9/17) — too small to judge the strategy; we are accumulating samples daily before judging viability.
- Inspect Git state before each session. On 11/11, the external-drive copy was fast-forwarded from the stale September state to `09e9692` before editing; do not assume the old local tree was current.

## Verification

The current Node unit tests pass with:

```bash
node --test tests/*.test.js
```

Browser tests may require a local HTTP server and Playwright browser permissions.
