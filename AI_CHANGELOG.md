# AI Changelog

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

