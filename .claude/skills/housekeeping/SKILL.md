---
name: housekeeping
description: "vmm-rada-web-ui recurring repo health check. Runs 7 checks (stale branches, console.log leaks, tracked .env, tracked backups, TODO/FIXME count, framework version drift, CI coverage delta) and outputs a pass/fail table. Usage: /housekeeping"
---

# Skill: /housekeeping
# vmm-rada-web-ui — Repo Health Check

---

## OVERVIEW

```
/housekeeping  →  7 checks  →  Markdown table: Check | Status | Detail
                            →  Summary: N passed, M failed
```

Read-only. Never modifies files, never commits, never opens a PR.
Run any time for a hygiene snapshot. Any FAIL = exit signal to fix before shipping.

---

## CHECKS

### Check 1 — Stale Local Branches

**Goal:** ≤ 10 local branches after pruning remote-tracking refs.

```bash
git remote prune origin 2>&1 | tail -3
LOCAL_COUNT=$(git branch | grep -v '^\*' | wc -l | tr -d ' ')
```

**Pass:** `LOCAL_COUNT <= 10`
**Fail:** "N local branches — prune merged ones"

Cleanup tip:
```bash
git branch --merged main | grep -v 'main\|^\*'
# delete with: git branch -d <branch>
```

---

### Check 2 — Debug Output in Source

**Goal:** Zero `console.log(` calls in production source (excluding test files).

```bash
FILES=$(grep -r --include="*.js" --include="*.jsx" \
  --exclude="*.test.*" --exclude="*.spec.*" \
  -l "console\.log(" src/ 2>/dev/null)
COUNT=$(echo "$FILES" | grep -c '.' 2>/dev/null || echo 0)
```

**Pass:** `COUNT == 0`
**Fail:** list offending files (up to 5, then "+ N more")

---

### Check 3 — Tracked .env File

**Goal:** `.env` must not be tracked by git (would leak secrets).

```bash
TRACKED=$(git ls-files .env 2>/dev/null)
```

**Pass:** empty result
**Fail:** "`.env` is tracked — add to .gitignore and run `git rm --cached .env`"

---

### Check 4 — Tracked Backup Files

**Goal:** `backup/` directory (if it exists) must not be tracked by git.

```bash
TRACKED=$(git ls-files backup/ 2>/dev/null)
```

**Pass:** empty result (or `backup/` doesn't exist)
**Fail:** list the tracked backup files

---

### Check 5 — TODO/FIXME Count (informational)

**Goal:** Report count. No threshold — visibility only.

```bash
COUNT=$(grep -r --include="*.js" --include="*.jsx" \
  -E "//\s*(TODO|FIXME)" \
  --exclude-dir=node_modules --exclude-dir=.git \
  src/ 2>/dev/null | wc -l | tr -d ' ')
```

**Status:** Always `INFO`.
**Detail:** "N TODO/FIXME comments" — append " (consider a cleanup sprint)" if > 20.

This check never contributes to the failed count.

---

### Check 6 — Framework Version Drift in Docs

**Goal:** No docs/agent files reference an older major version of React or Vite than what `package.json` actually pins.

```bash
CURRENT_REACT=$(grep -oP '"react":\s*"\^?\K[0-9]+' package.json | head -1)
CURRENT_VITE=$(grep -oP '"vite":\s*"\^?\K[0-9]+' package.json | head -1)

grep -rn --include="*.md" -oE "React [0-9]+|Vite [0-9]+" .claude/ docs/ CLAUDE.md 2>/dev/null \
  | awk -F: -v react="$CURRENT_REACT" -v vite="$CURRENT_VITE" '
    { match($0, /(React|Vite) ([0-9]+)/, m);
      if (m[1] == "React" && m[2] != react) print;
      if (m[1] == "Vite" && m[2] != vite) print;
    }'
```

**Pass:** no stale version mentions
**Fail:** list files containing the stale version reference

---

### Check 7 — CI Coverage Delta

**PLANNED** — not yet functional. `.github/workflows/ci.yml` exists and runs
`npm test` (`vitest run`), but neither `vite.config.js`'s `test` block nor
`package.json`'s `test` script enables Vitest's `--coverage` flag, so there
is no coverage artifact to diff against. Wiring actual coverage collection
is separate follow-up work (check `vite.config.js` first if picking this
up), not bundled into this skill's initial install.

Once coverage collection exists:

```bash
# Detect: gh run list --workflow=ci.yml, download coverage artifact,
# compare total line % between the last two successful main runs.
gh run list --workflow=ci.yml --status=completed --limit=5 \
  --json databaseId,headBranch,conclusion 2>/dev/null
```

- `DELTA >= 0`: Pass — "N% coverage (delta: +M%)"
- `DELTA < 0`: Fail — "N% coverage (delta: -M% — coverage regressed)"
- Unable to compare: SKIP — "coverage artifact not available"

---

## OUTPUT FORMAT

```
## /housekeeping — Repo Health Report

| Check | Status | Detail |
|-------|--------|--------|
| Stale local branches     | PASS | 4 local branches |
| Debug output in src      | PASS | — |
| Tracked .env              | PASS | — |
| Tracked backup files      | PASS | — |
| TODO/FIXME count           | INFO | 6 TODO/FIXME comments |
| Framework version drift    | PASS | — |
| CI coverage delta          | SKIP | PLANNED — coverage collection not wired up |

**5 passed, 0 failed** (1 informational, 1 skipped)
```

Status values:
- `PASS` — check succeeded
- `FAIL` — check failed (must be addressed)
- `INFO` — informational only, never counted as failed
- `SKIP` — could not run (missing tools, no artifacts, or marked PLANNED)

Summary: `N passed, M failed` — with optional `(K informational, J skipped)`.

---

## RULES

1. **Read-only** — never modify files, commit, push, or open a PR.
2. **Run from repo root** — all paths relative to repository root.
3. **INFO checks never count as failures** (TODO/FIXME is always INFO).
4. **SKIP is not failure** — a skipped or PLANNED check doesn't increment failed count.
5. **Graceful degradation** — if a tool is unavailable, mark check SKIP and continue.
6. **No auto-fix** — this skill reports; for fixes use the appropriate skill.
7. **Exit signal** — if any check is FAIL, end with: "Run /housekeeping again after fixing the issues above."
