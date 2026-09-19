# AI Changelog

## 2026-09-19 Copilot (global quant strategy reference)

- Added `docs/global-quant-strategies.md`, a cited, curated reference of the strongest global quantitative trading strategies (momentum, trend/CTA, factor/smart beta, volatility risk premium, pairs/stat-arb, PEAD, merger arb, HFT/ML) with evidence levels (backtested vs live), capacity/decay, and retail/Taiwan short-selling feasibility notes.
- Added a "## Global Quant Strategy Reference" section to `PROJECT_STATE.md` with the top findings and how they map to this Taiwan pre-open engine (short-sale gates still apply).
- Context: the working copy was backed up to AG external drive and removed from the Mac; this canonical copy is on GitHub `origin/main`. Full backup: `/Volumes/ag/backup-all-2026-09-19_095609/`.
- Files changed: `docs/global-quant-strategies.md` (new), `PROJECT_STATE.md`, `AI_CHANGELOG.md`.

## 2026-09-19 Copilot (short availability confirmation in the pre-open report)

- `persist-ohlcv-history.js` now fetches the official TWSE `MI_MARGN` margin-short report (stepping back up to 5 days until published) and stores `shortAvailability: { date, byCode: { code: { allowed, nextDayLimit, note } } }` plus `meta.shortEligibilityDate` in `data/shared/ohlcv-history.json`.
- `build-preopen-report.js` `buildStrictPreopenReport` now annotates every short candidate with `shortTradable`, `shortEligibilityDate`, `shortNextDayLimit`, and `shortNote`, setting `tradable` only when the next-session short limit > 0 with no `X` suspension note. Unconfirmed codes are collected in `unconfirmedShortCodes` and reported as a warning; report-level `shortEligibilityDate` reflects the confirmation date.
- Scanner UI (`poCard`) shows a 🟢「確認融券可放空」/ 🔴「未確認融券庫存」 badge plus next-session limit on short candidate cards in the 開盤前報告 tab.
- Verified live: 9/10 shorts confirmed tradable; 2601 益航 flagged `shortTradable=false` (limit 0, note `OX`) and listed as unconfirmed with a warning.
- Tests: 2 new `buildStrictPreopenReport` short-gating cases; updated Playwright pre-open tab case to assert a short badge exists. Full suite: 84 unit + 7 Playwright pass.
- Caveat: official MI_MARGN short availability is not a specific broker's live inventory; per-broker borrow/借券 confirmation is still required at order time.
- Files changed: `market-risk-scanner/scripts/persist-ohlcv-history.js`, `market-risk-scanner/scripts/build-preopen-report.js`, `market-risk-scanner/index.html`, `tests/preopen-report.test.js`, `tests/market-risk-scanner.spec.js`, `TASK_QUEUE.md`, `PROJECT_STATE.md`, `AI_CHANGELOG.md`, regenerated `data/shared/ohlcv-history.json` and `data/shared/preopen-report.json`.

## 2026-09-18 Copilot (persist OHLCV history for the strict pre-open engine)

- Added `market-risk-scanner/scripts/persist-ohlcv-history.js`: accumulates 61+ trading days of daily OHLCV per candidate stock into `data/shared/ohlcv-history.json` (plus TAIEX index bars). Listed (上市) via official TWSE `STOCK_DAY` monthly endpoint; OTC (上櫃) via TPEx OpenAPI `tpex_mainboard_daily_close_quotes` (whole-market per day, includes Open/High/Low). Persistence is incremental (`monthsNotPresent` skips months already stored) and uses bounded concurrency (`mapLimit`). Candidate universe caps at top 30 bullish + 30 bearish.
- Wired `node scripts/persist-ohlcv-history.js` into `.github/workflows/preopen-research-report.yml` before building the report (committed via the existing `data/shared` path).
- Reworked `market-risk-scanner/scripts/build-preopen-report.js`: added `buildStrictPreopenReport()` that feeds `ohlcv-history.json` bars + index into `rankPreopenCandidates()` to rank via the full 61-bar engine when aligned through the report data date (`modelStatus: "preopen-research-engine-full"`), and falls back to the legacy snapshot ranking otherwise (`modelStatus: "legacy-snapshot-plus-preopen-report"`). `savePreopenReport()` now uses this path. Report now carries an `engineDetail` note and updated `sourceFiles`.
- Added tests: `tests/preopen-ohlcv.test.js` (9 cases: ROC date conversion, TWSE/TPEx/TAIEX parsing, bar merge, month listing, `monthsNotPresent`, candidate universe) and 3 new `buildStrictPreopenReport` cases (strict path, legacy fallback, misaligned-index fallback).
- Regenerated live `data/shared/ohlcv-history.json` (30+ candidate series, 116-118 bars each) and `preopen-report.json` via the strict engine.
- Caveat: most intra-month trading days still fall back to legacy ranking because the current-month TAIEX history isn't published until month-end (documented index-lag); persistence ensures the engine activates once the index aligns.
- Tests run: `node --test tests/preopen-ohlcv.test.js tests/preopen-report.test.js tests/preopen-research.test.js` (29 pass). Full suite pending final run.
- Files changed: `market-risk-scanner/scripts/persist-ohlcv-history.js` (new), `market-risk-scanner/scripts/build-preopen-report.js`, `.github/workflows/preopen-research-report.yml`, `tests/preopen-ohlcv.test.js` (new), `tests/preopen-report.test.js`, `PROJECT_STATE.md`, `TASK_QUEUE.md`, `AI_CHANGELOG.md`, plus regenerated `data/shared/ohlcv-history.json` and `preopen-report.json`.

## 2026-09-18 Copilot (pre-open report UI panel)

- Added a "開盤前報告" tab to `market-risk-scanner/index.html` (`panel-preopen`) so non-technical users can view the 07:00 research report directly on the scanner page. It renders `data/shared/preopen-report.json`: data date, generation time, engine status, long/short candidate counts, filter conditions (price ceiling, min 20-day volume/turnover), warnings, and long (`watch-buy`) / short (`watch-short`) candidate cards with rank, score, predicted change, reasons, action, and caution. Fetch wired into `load()`; the tab re-renders on click.
- Added `renderPreopen()` + `poCard()` helpers; added `preopenData` state.
- Added `tests/market-risk-scanner.spec.js` case "pre-open report tab renders the latest research report".
- Tests run: `node --test tests/*.test.js` (70 pass) and `npx playwright test tests/market-risk-scanner.spec.js --project=desktop` (7 pass, incl. the new pre-open tab case).
- Files changed: `market-risk-scanner/index.html`, `tests/market-risk-scanner.spec.js`, `PROJECT_STATE.md`, `TASK_QUEUE.md`, `AI_CHANGELOG.md`.

## 2026-09-18 Copilot (weekly strategy summary)

- Added `scripts/weekly-strategy-summary.js`: aggregates every day in `data/preopen-simulation-history.json` into cumulative net P/L, total return %, win rate, expected value (avg daily), max drawdown (TWD and %), and exit breakdown; renders a Chinese LINE-friendly summary. Writes `data/shared/strategy-weekly-latest.json` (overwrite) + `strategy-weekly-history.json` (append), and pushes the summary to LINE via job-level env credentials.
- Added `.github/workflows/weekly-strategy-summary.yml`: runs every Monday 09:00 Taipei (`0 1 * * 1`) plus `workflow_dispatch`. LINE secrets are passed via job-level `env` (never `secrets.*` in an `if:`, learning from the 9/16 schedule outage).
- Added `tests/weekly-strategy-summary.test.js` (5 cases). Full suite: 70 tests pass.
- Context: strategy sample is only 3 trading days (9/15–9/17). The plan is to accumulate one daily simulation record per trading day and judge viability only after a meaningful sample (weeks), not on 3 days.
- Files changed: `scripts/weekly-strategy-summary.js`, `.github/workflows/weekly-strategy-summary.yml`, `tests/weekly-strategy-summary.test.js`, `PROJECT_STATE.md`, `TASK_QUEUE.md`, `AI_CHANGELOG.md`.

## 2026-09-16 Copilot (restore 08:00 pre-open report schedule)

- Root cause: `.github/workflows/preopen-research-report.yml` send step's `if:` referenced `secrets.LINE_USER_ID` / `secrets.LINE_CHANNEL_*` directly. GitHub rejects that at workflow validation (step job counts = 0) and disables the workflow's `schedule` trigger, so the 08:00 pre-open run never fired on 2026-09-16 and no LINE push was sent. Other schedule-based workflows kept running normally, which confirmed the issue was specific to this file.
- Fix: moved the four LINE secrets to job-level `env` and changed the send step's `if` to read them via the `env` context: fires when `LINE_USER_ID` is set AND (long-lived `LINE_CHANNEL_ACCESS_TOKEN` OR (`LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET`)). Corrected the previous logic that wrongly required `LINE_CHANNEL_SECRET` even for a long-lived-token setup.
- Files changed: `.github/workflows/preopen-research-report.yml`, `PROJECT_STATE.md`, `TASK_QUEUE.md`, `AI_CHANGELOG.md`.
- Tests: `node --test tests/preopen-report.test.js tests/preopen-research.test.js tests/preopen-simulation.test.js tests/line-market-alerts.test.js` — 20/20 pass. YAML re-validated (`YAML OK`).
- Remaining: deploy and re-run the pre-open workflow manually once so GitHub re-registers the schedule; verify the next-morning 08:00 push.

## 2026-09-15 Copilot (LINE notifications enabled)

- Acquired the user's personal LINE userId (`U1901968...f2ba4`) via a webhook capture over an HTTP/2 cloudflared tunnel (after localtunnel's POST/503 issues), and pushed a live end-to-end test message that the user confirmed received.
- Set GitHub Actions secrets `LINE_CHANNEL_ID` (2011605044), `LINE_CHANNEL_SECRET`, and `LINE_USER_ID` for repo `809540023-lgtm/stock-rebalance-simulator`. No secrets stored in the repository.
- With secrets present, these push flows are now live: 08:00 pre-open report LINE push (`send-preopen-line.js`), the intraday candidate simulation summary, and paper-trade alert monitors. The simulate workflow already forwards the channel/secrets/user-id to the script.
- Kept the user's decision to NOT add a "平盤以下禁空" (no-short-below-flat) filter, since shorting is the strategy's main side. The short-sale transaction-tax fix (`b536872`) remains.

## 2026-09-15 Copilot (fix short-sale transaction tax side)

- Fixed `scripts/simulate-preopen-candidates.js` so the day-trade sale transaction tax is charged on the correct side: long positions tax the exit (sell) price; short (margin sell) positions now tax the opening sell at the base price instead of the buy-back price, since the tax applies on the short-sale opening. `sideFees` now takes the position side. Regenerated today's simulation data.

## 2026-09-15 Copilot (fix LINE push auth)

- Fixed `market-risk-scanner/scripts/send-preopen-line.js` so the 08:00 pre-open report LINE push now accepts either a long-lived `LINE_CHANNEL_ACCESS_TOKEN` or a runtime-derived token from `LINE_CHANNEL_ID` + `LINE_CHANNEL_SECRET` (matching the other LINE scripts). Previously only the long-lived token path existed, so a Channel ID+Secret setup would silently skip the push.
- Updated `.github/workflows/preopen-research-report.yml` send step's `if` gate to evaluate `secrets` (not a step-scoped `env`, which is unavailable in its own `if`) and to require the recipient `LINE_USER_ID` plus at least one auth path.
- Verified the runtime token endpoint returns a valid token with the provided Channel ID+Secret; no secrets stored in the repo.

## 2026-09-15 Copilot (daily pre-open candidate simulator)

- Added `scripts/simulate-preopen-candidates.js`, an intraday simulator over the daily pre-open report's 15 candidates (5 long + 10 short). Each run fetches official TWSE MIS live quotes, then computes per-candidate P/L assuming a fill at the report's `close` basis.
- Per-trade detail now includes: quantity, buy price/amount, sell price/amount, margin ratio (invested amount), commission (0.1425%/side, min TWD 20), day-trade sale transaction tax (0.15%), gross/net P/L. Snapshot aggregates include total buy amount, total sell amount, total commission, total tax.
- Day-trade margin basis (user-confirmed, 定稿): long uses margin buy at 40% self-provided capital, short uses margin sell at 90% deposit; sale transaction tax is 0.15% because positions close the same day. `investedCapital` is the margin-basis capital and `netPct` (投報率) is computed as net P/L ÷ investedCapital.
- Added a "每日盈虧（累積）" chart to the 候選模擬 tab showing per-day net P/L bars (green=profit/red=loss) plus a cumulative curve, with a cumulative-detail card (days, cumulative net P/L, return %, invested capital).
- Exit strategy (user-confirmed): take-profit +6%, stop-loss -4%, force-close at 13:00 Taipei (30 min before the 13:30 close), no overnight holding. Long/short thresholds are mirrored.
- History now keeps only the final snapshot per trading day (keyed by `marketDate`), so a 30-day window is 30 clean daily records for cumulative analysis.
- The "候選模擬" tab on `market-risk-scanner/index.html` now shows per-trade amounts, daily fund detail (invested capital, total buy/sell, fees, commission, tax), and a 30-day cumulative view (days, net P/L, return %, invested, buy/sell, commission, tax), plus the long/short tables with live prices and exit status.
- Added `.github/workflows/simulate-preopen-candidates.yml` to run every 30 min during Taipei 09:00-13:30 on weekdays.
- Added `tests/preopen-simulation.test.js` covering tick sizes, long/short take-profit/stop-loss, force-close, and summary formatting.
- Optional LINE push when `LINE_USER_ID` and channel secrets are configured (currently not set, so push is skipped).
- Tests run: `node --test tests/*.test.js` (65 pass); `npx playwright test tests/market-risk-scanner.spec.js --project=desktop` (6 pass incl. the simulation-tab test).

## 2026-09-15 Codex (pre-open quant research upgrade)

- Added `market-risk-scanner/scripts/preopen-research.js`, a strict pre-open research engine with Taipei 07:00 context, Taiwan tick-size rounding, 61-bar feature validation, independent long/short scoring, price/liquidity/disposition/trading-eligibility gates, next-open simulation, stop-first same-bar handling, locked-limit unfilled handling, and commission/tax-aware net returns.
- Added `market-risk-scanner/scripts/build-preopen-report.js` to publish `data/shared/preopen-report.json` and append immutable records to `data/shared/preopen-history.json`.
- Added `.github/workflows/preopen-research-report.yml` to refresh scanner data and generate the report at 07:00 Asia/Taipei on weekdays.
- Added `tests/preopen-research.test.js` and `tests/preopen-report.test.js`.
- Updated `PROJECT_STATE.md` and `TASK_QUEUE.md` with the new report flow and remaining data-layer work.
- Tests run: `node --test tests/*.test.js` (59 pass).
- Note: the published report currently uses existing shared candidate snapshots with stronger report-level filters. Full replacement by the strict engine requires persisting 61+ trading days of OHLCV history per symbol.

## 2026-08-24 Codex (intraday directional analysis)

- Added `market-risk-scanner/scripts/analyze-intraday-market.js` to combine the latest complete daily snapshot with official TWSE MIS intraday quotes for listed and OTC candidates.
- Added three-way direction confirmation: daily model, performance relative to the live TAIEX, and OLS forecast must agree before a stock enters the intraday bullish or bearish list.
- Regenerated the complete 2026-08-24 close and tomorrow's preliminary list after the TAIEX closed down 461.97 points. Added official TWSE `MI_MARGN` next-session short eligibility checks and Taiwan tick-size rounding; stopped/zero-limit short symbols are excluded.
- Added price/quote timestamps, estimated-price flags, observation triggers, risk references, source coverage, and explicit short-eligibility cautions to `market-risk-scanner/data/intraday-analysis.json`.
- Avoided treating the partial 2026-08-24 daily-close response as a completed all-market snapshot.
- Tests run: `node --check market-risk-scanner/scripts/analyze-intraday-market.js`; all Node unit tests passed, including new tick-size and short-restriction coverage.

## 2026-08-21 Copilot (TradingView real-time chart)

- Embedded a TradingView real-time chart into the scanner UI (`market-risk-scanner/index.html`): a "即時圖表（TradingView）" panel with a symbol input and interval selector, using the TradingView widget (dark theme, Taiwan stocks via TWSE:CODE).

## 2026-08-20 Copilot (international tools list)

- Added TradingView and Backtrader to `docs/github-stock-analysis-references.md` as recommended international stock analysis tools.

## 2026-08-20 Copilot (technical indicators)

- Added `market-risk-scanner/scripts/technical-indicators.js` with RSI, MACD, KDJ, and Bollinger Bands (pure functions).
- Integrated RSI/MACD/Bollinger signals into the bullish and bearish models: bullish gets "RSI 走強 / MACD 轉多 / 站上布林中軌"; bearish gets "RSI 轉弱 / MACD 走空 / 跌破布林中軌".
- Added `tests/technical-indicators.test.js`; regenerated candidate data through 2026-08-19.
- Tests run: `node --test tests/*.test.js` (45 pass) and `npx playwright test` (21 pass, 1 skipped).

## 2026-08-20 Copilot (default order quantity)

- Pre-filled the order quantity input to 10 shares in the trade tracker (index.html) and mobile page (today-orders.html) so users don't need to type it; still editable.

## 2026-08-20 Copilot (friendlier copy)

- Rewrote the scanner and mobile page copy in a warmer, more human tone: friendlier subtitles, hints, and explanations across the candidate, holdings, history, and trade-tracker sections.

## 2026-08-19 Copilot (dark professional UI theme)

- Redesigned the scanner UI (`market-risk-scanner/index.html`) and the mobile order page (`today-orders.html`) with a dark, app-like theme inspired by 投資先生: dark gradient background, card-based panels, and clear red (down) / green (up) color coding.

## 2026-08-19 Copilot (auto live-price refresh)

- The trade tracker (index.html) and mobile page (today-orders.html) now auto-refresh live prices every 60 seconds while the trades tab is open, so P/L updates without clicking.

## 2026-08-19 Copilot (holdings delete + mobile page + live prices)

- Holdings tab: added a checkbox column with "全選" and a "刪除選取" button so users can delete only selected custom holdings (instead of clearing all).
- Added a mobile-friendly standalone page `market-risk-scanner/today-orders.html` for entering daily orders on a phone; shares the same localStorage records as the main page.
- Fixed the "更新即時價" CORS error: TWSE MIS blocks browser cross-origin, so live prices are now fetched server-side by a new GitHub Actions workflow (`update-live-prices.yml` + `scripts/fetch-live-prices.js`) into `data/shared/live-prices.json`, which the site reads.
- Added a Playwright test for deleting selected holdings.
- Tests run: `node --test tests/*.test.js` (40 pass) and `npx playwright test` (21 pass, 1 skipped).

## 2026-08-19 Copilot (today's trade tracker)

- Added a "今日下單追蹤" tab to `market-risk-scanner/index.html`: auto-loads today's top 10 bullish (buy) and top 10 bearish (short) candidates; user enters fill price and quantity, records the order, and the page computes live P/L (buy vs short), with totals stored in localStorage.
- A "更新即時價" button fetches TWSE MIS live prices (falls back to candidate latest close if the browser blocks cross-origin).
- Regenerated candidate data through 2026-08-19 for the next trading day.
- Added a Playwright test for the trade tracker.
- Tests run: `node --test tests/*.test.js` (40 pass) and `npx playwright test` (19 pass, 1 skipped).

## 2026-08-18 Copilot (integrate alphalens + StockPricePrediction)

- Added `market-risk-scanner/scripts/factor-analysis.js` (alphalens concept): IC (rank correlation of score vs forward return), quantile returns, and factor spread.
- Added `market-risk-scanner/scripts/price-prediction.js` (StockPricePrediction concept): OLS linear-regression next-price/direction/change prediction.
- Wired factor analysis into `evaluate-candidates.js` (per-model IC, quantiles, spread) and price prediction into `update-risk-data.js` candidate data; both shown in the scanner UI (history tab IC/spread, candidate cards predicted change/price).
- Added `tests/factor-analysis.test.js` and `tests/price-prediction.test.js` (10 tests).
- Regenerated candidate and evaluation data through 2026-08-18.
- Tests run: `node --test tests/*.test.js` (40 pass) and `npx playwright test` (17 pass, 1 skipped).

## 2026-08-18 Copilot (GitHub reference list)

- Added `docs/github-stock-analysis-references.md` listing the top 5 highest-starred stock-analysis repositories on GitHub (daily_stock_analysis, alphalens, stocksight, Stock_Analysis_For_Quant, StockPricePrediction).
- Confirmed the pre-open screening pipeline is current: `data/shared/bullish-latest.json` and `bearish-latest.json` each hold 50 candidates through 2026-08-18 (not stale).

## 2026-08-18 Copilot (self-input holdings)

- Added a holdings input form to the scanner UI (`market-risk-scanner/index.html`): users can add a position (code, name, buy price, buy quantity, buy date, target) and record a sell (sell quantity, sell date) for each custom holding.
- Custom holdings and sell records persist in the browser via localStorage; a "清除自訂持倉" button clears them.
- Added a Playwright test for adding a custom holding.
- Tests run: `node --test tests/*.test.js` (30 pass) and `npx playwright test` (17 pass, 1 skipped).

## 2026-08-18 Copilot (strategy on website)

- Added the confirmed core strategy rule to the scanner UI (`market-risk-scanner/index.html`): 開盤前篩選 50 檔上漲潛力股與 50 檔下跌潛力股；大盤普跌時，在「50 檔上漲潛力股」中挑出「正在跌停或跌幅最高」的股票作為多頭（買進）標的。

## 2026-08-18 Copilot (Render live + strategy record)

- Deployed the static site to Render: https://stock-rebalance-simulator-site.onrender.com (service `srv-da261jrutv3s73bjdnl0`, deploy live).
- Recorded the user-confirmed core intraday strategy in `PROJECT_STATE.md`: 開盤前篩選 50 檔上漲潛力股與 50 檔下跌潛力股；當大盤普跌時，在「50 檔上漲潛力股」中挑出「正在跌停或跌幅最高」的股票作為**多頭指標（買進標的）**，而非空頭指標。下次遇到大盤普跌時依此規則執行。

## 2026-08-18 Copilot (deployment)

- Pushed local work and merged remote changes (Codex paper-trade work, workflow data updates) into `origin/main`.
- Regenerated `market-risk.json` and `data/shared` candidate files through 2026-08-18.
- Enabled GitHub Pages (`https://809540023-lgtm.github.io/stock-rebalance-simulator/`) with a `deploy-pages.yml` workflow.
- Added `render.yaml` blueprint for a Render static site.
- Tests run: `node --test tests/*.test.js` (30 pass) and `npx playwright test` (15 pass, 1 skipped).

## 2026-08-18 Copilot (holdings sell fields)

- Added 買入數量, 買入日期, 賣出數量, and 賣出日期 columns to the holdings tab in `market-risk-scanner/index.html`.
- Sell quantity and sell date default to "—" until a sell record is provided in the positions data.

## 2026-08-18 Copilot (default ranking)

- Changed the default ranking count of the weak-stock table in `market-risk-scanner/index.html` from 30 to 50.

## 2026-08-18 Copilot (Priority 3 UI)

- Implemented Priority 3: visual interface with four tabs (多頭候選, 空頭候選, 實際持倉, 歷史績效) in `market-risk-scanner/index.html`.
- Holdings tab reads `data/paper-trade-positions.json` and `data/paper-trade-latest.json`, showing buy/current price and estimated P/L, separate from unfilled candidates.
- History tab reads `data/shared/evaluation-summary.json` (small summary of the full `evaluation.json`).
- Status line shows the snapshot generation timestamp and stale-data warnings.
- Added `data/shared/evaluation-summary.json` output to `evaluate-candidates.js`.
- Updated `tests/market-risk-scanner.spec.js` to cover the four tabs.
- Tests run: `node --test tests/*.test.js` (30 pass) and `npx playwright test` (15 pass, 1 skipped).

## 2026-08-18 Copilot (Priority 2 evaluation)

- Implemented Priority 2: long-term evaluation of candidate signals.
- Added `market-risk-scanner/scripts/evaluation.js` with pure `buildTradeRecord`, `summarizeTrades`, and `compareToBaseline` (win rate, avg net return, profit factor, max drawdown, sample size, 3/5/20-day returns, MFE/MAE, exit reason, net return after fees).
- Added `market-risk-scanner/scripts/evaluate-candidates.js` generating historical signals and forward returns, writing `data/shared/evaluation.json`.
- Added `tests/evaluation.test.js` (8 unit tests).
- Generated evaluation data for signals 2026-06-15 to 2026-07-20: 3,221 bullish and 4,160 bearish trades; both models beat the TAIEX and the liquidity-matched baseline.
- Tests run: `node --test tests/*.test.js` (30 pass).

## 2026-08-18 Copilot (UI + limit)

- Limited candidate snapshots to the top 50 per model (`DEFAULT_MAX_CANDIDATES = 50` in `save-shared-candidates.js`); regenerated `data/shared/*-latest.json` and `*-history.json`.
- Replaced the candidate tables in `market-risk-scanner/index.html` with visual score cards: colored score bar, rank, code/name/market/price, and reason chips (green for bullish, red for bearish).
- Added a unit test for the 50-candidate limit and updated the Playwright tab test for the card layout.
- Tests run: `node --test tests/*.test.js` (22 pass) and `npx playwright test` (15 pass, 1 skipped).

## 2026-08-18 Copilot

- Implemented Priority 1: separate bullish reversal and bearish continuation models.
- Added `market-risk-scanner/scripts/models.js` with pure `computeBullishScore`, `computeBearishScore`, `applyFilters` (price ceiling default 50, liquidity, disposition, trading eligibility) and `staleness`.
- Updated `update-risk-data.js` to fetch the TWSE disposition list, compute both scores per stock, expose `tradingEligible`, and write `candidates.bullish` / `candidates.bearish` into `market-risk.json`.
- Added `market-risk-scanner/scripts/save-shared-candidates.js` writing `data/shared/bullish-latest.json` and `data/shared/bearish-latest.json`, plus immutable per-date history in `data/shared/*-history.json`. Wired into `update-market-risk-scanner.yml`.
- Added bullish/bearish candidate tabs and a stale-data warning to `market-risk-scanner/index.html`.
- Added tests: `tests/models.test.js` (scoring, filters, staleness) and `tests/save-shared-candidates.test.js` (snapshot build, history merge).
- Regenerated `market-risk-scanner/data/market-risk.json` and candidate files through 2026-08-17. Did not modify `data/paper-trade-positions.json`.
- Tests run: `node --test tests/*.test.js` (21 pass) and `npx playwright test` (15 pass, 1 skipped).
- Remaining: Priority 2 (long-term evaluation) and Priority 3 (visual tabs for holdings/history).

## 2026-08-18 Codex

- Added shared collaboration instructions and project handoff files for Codex and terminal Copilot.
- Documented current holdings, fee rules, strategy corrections, recent research examples, and queued work.
- No credentials were copied into the repository.
