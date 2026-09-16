# Task Queue

## Priority 1: Separate Bullish and Bearish Models

- [x] Create separate deterministic scores for bullish reversal confirmation and bearish continuation.
- [x] Do not reuse the decline-risk score as a buy recommendation.
- [x] Add filters for price ceiling (default 50), minimum volume, disposition status, and trading eligibility.
- [x] Save every daily candidate snapshot to `data/shared/bullish-latest.json` and `data/shared/bearish-latest.json`, with immutable per-date history in `data/shared/bullish-history.json` and `data/shared/bearish-history.json`.

### Implementation notes

- `market-risk-scanner/scripts/models.js` holds pure `computeBullishScore`, `computeBearishScore`, `applyFilters`, and `staleness` functions.
- `update-risk-data.js` computes both scores per stock, applies filters, and writes `candidates.bullish` / `candidates.bearish` into `market-risk.json`.
- `save-shared-candidates.js` reads `market-risk.json` and writes the latest + history candidate files; it is wired into the `update-market-risk-scanner.yml` workflow after data generation.
- `index.html` shows separate bullish and bearish candidate tabs with pass/fail reasons and a stale-data warning.

### Remaining

- Priority 4 (shared agent workflow) is ongoing; keep secrets out of the repository and update `AI_CHANGELOG.md` after meaningful work.

## Priority 2: Long-Term Evaluation

- [x] Store signal date, trigger price, target, stop, maximum favorable excursion, maximum adverse excursion, exit reason, gross return, and net return.
- [x] Produce 3-day, 5-day, and 20-day performance summaries.
- [x] Compare model candidates against the TAIEX and against a simple random or liquidity-matched baseline.
- [x] Report win rate, average net return, profit factor, maximum drawdown, and sample size.

### Implementation notes

- `market-risk-scanner/scripts/evaluation.js` holds pure `buildTradeRecord`, `summarizeTrades`, and `compareToBaseline` functions.
- `market-risk-scanner/scripts/evaluate-candidates.js` generates historical signals, computes forward returns, and writes `data/shared/evaluation.json`.
- Trade records include entry/target/stop, MFE/MAE, exit reason, gross/net return, and 3/5/20-day returns. Net return subtracts commission (0.1425% per side) and 0.3% sale tax.
- Benchmarks: TAIEX 20-day forward return and a liquidity-matched baseline (all stocks with average volume >= 500,000).

## Priority 3: Visual Interface

- [x] Add separate tabs for bullish candidates, bearish candidates, actual holdings, and historical performance.
- [x] Display data timestamp and stale-data warnings prominently.
- [x] Show why each candidate passed or failed each rule.
- [x] Keep paper trades separate from unfilled candidates.

### Implementation notes

- `market-risk-scanner/index.html` now has four tabs: 多頭候選, 空頭候選, 實際持倉, 歷史績效.
- Holdings tab reads `data/paper-trade-positions.json` and `data/paper-trade-latest.json`, showing buy/current price and estimated P/L; kept separate from unfilled candidates.
- History tab reads `data/shared/evaluation-summary.json` (a small summary of `evaluation.json`) and shows model summaries and benchmark comparison.
- The status line shows the snapshot generation timestamp and stale-data warnings.

## Priority 4: Shared Agent Workflow

- Copilot and Codex must update `AI_CHANGELOG.md` after meaningful work.
- Work sequentially when touching shared files.
- Keep secrets in environment variables or platform secret stores only.
- [x] Add a reusable TWSE MIS intraday analyzer that preserves the latest complete daily snapshot and requires model/relative-strength/forecast direction agreement.

## Priority 5: Pre-open Quant Research Upgrade

- [x] Add a strict pre-open research engine with Taiwan tick sizes, 61-bar feature validation, liquidity/price/disposition/trading-eligibility gates, next-open simulation, stop-first same-bar handling, locked-limit unfilled handling, and fee/tax-aware net returns.
- [x] Add a 07:00 Asia/Taipei GitHub Actions workflow that refreshes scanner data and publishes `data/shared/preopen-report.json` plus immutable `data/shared/preopen-history.json`.
- [x] Keep the published report capped at 5 long candidates and 10 short candidates, and filter out legacy rows that are ineligible, DR listings, or direction-conflicting with the OLS prediction.
- [ ] Persist 61+ trading days of OHLCV history per stock so `preopen-research.js` can fully replace the legacy snapshot ranking in the published report.
- [ ] Add broker-side short inventory / borrow availability confirmation before labeling any short candidate as tradable.
- [ ] Add a UI panel for `preopen-report.json` so non-technical users can view the 07:00 long/short report directly on the scanner page.

## Priority 6: Daily Pre-open Candidate Intraday Simulator

- [x] Add `scripts/simulate-preopen-candidates.js` to simulate the given day's 15 report candidates (5 long + 10 short) at intraday moments using official TWSE MIS live quotes, with a fill at the report `close` basis.
- [x] Implement the user-confirmed exit strategy: +6% take-profit, -4% stop-loss, force-close at 13:00 Taipei, no overnight; long/short thresholds mirrored.
- [x] Include commission (0.1425%/side, min TWD 20) and 0.3% sale transaction tax in net P/L, per AGENTS.md.
- [x] Add `data/preopen-simulation-latest.json` (overwrite) and `data/preopen-simulation-history.json` (append) outputs.
- [x] Add `.github/workflows/simulate-preopen-candidates.yml` running every 30 min during Taipei 09:00-13:30 on weekdays.
- [x] Add `tests/preopen-simulation.test.js` covering tick sizes, long/short exits, and force-close.
- [x] Add a "候選模擬" tab to `market-risk-scanner/index.html` rendering the latest simulation snapshot (report date, net P/L, exit counts, long/short tables with live prices and exit status).
- [x] Report detailed per-trade amounts: quantity, buy/sell price and amount, commission, sale tax, gross/net P/L; plus snapshot totals for buy, sell, commission, and tax.
- [x] Keep one final simulation record per trading day (`marketDate`) so a 30-day window is 30 clean daily records.
- [x] Add daily fund detail and a rolling 30-day cumulative view (days, net P/L, return %, invested capital, buy/sell, commission, tax) to the 候選模擬 tab.
- [x] Switch to day-trade margin basis (定稿): long = 40% margin buy, short = 90% margin sell, day-trade sale tax 0.15%, invested capital = 市值×保證金比例, 投報率 = 淨損益 ÷ investedCapital.
- [x] Add a "每日盈虧（累積）" chart to the 候選模擬 tab showing per-day net P/L bars plus a cumulative curve and cumulative-detail card.
- [x] Enable LINE push: `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, and `LINE_USER_ID` are set as repo secrets; a live test push was confirmed received on 2026-09-15. Pre-open report (08:00), candidate simulation summaries, and paper-trade alert monitors can now push to the user's LINE.

## Priority 7: Restore 08:00 Pre-open Report Schedule

- [x] Diagnose why the 08:00 pre-open report LINE push stopped firing on 2026-09-16: the send step's `if:` referenced `secrets.LINE_USER_ID` / `secrets.LINE_CHANNEL_*` directly, which GitHub rejects at workflow validation; the failing validation also disables the workflow's `schedule` trigger, so the 08:00 run never started.
- [x] Fix `.github/workflows/preopen-research-report.yml`: move LINE secrets to job-level `env` and make the send step's `if` read them via the `env` context; require `LINE_USER_ID` plus either a long-lived token OR (channel id + secret). No secrets stored in the repo.
- [ ] Deploy the fix and re-run the pre-open workflow manually once so GitHub re-registers the schedule; confirm the 08:00 push the following morning. Until then, the simulate workflow and other LINE pushes continue to run unaffected.
