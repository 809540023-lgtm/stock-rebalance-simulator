# AI Changelog

## 2026-08-18 Copilot (Render live + strategy record)

- Deployed the static site to Render: https://stock-rebalance-simulator-site.onrender.com (service `srv-da261jrutv3s73bjdnl0`, deploy live).
- Recorded the user-confirmed core intraday strategy in `PROJECT_STATE.md`: 在大盤普跌時尋找空頭標的 (when the market broadly falls, focus on bearish-continuation candidates as short/hedge targets). Intraday candidates selected: 承啟(2425)、光鼎(6226)、德淵(4720)、上海商銀(5876)、臺企銀(2834).

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

