# Shared AI Collaboration Rules

This repository is edited by Codex in the desktop app and Copilot in a local terminal. Both agents must treat the files in this repository as the shared source of truth.

## Before Working

1. Read `PROJECT_STATE.md`, `TASK_QUEUE.md`, and `AI_CHANGELOG.md`.
2. Run `git status --short --branch` and inspect existing changes before editing.
3. Preserve changes made by the other agent. Never reset, checkout, or overwrite unrelated work.
4. Do not store API keys, GitHub tokens, Render tokens, LINE secrets, or personal credentials in repository files.

## Working Rules

- Use official TWSE and TPEx data for market calculations.
- Label model output as research signals, not guaranteed investment advice.
- Separate deterministic calculations from AI-generated explanations.
- Include commissions and transaction tax in reported net returns.
- Exclude disposition securities from normal candidate lists unless the output explicitly discusses their restrictions.
- Do not mark a stock as purchased until the user provides an actual fill price and quantity.
- Avoid two agents editing the same file simultaneously.

## Finishing Work

1. Run the relevant tests.
2. Update `PROJECT_STATE.md` when behavior, deployment, holdings, or strategy changes.
3. Update `TASK_QUEUE.md` with completed and remaining work.
4. Append a concise entry to `AI_CHANGELOG.md` with files changed, tests run, and any blocker.
5. Commit coherent changes with an agent prefix such as `codex:` or `copilot:` when Git access is available.

