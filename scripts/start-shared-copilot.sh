#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec copilot \
  -C "$project_root" \
  --context long_context \
  -i "請先完整閱讀 AGENTS.md、PROJECT_STATE.md、TASK_QUEUE.md 與 AI_CHANGELOG.md。把這些檔案視為目前專案與兩個 AI 之間的共享記憶。先執行 git status，摘要目前狀態與尚未完成的最高優先任務；不要覆蓋其他代理的修改，不要把任何 API Token 寫入專案。完成工作後更新 PROJECT_STATE.md、TASK_QUEUE.md 與 AI_CHANGELOG.md。"
