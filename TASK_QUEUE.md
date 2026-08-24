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
