---
name: fix-review
description: Multi-model PR review pipeline. Dispatches the diff concurrently to 3 reviewer models (config.yaml), tallies vote counts per finding (informational), then Claude acts as arbiter (CONFIRM / DISMISS / DEFER) and merges when clean. Invoke with an optional PR number (defaults to the current branch's open PR). Dependabot PRs are handled by the global dependabot-reviewer agent, not this skill.
user-invocable: true
argument-hint: "[pr-number]"
metadata:
  version: "2.3.0"
  domain: code-review
  scope: quality-gate
  debt-level: balanced
---

# /fix-review

Multi-model PR review pipeline for vmm-rada-web-ui.

For Dependabot PRs, use the global `dependabot-reviewer` agent
(`~/.claude/agents/dependabot-reviewer.md`) instead — risk-based SemVer
triage, not this pipeline.

## Code Review Pyramid (arbiter evaluates in this order — base first)

```
        ▲
       /5\    Style       → NEVER flagged — ESLint handles this
      /---\
     / 4   \  Tests       → Critical paths covered? (Vitest + Testing Library)
    /-------\
   /    3    \ Docs        → Complex logic explained?
  /           \
 /      2      \ Implementation → Bugs, null checks, stale closures, SSE
/_______________\                 handling, XSS/security, performance
       1          Architecture   → Adapter-boundary violations, state
                                    writes outside App.jsx, raw HTML
                                    rendering of LLM output
```

**Priority:** Layer 1 errors → Layer 1 warnings → Layer 2 errors → Layer 2 warnings → Layer 3–4 → suggestions. An architectural flaw makes implementation fixes irrelevant — always fix from the base up.

**Layer 1 checks are the four immutable rules in `.claude/context-essentials.md`** — components stay pure UI, `src/api.js` is the sole adapter boundary, `App.jsx` owns all state, `react-markdown` is the only LLM-output renderer. Treat any diff that violates these as a Layer 1 error regardless of what the reviewer models flag.

## Pipeline

```
Diff-shape gate: does the diff touch src/, package(-lock).json,
vite.config.js, eslint.config.js, .github/workflows/, or
.claude/{skills,agents}/?
  yes → REVIEWER_COUNT=3 (full dispatch, below)
  no  → REVIEWER_COUNT=1 (round_1 only — diffs outside all of the above
                           yield 0 findings × 3 reviewers every time observed
                           so far, e.g. docs/, context-essentials.md)
       ↓
Concurrent dispatch (config.yaml reviewers.openrouter.*, REVIEWER_COUNT of them):
  Reviewer model 1 (round_1) ──┐
  Reviewer model 2 (round_2) ──┼──→ JSON findings arrays   (3-reviewer path only)
  Reviewer model 3 (round_3) ──┘
       ↓
  Vote tally: group by file:line, attach count N/REVIEWER_COUNT (informational only)
  All findings reach the arbiter — votes do not gate
       ↓
  Arbiter (Claude, main instance)
    → full diff + all findings with vote metadata
    → CONFIRM / DISMISS / DEFER each finding
    → fix CONFIRM findings → commit+push
    → post PR comment with vote table
    → merge if no CONFIRM blockers remain
```

Note: `config.yaml` uses `round_1/round_2/round_3` keys for historical reasons — these
are concurrent dispatches, not sequential rounds. The models to use are always read from
`config.yaml`; do not hardcode model names here.

Three tiers, tried in order per round when the one above it is unavailable:
1. **Cloud** (`reviewers.openrouter`) — the default path.
2. **External agents** (`reviewers.external_agents`) — free-tier CLI tools
   (cursor-agent, omp, codex, opencode, kilo; see `.claude/skills/lib/agents.sh`),
   engages when the Ollama cloud endpoint is unreachable or has none of the
   configured models loaded.
3. **CLI** (`reviewers.cli`, actually local Ollama despite the key name) —
   last resort, engages only if every external agent above also failed.

## Step-by-step execution

### 0. Resolve PR

If an argument was given, use that PR number. Otherwise run:
```bash
gh pr view --json number,headRefName,state,author
```
Confirm the PR is open. If `author.login == "dependabot[bot]"`, stop and
tell the user to invoke the `dependabot-reviewer` agent instead — this
skill is for human-authored PRs. Store the PR number as `$PR`, then
validate it's a plain integer before it gets interpolated into any git
ref name in later steps:
```bash
[[ "$PR" =~ ^[0-9]+$ ]] || { echo "error: PR number must be numeric, got: $PR" >&2; exit 1; }
```

### 1. Fetch the full diff

`gh pr diff $PR` has been observed silently returning an `rtk`-compacted
summary instead of the actual diff (PR #58) — no error, just a few lines
that look plausible but aren't the real change. Use `git diff` against the
real merge-base as the primary source; `gh pr diff` is only a fallback for
sandboxes with no cloned `origin` remote or no fetch access to `pull/*/head`.

This skill assumes PRs target `main`. If a PR ever targets another base
branch, replace the hardcoded `main` below with the actual base from
`gh pr view $PR --json baseRefName`.

```bash
git fetch origin "pull/$PR/head:pr-$PR"
DIFF=$(git diff main...pr-$PR)
TOUCHED=$(git diff --name-only main...pr-$PR)

# Sanity check: a real diff for a PR that touched files should never be
# this short — catches the rtk-compacted-summary failure mode.
if [ -n "$TOUCHED" ] && [ "$(printf '%s' "$DIFF" | wc -l)" -lt 50 ]; then
  echo "warn: diff looks suspiciously short for the files touched — re-fetching" >&2
  git fetch origin "pull/$PR/head:pr-$PR" --force
  DIFF=$(git diff main...pr-$PR)
fi

# Fallback if the fetch above failed (no origin, no pull/*/head access):
# DIFF=$(gh pr diff $PR)

git branch -D "pr-$PR" 2>/dev/null || true
```

Store `$DIFF` as the **baseline diff** (used in dispatch and arbiter pass).

### 1.5. Diff-shape gate

Check whether the diff touches any **security-relevant surface** — not just
`src/`. Supply-chain files (`package.json`, `package-lock.json`), build/lint
toolchain configs (`vite.config.js`, `eslint.config.js` — a tampered build
config can inject code into production output; a tampered lint config can
silently disable security-relevant rules), CI workflow files
(`.github/workflows/`), and prompt/agent-behavior files (`.claude/skills/`,
`.claude/agents/`) all warrant full scrutiny even when `src/` itself is
untouched — a compromised dependency pin, a malicious CI step, or an edited
agent prompt (including edits to *this skill*) are exactly the kind of
change three independent reviewers exist to catch:

```bash
git diff --name-only main...<branch> | grep -qE '^(src/|package(-lock)?\.json$|vite\.config\.js$|eslint\.config\.js$|\.github/workflows/|\.claude/(skills|agents)/)' \
  && NEEDS_FULL_REVIEW=true || NEEDS_FULL_REVIEW=false
```

If `NEEDS_FULL_REVIEW=false` (none of the above matched — e.g. `docs/`,
`context-essentials.md`, `_patterns/`, README-only PRs), set
`REVIEWER_COUNT=1` and dispatch **only `round_1`** in Step 3. Three cloud
models × zero yield has been the observed steady state for these diffs (PRs
#75, #87, #89, #90 — 0 findings × 3 reviewers, every time), and the blast
radius of a doc-only mistake is low enough that a single reviewer plus the
arbiter's independent scan is adequate.

If `NEEDS_FULL_REVIEW=true`, set `REVIEWER_COUNT=3` (the existing behavior,
unchanged) — this includes mixed diffs (e.g. `src/` *and* `.claude/` in the
same PR) and PRs that edit this skill's own files.

`REVIEWER_COUNT` drives which models Step 3 calls and what Step 6's PR
comment reports.

### 2. Load reviewer config

Read `.claude/skills/fix-review/config.yaml`. Extract:
- `reviewers.openrouter.round_1/2/3` — cloud reviewer models
- `openrouter_api_url` — Ollama endpoint (`http://localhost:11434/v1/chat/completions`)
- `reviewers.external_agents` — ordered list of free-tier CLI tools, tier 2
- `reviewers.cli` — local failover models, tier 3 (used if cloud AND every
  external agent failed)

First, extract the actual model names you just read from `config.yaml`:
```bash
# Use the exact model name strings from reviewers.openrouter.round_1/2/3
ROUND1="<exact round_1 model string>"   # e.g. qwen3.5:cloud
ROUND2="<exact round_2 model string>"   # e.g. minimax-m2.7:cloud
ROUND3="<exact round_3 model string>"   # e.g. gemma4:31b-cloud
```

Then probe the endpoint:
```bash
MODELS_JSON=$(curl -sf --max-time 5 http://localhost:11434/v1/models 2>/dev/null)

if [ -z "$MODELS_JSON" ]; then
  TIER="external_agents"
  echo "⚠️  Ollama endpoint unreachable — trying external_agents tier"
else
  # Extract model IDs robustly (handles spaces after colon in JSON)
  AVAILABLE=$(echo "$MODELS_JSON" | grep -oP '"id"\s*:\s*"\K[^"]+')
  if echo "$AVAILABLE" | grep -qF "$ROUND1" \
     || echo "$AVAILABLE" | grep -qF "$ROUND2" \
     || echo "$AVAILABLE" | grep -qF "$ROUND3"; then
    TIER="cloud"
  else
    TIER="external_agents"
    echo "⚠️  Ollama online but none of the configured models loaded — trying external_agents tier"
    echo "    Expected one of: $ROUND1 | $ROUND2 | $ROUND3"
  fi
fi
```

If `TIER="cloud"`, Step 3 dispatches via `ollama-review.sh` as before. Otherwise
(`TIER="external_agents"`), Step 3 tries each dispatched round against
`reviewers.external_agents` (`.claude/skills/lib/agents.sh`) first; a round
falls through to `reviewers.cli` (tier 3, real local Ollama despite the `cli`
key name) only if every external agent for that round also failed/returned
empty.

### 3. Concurrent review dispatch

Build the review prompt combining the baseline diff with instructions. The
prompt opens with an immutable **Project facts** block so reviewers stop
asserting verifiable facts — this was the source of 6 of 14 dismissed
findings in the 2026-W30 dreaming corpus ("project has no test suite",
"Vite 7→8 possibly unverified", "future date 2026-07-07" 13 days past,
etc.).

The current date is injected at run time via `date -u +%Y-%m-%d` rather than
hardcoded — the skill is read once and reused across many sessions, so
hardcoding would itself become a fabricated-fact source. Version facts use
"current major" wording so the block survives Vite 9 / React 20 without a
follow-up edit. Total preamble stays under ~1k tokens — token budget
matters for `qwen3.5:cloud`, which has been observed to return empty
content on large prompts (see `ollama-review.sh:18-21`).

```bash
# Project facts block (~6 bullets, ≤1k tokens). Keep terse — do not add examples.
PROJECT_FACTS=$(cat <<'EOF'
## Project facts (immutable, do not contradict)
- Plain JavaScript project. NO TypeScript anywhere (banned project-wide).
- Vitest is present (`npm test`). A test suite exists and runs in CI.
- React 19 + Vite 8 (current majors). Exact versions: see package.json.
- Today's date is $(date -u +%Y-%m-%d). Do not flag a date as "future" unless it is after this.
- .claude/** files are agent/Claude Code instructions, not runtime code.
- Layer-1 immutable rules (from .claude/context-essentials.md):
  (1) components are pure UI — no fetch/api.js calls in any component;
  (2) src/api.js is the sole adapter boundary — onEvent(type, event) is the only interface App.jsx sees;
  (3) App.jsx owns all state via setCurrentConversation;
  (4) react-markdown is the only renderer for LLM output — no raw HTML.
EOF
)

INSTRUCTIONS='Review the PR diff below. Return ONLY a raw JSON array of
findings — no prose, no markdown fences. Each finding:
{"file":"path","line":N,"layer":1-4,"severity":"error|warn|sugg","description":"..."}.

Do NOT flag unless you can cite a concrete defect in the diff above. Layer 5
(style) is never flagged. The Code Review Pyramid (see header) is the only
arbiter — do not invent project facts not in the Project facts block above.'

# PROMPT is what gets piped to ollama-review.sh:diff + project facts + instructions.
PROMPT="${PROJECT_FACTS}

${INSTRUCTIONS}

--- DIFF ---
$(cat baseline.diff)"
```

Send the prompt to each reviewer model, routed through whichever tier is
active (`$TIER` from Step 2). The external-agent adapters read their prompt
from a file, not a shell variable, so write it once. `lib/agents.sh` requires
`yq` and `jq` on `PATH` (used to parse `reviewers.external_agents` from
config.yaml and each tool's JSON output envelope) — both are personal-machine
prerequisites for this skill already, same category as `ollama serve` and
the external-agent CLIs themselves, not something CI needs:

```bash
PROMPT_FILE=$(mktemp)
printf '%s' "$PROMPT" > "$PROMPT_FILE"

source .claude/skills/lib/agents.sh
RUN_DIR=$(mktemp -d)

# CLI2/CLI3 not needed if REVIEWER_COUNT=1. reviewers.cli has no round_N
# keys (unlike reviewers.openrouter) — map positionally, list order = round order.
CLI1="<exact reviewers.cli[0] model>"   # e.g. qwen3-coder:30b
CLI2="<exact reviewers.cli[1] model>"   # e.g. qwen2.5-coder:7b
CLI3="<exact reviewers.cli[2] model>"   # e.g. granite3.3:8b

dispatch_round() {
  local n="$1" cloud_model="$2" cli_model="$3"
  case "$TIER" in
    cloud)
      cat "$PROMPT_FILE" | bash .claude/skills/fix-review/ollama-review.sh "$cloud_model"
      ;;
    external_agents)
      if try_external_agents "$n" "$PROMPT_FILE" .claude/skills/fix-review/config.yaml "$RUN_DIR"; then
        cat "$RUN_DIR/round_${n}.raw.json"
      else
        echo "warn: round $n — all external_agents failed, falling back to local Ollama (cli tier)" >&2
        cat "$PROMPT_FILE" | bash .claude/skills/fix-review/ollama-review.sh "$cli_model"
      fi
      ;;
    *)
      # $TIER should only ever be "cloud" or "external_agents" (set in Step 2)
      # — an unset/typo'd value must not silently degrade to "0 findings" and
      # look like a clean review. Fail loudly instead.
      echo "error: dispatch_round: unrecognized \$TIER='$TIER' — check Step 2's probe logic" >&2
      exit 1
      ;;
  esac
}
```

The number of rounds called depends on `REVIEWER_COUNT` from Step 1.5:

**`REVIEWER_COUNT=3`** (diff touches a security-relevant surface — default, unchanged behavior):
```bash
R1=$(dispatch_round 1 "$ROUND1" "$CLI1")
R2=$(dispatch_round 2 "$ROUND2" "$CLI2")
R3=$(dispatch_round 3 "$ROUND3" "$CLI3")
```

**`REVIEWER_COUNT=1`** (no security-relevant surface touched):
```bash
R1=$(dispatch_round 1 "$ROUND1" "$CLI1")
```
Skip R2/R3 entirely — do not call them, and treat their findings as absent
(not as empty-array votes) when tallying.

Once every round needed has been dispatched, clean up — the prompt file
contains the PR diff, and `$RUN_DIR` may contain external-agent output,
neither of which should linger in `/tmp`:
```bash
rm -f "$PROMPT_FILE"
rm -rf "$RUN_DIR"
```

Each call returns a JSON array (empty `[]` on parse failure — safe degradation).
The JSON output contract (raw array, `file/line/layer/severity/description`)
is preserved — the project-facts block changes input context, not parse contract.
Record which tier actually produced each round's result (cloud model name,
external-agent tool name from `$RUN_DIR/round_${n}.failover`, or cli model
name) — Step 6's PR comment reports this per round, not just the configured
cloud model.

### 4. Tally findings

Merge all called reviewers' arrays (1 or 3, per `REVIEWER_COUNT`). Group findings
by `file:line`. For each unique `file:line`, count how many of the dispatched
models flagged it.

Attach `votes: N/REVIEWER_COUNT` to each finding as **informational metadata
only** (e.g. `1/3` when `REVIEWER_COUNT=3`, `1/1` when `REVIEWER_COUNT=1`). All
findings are passed to the arbiter regardless of vote count — votes are a
confidence signal, not a gate. The arbiter's dismiss rate (~80%) is the actual
filter.

### 5. Arbiter pass (Claude, main instance)

Re-fetch the full diff post-dispatch (should be unchanged, but confirms branch state), using the same `git diff` primary / `gh pr diff` fallback path as Step 1:
```bash
git fetch origin "pull/$PR/head:pr-$PR"
DIFF=$(git diff main...pr-$PR)
git branch -D "pr-$PR" 2>/dev/null || true
# Fallback: DIFF=$(gh pr diff $PR)
```

For each finding (ordered Layer 1 first), apply the Code Review Pyramid:

| Ruling | Meaning | Action |
|--------|---------|--------|
| **CONFIRM** | Real issue, correctly identified | Fix it |
| **ESCALATE** | Real issue, more severe than flagged | Fix it, note severity upgrade |
| **DISMISS** | False positive or conflicts with project patterns | Skip, note reason |
| **DEFER** | Valid concern, out of scope for this PR | Create a GitHub issue |

Also run an **independent scan** of the full diff — look for anything the models missed,
especially violations of the four immutable rules in `context-essentials.md` (a direct
`fetch`/`api.js` call from a component, a state write outside `App.jsx`, raw HTML
rendering of LLM output, a new competing renderer).

For CONFIRM/ESCALATE findings:
1. Apply the fix using Edit.
2. Commit + push:
```bash
git add <files>
git commit -m "fix(pr#$PR): arbiter — address confirmed findings"
git push
```

For DEFER findings:
```bash
gh issue create --title "..." --body "..."
```

### 6. Post PR comment

Post a single collapsible summary. The `Models:` line lists only the rounds
actually dispatched (per `REVIEWER_COUNT` from Step 1.5) — never claim three
reviewers ran when only `round_1` was called — and names **what actually
produced each round's result**, not just the configured cloud model: if
`$TIER=cloud`, that's the cloud model; if a round fell through to
`external_agents`, name the tool that succeeded (from
`$RUN_DIR/round_${n}.failover`); if it fell all the way to `cli`, name the
local model:

```
<details>
<summary>/fix-review — parallel pass · N findings · N confirmed · N dismissed · N deferred</summary>

| File:Line | Votes | Layer | Sev | Ruling | Note |
|-----------|-------|-------|-----|--------|------|
| src/components/Stage2.jsx:42 | 2/3 | 2 | error | CONFIRM | missing null check on metadata.label_to_model |
| src/api.js:87 | 1/3 | 5 | sugg | DISMISS | style — not flagged by pyramid |

Models: round_1=<round_1_model>, round_2=<round_2_model>, round_3=<round_3_model> (from config.yaml)
Arbiter: Claude Sonnet 4.6

</details>
```

For a `REVIEWER_COUNT=1` pass (no security-relevant surface touched), the
`Models:` line lists only round 1, and vote counts read `N/1` instead of
`N/3`. Example of a mixed-tier pass: `Models: round_1=cursor-agent (auto)
[external_agents], round_2=minimax-m2.7:cloud [cloud], round_3=granite3.3:8b
[cli]`.

### 7. Merge decision

Run before merging:
```bash
npm run lint
npm test
```
Block merge if either fails.

**Proceed to merge** if:
- No unresolved CONFIRM blockers remain
- All High-severity security findings are CONFIRM (fixed) or DISMISS (justified)
- `npm run lint` and `npm test` both pass

**Block merge** if:
- Any unfixed High-severity security finding exists
- Lint or tests fail

Merge with squash:
```bash
gh pr merge $PR --squash --delete-branch
```

Then sync main:
```bash
git checkout main && git pull
```

## Exit conditions

| State | Action |
|-------|--------|
| All findings arbitrated, no blockers | Merge |
| Cloud endpoint unreachable | Fall back to CLI tier, proceed |
| Model returns non-JSON | Treat as 0 findings for that model, proceed |
| Round fails to push | Stop, report error to user |
| PR already merged | Report and exit |
| PR has merge conflicts | Stop, ask user to resolve |
| `npm run lint` or `npm test` fails | Fix if trivial and in scope, else block merge and report |
| PR authored by dependabot[bot] | Stop, direct user to `dependabot-reviewer` agent |
