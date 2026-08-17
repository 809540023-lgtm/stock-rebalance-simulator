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

- Priority 2 (long-term evaluation) and Priority 3 (visual tabs for holdings/history) are not yet implemented.

## Priority 2: Long-Term Evaluation

- Store signal date, trigger price, target, stop, maximum favorable excursion, maximum adverse excursion, exit reason, gross return, and net return.
- Produce 3-day, 5-day, and 20-day performance summaries.
- Compare model candidates against the TAIEX and against a simple random or liquidity-matched baseline.
- Report win rate, average net return, profit factor, maximum drawdown, and sample size.

## Priority 3: Visual Interface

- Add separate tabs for bullish candidates, bearish candidates, actual holdings, and historical performance.
- Display data timestamp and stale-data warnings prominently.
- Show why each candidate passed or failed each rule.
- Keep paper trades separate from unfilled candidates.

## Priority 4: Shared Agent Workflow

- Copilot and Codex must update `AI_CHANGELOG.md` after meaningful work.
- Work sequentially when touching shared files.
- Keep secrets in environment variables or platform secret stores only.

