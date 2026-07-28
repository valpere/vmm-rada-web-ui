#!/bin/bash
# Stop hook: scans the session transcript for a win/mistake worth logging per
# .claude/skills/self-learn/SKILL.md's schema, and appends directly to
# _patterns/wins.jsonl / mistakes.jsonl if the model finds one.
#
# Why this exists: the PostToolUse prompt-nudge ("consider /self-learn log")
# alone did not produce any logged patterns — both pattern files sat at 0
# bytes for weeks despite the nudge firing on every Edit/Write. A reminder
# that isn't acted on is barely better than no reminder. This hook removes
# the "remember to log it" step entirely: the Stop hook already fires
# reliably every session (session-end.sh/session-index.sh both depend on it
# and both stay current), so pattern logging rides the same guarantee.
#
# Runs independently of session-end.sh — reads its own excerpt from the
# transcript rather than depending on session-end.sh's output, so it still
# fires if session-end.sh exits early (e.g. /session-end already ran).
#
# Bar for logging is deliberately conservative (see PROMPT below) — most
# sessions have nothing worth logging, and a hook that logs too eagerly
# defeats the purpose of a curated pattern store.
#
# Output: appends one line to _patterns/wins.jsonl or _patterns/mistakes.jsonl
# (both gitignored, per-project local learning log).

set -uo pipefail

# shellcheck source=_lib/hook-common.sh
source "$(dirname "$0")/_lib/hook-common.sh"
hook_setup_logging "session-self-learn.sh"

INPUT=$(cat)
echo "[$(date -Iseconds)] session-self-learn invoked" >> "$LOG_FILE"

PROJECT_ROOT="$(dirname "$0")/../.."
PATTERNS_DIR="$PROJECT_ROOT/_patterns"
TODAY=$(date '+%Y-%m-%d')
PROJECT_NAME="vmm-rada-web-ui"

TRANSCRIPT=$(echo "$INPUT" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || echo "")

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  PROJECT_HASH=$(pwd | sed 's|/|-|g')
  TRANSCRIPT=$(ls -t "$HOME/.claude/projects/$PROJECT_HASH"/*.jsonl 2>/dev/null | head -1 || echo "")
fi

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  echo "[$(date -Iseconds)] session-self-learn: no transcript found, skipping" >> "$LOG_FILE"
  exit 0
fi

# Same excerpt shape as session-end.sh (last 30 user/assistant exchanges,
# 600 chars each) — independent read, not a dependency on that script.
EXCERPT=$(python3 - "$TRANSCRIPT" <<'PYEOF'
import json, sys

messages = []
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            msg = entry.get('message', {})
            role = msg.get('role', '')
            content = msg.get('content', '')
            if role not in ('user', 'assistant'):
                continue
            text = ''
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'text':
                        text += block.get('text', '')
            elif isinstance(content, str):
                text = content
            text = text.strip()
            if text:
                messages.append(f"[{role}]: {text[:600]}")
        except Exception:
            pass

print('\n\n'.join(messages[-30:]))
PYEOF
)

if [[ -z "$EXCERPT" ]]; then
  echo "[$(date -Iseconds)] session-self-learn: empty transcript, skipping" >> "$LOG_FILE"
  exit 0
fi

PROMPT="Review this Claude Code session transcript. Decide if anything happened
that matches one of these two patterns:

MISTAKE — something went wrong that cost real rework (not a typo caught
instantly), a banned pattern was used, or the agent guessed instead of
verifying and it produced a wrong result.

WIN — something worked well in a genuinely non-obvious way: a good judgment
call, effective delegation/planning, or a design decision that was
challenged and confirmed correct. Task success alone is NOT a win — most
sessions succeed; that is not noteworthy.

Bar for logging: be conservative. Most sessions have NOTHING worth logging.
Only flag a pattern that would help a future session avoid the same mistake
or repeat the same good judgment call.

If nothing qualifies, respond with exactly: NONE

If a MISTAKE qualifies, respond with ONLY this JSON (no prose, no markdown fences, no extra fields):
{\"task\":\"<one sentence>\",\"mistake\":\"<one sentence>\",\"resolution\":\"<one sentence>\",\"pattern\":\"<one sentence, generalizable>\",\"severity\":\"low|medium|high\",\"category\":\"wrong_assumption|missed_context|didnt_ask|skipped_planning|tooling_error|context_waste|api_error|banned_pattern|other\",\"had_verification\":true|false,\"session_hygiene\":\"kitchen_sink|correction_spiral|context_overload|null\"}

If a WIN qualifies, respond with ONLY this JSON (no prose, no markdown fences, no extra fields):
{\"task\":\"<one sentence>\",\"win\":\"<one sentence>\",\"pattern\":\"<one sentence, reusable>\",\"reusable_in\":\"<one sentence>\",\"had_verification\":true|false,\"used_plan_mode\":true|false,\"delegation\":\"subagent|manual|none\",\"decomposed\":true|false}

Before writing any field, strip API keys, tokens, credentials, or personal
data — summarize the lesson, never quote a secret.

SESSION TRANSCRIPT:
$EXCERPT"

# is_none_response / is_json_response distinguish the three valid outcomes
# from a model that ignored instructions and returned chit-chat — mirrors
# session-end.sh's is_valid_summary guard, adapted for this hook's ternary
# output (NONE | mistake-JSON | win-JSON) instead of a single summary shape.
is_none_response() {
  [[ "$(echo "$1" | tr -d '[:space:]')" == "NONE" ]]
}

is_json_response() {
  [[ "$1" == \{* ]] && [[ "$1" == *\} ]]
}

try_agy() {
  local models=(
    "Gemini 3.5 Flash (Low)"
    "Gemini 3.5 Flash (Medium)"
    "Gemini 3.1 Pro (Low)"
  )
  command -v agy &>/dev/null || return 1
  for model in "${models[@]}"; do
    echo "[$(date -Iseconds)] session-self-learn: trying agy model: $model" >> "$LOG_FILE"
    local result
    result=$(timeout 45 agy -p "$1" --model "$model" 2>>"$LOG_FILE") && \
      { is_none_response "$result" || is_json_response "$result"; } && { echo "$result"; return 0; }
    echo "[$(date -Iseconds)] session-self-learn: agy model $model returned unusable output" >> "$LOG_FILE"
  done
  return 1
}

PROMPT_TMP=$(mktemp /tmp/session-self-learn-prompt.XXXXXX)
echo "$PROMPT" > "$PROMPT_TMP"
trap 'rm -f "$PROMPT_TMP"' EXIT

try_opencode() {
  local models=(
    "ollama/glm-5.2:cloud"
    "ollama/qwen3.5:cloud"
  )
  command -v opencode &>/dev/null || return 1
  for model in "${models[@]}"; do
    echo "[$(date -Iseconds)] session-self-learn: trying opencode model: $model" >> "$LOG_FILE"
    local result
    result=$(timeout 45 opencode run "Follow the instructions in the attached file exactly." \
      --file "$PROMPT_TMP" --model "$model" --format json 2>>"$LOG_FILE" | \
      python3 -c "
import json,sys
parts=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try:
        obj=json.loads(line)
        if obj.get('type')=='text':
            parts.append(obj['part']['text'])
    except: pass
print(''.join(parts).strip())
") && { is_none_response "$result" || is_json_response "$result"; } && { echo "$result"; return 0; }
    echo "[$(date -Iseconds)] session-self-learn: opencode model $model returned unusable output" >> "$LOG_FILE"
  done
  return 1
}

RESULT=""
RESULT=$(try_agy "$PROMPT" 2>>"$LOG_FILE") || true

if [[ -z "$RESULT" ]]; then
  RESULT=$(try_opencode 2>>"$LOG_FILE") || true
fi

if [[ -z "$RESULT" ]]; then
  echo "[$(date -Iseconds)] session-self-learn: all LLMs failed, skipping this session" >> "$LOG_FILE"
  exit 0
fi

if is_none_response "$RESULT"; then
  echo "[$(date -Iseconds)] session-self-learn: NONE — nothing worth logging" >> "$LOG_FILE"
  exit 0
fi

# Validate strictly and inject date/project deterministically (never trust
# the model for these two fields — it has no reliable way to know "today"
# and no reason to ever return a different project name than this hook's
# own PROJECT_NAME). Malformed JSON or a field outside its enum is logged
# and dropped, never appended — a corrupted jsonl line is worse than a
# missed log entry.
mkdir -p "$PATTERNS_DIR"
python3 - "$RESULT" "$TODAY" "$PROJECT_NAME" "$PATTERNS_DIR" <<'PYEOF' >> "$LOG_FILE" 2>&1
import json, sys

raw, today, project, patterns_dir = sys.argv[1:5]

try:
    obj = json.loads(raw)
except Exception as e:
    print(f"session-self-learn: model output was not valid JSON: {e}")
    sys.exit(0)

MISTAKE_SEVERITY = {"low", "medium", "high"}
MISTAKE_CATEGORY = {
    "wrong_assumption", "missed_context", "didnt_ask", "skipped_planning",
    "tooling_error", "context_waste", "api_error", "banned_pattern", "other",
}
MISTAKE_HYGIENE = {"kitchen_sink", "correction_spiral", "context_overload", "null", None}
DELEGATION = {"subagent", "manual", "none"}

def is_bool(v):
    return isinstance(v, bool)

def is_nonempty_str(v):
    return isinstance(v, str) and v.strip() != ""

if "mistake" in obj:
    required_str = ["task", "mistake", "resolution", "pattern"]
    if not all(is_nonempty_str(obj.get(k)) for k in required_str):
        print("session-self-learn: mistake JSON missing required string field(s)")
        sys.exit(0)
    if obj.get("severity") not in MISTAKE_SEVERITY:
        print(f"session-self-learn: mistake JSON invalid severity: {obj.get('severity')!r}")
        sys.exit(0)
    if obj.get("category") not in MISTAKE_CATEGORY:
        print(f"session-self-learn: mistake JSON invalid category: {obj.get('category')!r}")
        sys.exit(0)
    if not is_bool(obj.get("had_verification")):
        print("session-self-learn: mistake JSON had_verification not a bool")
        sys.exit(0)
    hygiene = obj.get("session_hygiene")
    if hygiene not in MISTAKE_HYGIENE:
        print(f"session-self-learn: mistake JSON invalid session_hygiene: {hygiene!r}")
        sys.exit(0)
    entry = {
        "date": today,
        "project": project,
        "task": obj["task"],
        "mistake": obj["mistake"],
        "resolution": obj["resolution"],
        "pattern": obj["pattern"],
        "severity": obj["severity"],
        "category": obj["category"],
        "had_verification": obj["had_verification"],
        "session_hygiene": None if hygiene in ("null", None) else hygiene,
    }
    target = f"{patterns_dir}/mistakes.jsonl"
    with open(target, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"session-self-learn: appended mistake ({entry['category']}, {entry['severity']}) to {target}")

elif "win" in obj:
    required_str = ["task", "win", "pattern", "reusable_in"]
    if not all(is_nonempty_str(obj.get(k)) for k in required_str):
        print("session-self-learn: win JSON missing required string field(s)")
        sys.exit(0)
    if not is_bool(obj.get("had_verification")):
        print("session-self-learn: win JSON had_verification not a bool")
        sys.exit(0)
    if not is_bool(obj.get("used_plan_mode")):
        print("session-self-learn: win JSON used_plan_mode not a bool")
        sys.exit(0)
    if obj.get("delegation") not in DELEGATION:
        print(f"session-self-learn: win JSON invalid delegation: {obj.get('delegation')!r}")
        sys.exit(0)
    if not is_bool(obj.get("decomposed")):
        print("session-self-learn: win JSON decomposed not a bool")
        sys.exit(0)
    entry = {
        "date": today,
        "project": project,
        "task": obj["task"],
        "win": obj["win"],
        "pattern": obj["pattern"],
        "reusable_in": obj["reusable_in"],
        "had_verification": obj["had_verification"],
        "used_plan_mode": obj["used_plan_mode"],
        "delegation": obj["delegation"],
        "decomposed": obj["decomposed"],
    }
    target = f"{patterns_dir}/wins.jsonl"
    with open(target, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"session-self-learn: appended win to {target}")

else:
    print("session-self-learn: JSON had neither 'mistake' nor 'win' key, dropping")
PYEOF

echo "[$(date -Iseconds)] session-self-learn: done" >> "$LOG_FILE"
