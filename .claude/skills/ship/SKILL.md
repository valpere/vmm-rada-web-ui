---
name: ship
description: Implement a GitHub issue end-to-end — branch, code, tests, PR, /fix-review, merge, resolve. Without args, shows top 5 unblocked issues to select from. With issue number or title, ships that issue directly. One issue at a time.
user-invocable: true
argument-hint: "[issue-number | issue-title]"
metadata:
  version: "3.0"
  domain: workflow
  scope: pr-lifecycle
  debt-level: balanced
---

# /ship

Implement one GitHub issue from selection to merged PR, then present the next.

```
select issue → branch → implement → pre-PR review (parallel) → pre-flight → PR → /fix-review → merge → resolve → next
```

## Rules

- **One issue at a time.** Never work on multiple issues in parallel.
- **Branch protection** — no direct pushes to `main`. Always use a PR.
- Only ship PRs created by Claude or explicitly named by the user. Never touch Dependabot PRs (use the global `dependabot-reviewer` agent instead).
- **Run `/fix-review` after PR creation.** Concurrent multi-model dispatch (`config.yaml`) then Claude arbiter. Address CONFIRM findings in one commit, then merge.
- After merge: checkout main, pull, then present the next unblocked issue.

---

## Step 0: Select issue

**`/ship <number>`** — fetch that issue directly, skip menu.

**`/ship <title>`** — search open issues for a title match, skip menu if unambiguous.

**`/ship` (no args)** — list the top 5 open, unblocked issues sorted by priority:

```bash
gh issue list --repo valpere/vmm-rada-web-ui --state open \
  --json number,title,labels \
  --jq '[.[] | select(.labels | map(.name) | contains(["blocked"]) | not)]
        | sort_by(
            (.labels | map(.name) | map(
              if . == "p0: critical" then 0
              elif . == "p1: high" then 1
              elif . == "p2: medium" then 2
              else 3 end
            ) | min) // 3
          )
        | .[:5]
        | to_entries[]
        | "\(.key + 1). #\(.value.number) \(.value.title) [\(.value.labels | map(.name) | join(", "))]"'
```

If **all open issues are blocked**, say so and stop — do not show a menu.

Display as a numbered menu and wait for selection.

---

## Step 1: Read the issue

```bash
gh issue view <number> --repo valpere/vmm-rada-web-ui --json title,body,labels
```

Read `## Summary` and `## Acceptance Criteria`. These define what done looks like.

---

## Step 2: Read affected files

Read every file that will change. Do not guess — read them first.

Typical candidates:
- **State** — `src/App.jsx`
- **API adapter** — `src/api.js`
- **Components** — `src/components/Sidebar.jsx`, `ChatInterface.jsx`, `Stage1.jsx`, `Stage2.jsx`, `Stage3.jsx`
- **Tests** — co-located `*.test.jsx` files (Vitest + Testing Library)
- **Docs** — `docs/api-contract.md`, `docs/streaming.md`, `docs/architecture.md` if the change touches the backend contract

---

## Step 3: Resolve uncertainties

Before touching any code, identify everything that is ambiguous or has more than one valid approach.

**Look for:**
- Naming mismatches — env var names, field names, or SSE event shapes that differ between the issue, `CLAUDE.md`, `docs/api-contract.md`, and existing code
- Multiple valid implementation approaches with real trade-offs
- Backend contract assumptions that may have drifted (this repo doesn't build against the Go backend in CI — verify against `docs/streaming.md` rather than assuming)

**For each ambiguity, investigate first.** Read related files — `CLAUDE.md`, `docs/`, existing components — to find a ground truth. Many apparent ambiguities resolve silently from the codebase.

**Then decide:**

| Situation | Action |
|-----------|--------|
| One clear answer from docs/code | Resolve silently. Note the source. Proceed. |
| Multiple valid options with real trade-offs | List them numbered. **Stop and wait for user selection.** |
| No solution found — spec is genuinely incomplete | State what is missing. **Stop and ask for clarification.** |

Do not branch until all uncertainties are resolved. A question answered before implementation costs nothing; a question discovered during `/fix-review` costs a round-trip.

---

## Step 4: Create branch and implement

```bash
git checkout main && git pull
git checkout -b <type>/<slug>   # e.g. fix/stage3-error-ui, refactor/sse-handler-map
```

Branch naming: `feat/…`, `fix/…`, `docs/…`, `refactor/…`, `chore/…`

Implement within the layer boundaries (see `.claude/context-essentials.md` — these
are immutable):

```
App.jsx (state owner)
  ↓ props only
Components (pure UI, no fetch/api.js calls)
  ↑
src/api.js (SSE adapter — sole HTTP/SSE client)
```

Commit with conventional format: `fix(scope): description` / `feat(scope): description`.

---

## Step 5: Pre-PR review (parallel)

Before creating the PR, launch **security-reviewer** and **static-analysis**
simultaneously in a single Agent tool call batch. Wait for both to complete.

- **security-reviewer**: checks for XSS risks, injection, hardcoded secrets, insecure patterns
- **static-analysis**: verifies lint passes and flags any cosmetic violations missed

Address any CRITICAL or HIGH security findings and any remaining lint violations
before continuing. LOW/MEDIUM security findings: note in the PR description.

---

## Step 6: Pre-flight

```bash
npm run lint
npm test
git status                         # nothing uncommitted
git log main..HEAD --oneline       # commits look right
```

Fix any failures from your changes before proceeding. Note pre-existing failures separately.

---

## Step 7: Create PR

```bash
git push -u origin <branch>

gh pr create \
  --title "<debt-emoji> <type>(<scope>): <description>" \
  --body "$(cat <<'EOF'
## Summary
<bullet points>

Closes #<issue-number>

## Test plan
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Dev server starts (`npm run dev`)
- [ ] Feature works end-to-end with backend running
- [ ] No console errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Debt emoji: `⚡` quick-fix · `⚖️` balanced · `🏗️` proper-refactor

---

## Step 8: Run /fix-review

Invoke `/fix-review <number>` — concurrent 3-model dispatch (`config.yaml`), vote
tally, then Claude arbiter (CONFIRM / DISMISS / DEFER). Address all CONFIRM
findings in one commit; push. `/fix-review` merges when no blockers remain.

---

## Step 9: (handled by /fix-review)

`/fix-review` posts a PR comment summarising the pass and merges once clean.
No manual polling or comment-fetching needed.

---

## Step 10: Merge

```bash
gh pr merge <number> --squash --delete-branch
git checkout main && git pull
```

---

## Step 11: Resolve and report

The `Closes #N` in the PR body auto-closes the issue on merge. Verify:

```bash
gh issue view <number> --repo valpere/vmm-rada-web-ui --json state,closed
```

If not closed automatically:
```bash
gh issue close <number> --repo valpere/vmm-rada-web-ui --comment "Resolved in PR #<pr-number>."
```

Report: issue closed, PR merged, what pre-PR review and `/fix-review` found and addressed, merge commit.

---

## Step 12: Present next issue

Show the next unblocked issue from the queue (same query as Step 0, skip already-resolved).
**Do not start implementing it** — wait for the user's command.

---

## What NOT to do

- Do not work on more than one issue at a time.
- Do not bump version numbers or update changelogs unless explicitly asked.
- Do not open follow-up issues unless review reveals a real bug outside PR scope.
- Do not skip `/fix-review` — it is the required review gate before merge.
- Do not ask the user to check review status — check it yourself.
