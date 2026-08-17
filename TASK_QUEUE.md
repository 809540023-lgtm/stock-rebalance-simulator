# Task Queue

## Priority 1: Separate Bullish and Bearish Models

- Create separate deterministic scores for bullish reversal confirmation and bearish continuation.
- Do not reuse the decline-risk score as a buy recommendation.
- Add filters for price ceiling, liquidity, disposition status, and trading eligibility.
- Save every daily candidate before the market opens so later results cannot be rewritten.

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

