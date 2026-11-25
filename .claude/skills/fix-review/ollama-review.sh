#!/usr/bin/env bash
# CLI-tier helper for /fix-review.
# Reads the review prompt from stdin, calls an Ollama model (local or :cloud
# via the local daemon) through the native /api/chat endpoint, and writes
# the model's raw content to stdout.
# The parent skill expects a JSON array on stdout; non-JSON output is treated
# as 0 findings for this round (safe degradation).
#
# Usage (in config.yaml cli.cmd):
#   bash .claude/skills/fix-review/ollama-review.sh <model>

set -euo pipefail

MODEL="${1:?usage: $0 <model>}"
BASE_URL="${OLLAMA_HOST:-http://localhost:11434}"
SYS="Your entire response MUST be a raw JSON array — nothing else. Start with [ and end with ]. No prose, no markdown fences."
PROMPT=$(cat)

# Some cloud models return empty content on large prompts under load (no
# error, just a truncated/empty response body) — observed repeatedly with
# qwen3.5:cloud on full-diff review prompts. Retry once with a smaller
# max_tokens cap before giving up.
#
# Native /api/chat with think:false, not the OpenAI-compat /v1 endpoint:
# 2026-11-25 (PR #170) deepseek-v4.1-flash:cloud and minimax-m3:cloud spent
# the whole budget on hidden reasoning via /v1 and returned empty content on
# both attempts -> "[]" -> the round looked clean. With think:false both
# returned a valid JSON array (851 / 1524 tokens). Non-thinking models
# (gemma4, local granite/qwen-coder) accept think:false unchanged.
call_model() {
  local max_tokens="$1"
  curl -sf --max-time 180 \
    "${BASE_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
          --arg m "$MODEL" --arg sys "$SYS" --arg usr "$PROMPT" --argjson mt "$max_tokens" \
          '{model:$m,messages:[{role:"system",content:$sys},{role:"user",content:$usr}],stream:false,think:false,options:{num_predict:$mt}}')" \
    | jq -r '.message.content // empty'
}

CONTENT=$(call_model 4096 || true)

if [ -z "$(printf '%s' "$CONTENT" | tr -d '[:space:]')" ]; then
  echo "warn: $MODEL returned empty content — retrying once" >&2
  CONTENT=$(call_model 2048 || true)
fi

printf '%s' "${CONTENT:-[]}"
