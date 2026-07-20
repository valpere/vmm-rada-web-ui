---
name: self-learn
description: "vmm-rada-web-ui self-learning loop — log mistakes/wins, auto-promote recurring patterns to hard rules in CLAUDE.md, run retrospectives, give personalized coaching. Usage: /self-learn [log|retro|status|init|tips]"
---

# Skill: /self-learn
# Self-Learning System — vmm-rada-web-ui

---

## OVERVIEW

A self-learning loop that captures mistakes and wins, promotes recurring patterns
to hard rules, runs periodic retrospectives, and provides proactive workflow coaching.

```
/self-learn              → show status (counts, recent entries, pending promotions)
/self-learn log          → interactive: ask what happened, classify, and log it
/self-learn retro        → run a full retrospective analysis
/self-learn init         → initialize _patterns/ directory for this project
/self-learn tips         → analyze recent patterns and give personalized workflow tips
```

The system gets smarter with every interaction. Log from day one.

---

## STEP 0: Resolve Command

Parse the argument:
- No argument or `status` → **STATUS**
- `log` → **LOG**
- `retro` → **RETRO**
- `init` → **INIT**
- `tips` → **TIPS**

---

## INIT — Bootstrap

Check if directories and files exist. Create anything missing. Never overwrite existing data.

```
_patterns/
  mistakes.jsonl     # one JSON object per line
  wins.jsonl         # one JSON object per line
  cross-project.md   # patterns proven in 2+ areas
  anti-patterns.md   # approaches that keep failing — stop trying them
```

**`mistakes.jsonl`** — create empty (0 bytes).
**`wins.jsonl`** — create empty (0 bytes).

**`cross-project.md`**:
```markdown
# Cross-Project Patterns

Patterns proven in 2+ areas. Promoted automatically by /self-learn retro.

---
```

**`anti-patterns.md`** — pre-populated from `.claude/context-essentials.md`'s
"Banned patterns" section (see `_patterns/anti-patterns.md`, already seeded).

Note: `_patterns/*.jsonl` is gitignored — learning data stays local, not committed.

After creating, print:
> "Self-learning initialized. Start logging with `/self-learn log` after any significant task."

---

## LOG — Capture a Mistake or Win

### Step 1: Determine type

Ask:
> "What happened? I'll classify it as a **mistake** (something went wrong or was corrected)
> or a **win** (something worked well, was confirmed, or saved time).
>
> Describe it briefly, or say 'mistake' or 'win' to start from the category."

Classify automatically if the user describes the event:
- User correction, failed approach, wrong assumption, redo → **mistake**
- Confirmed approach, clever solution, time saved, bug caught early → **win**

Confirm before logging:
> "I'd classify this as a [mistake/win]. Sound right?"

### Step 2: Build the entry

Project name is fixed: `"project": "vmm-rada-web-ui"`.

**Redact before writing.** `_patterns/*.jsonl` is gitignored, so entries never appear
in a PR diff and are never reviewed — but promoted text derived from them (hard rules,
anti-patterns, cross-project patterns) IS committed. Before writing any free-text field
(`task`, `mistake`, `resolution`, `win`, `pattern`), strip API keys, tokens, credentials,
or personal data — summarize the lesson, don't quote the secret.

**For a mistake:**

```json
{
  "date": "YYYY-MM-DD",
  "project": "vmm-rada-web-ui",
  "task": "<what was being done>",
  "mistake": "<what went wrong>",
  "resolution": "<how it was fixed>",
  "pattern": "<generalizable lesson — one sentence>",
  "severity": "low|medium|high",
  "category": "<see list below>",
  "had_verification": true|false,
  "session_hygiene": "<kitchen_sink|correction_spiral|context_overload|null>"
}
```

**Mistake categories:**

| Category | When to use |
|----------|------------|
| `wrong_assumption` | Guessed instead of verified (behavior, field name, flag, module name) |
| `missed_context` | Didn't read CLAUDE.md, existing code, or docs before acting |
| `didnt_ask` | Acted on ambiguity instead of clarifying |
| `skipped_planning` | Jumped to code without plan/explore on a multi-file task |
| `tooling_error` | Wrong tool, flag, command, or config |
| `context_waste` | Didn't `/clear`, kitchen-sink session, or context overload |
| `api_error` | Wrong endpoint, format, auth, or field name for any external API |
| `banned_pattern` | Used an approach explicitly banned in CLAUDE.md/context-essentials.md |
| `other` | Doesn't fit above |

**Session hygiene flags** (set when relevant):

| Flag | When to use |
|------|------------|
| `kitchen_sink` | Mixed unrelated tasks in one session without `/clear` |
| `correction_spiral` | 3+ corrections on the same issue in one session |
| `context_overload` | Context filled with irrelevant files/output |

**Severity:**

| Severity | Definition |
|----------|-----------|
| `high` | Significant rework (>30 min wasted), data loss, or production impact |
| `medium` | Multiple retries, cascading wrong assumptions |
| `low` | Caught quickly, minor rework |

**For a win:**

```json
{
  "date": "YYYY-MM-DD",
  "project": "vmm-rada-web-ui",
  "task": "<what was being done>",
  "win": "<what worked well>",
  "pattern": "<reusable lesson — one sentence>",
  "reusable_in": "<where else this applies>",
  "had_verification": true|false,
  "used_plan_mode": true|false,
  "delegation": "subagent|manual|none",
  "decomposed": true|false
}
```

### Step 3: Append

Append as a single line to `_patterns/mistakes.jsonl` or `_patterns/wins.jsonl`.
Read existing content, add new line, write back. Never overwrite.

### Step 4: Check for promotion triggers

**For mistakes** — read all entries in `mistakes.jsonl`, group by similar `pattern`.
If any pattern appears **2+ times**, propose a promotion — do not write yet:

> "This mistake has occurred [N] times. Proposing this hard rule for CLAUDE.md:
>
> **[RULE NAME]** *(promoted YYYY-MM-DD — [N] mistakes)*: [instruction].
>
> Add this to CLAUDE.md's `## Self-Learning Hard Rules` section? (y/n)"

**CLAUDE.md overrides default behavior for every future session** — a promoted rule
is a standing instruction, not a log entry. Only write it after the user explicitly
confirms the exact text shown above; a "yes, log this" from Step 1 is not sufficient
approval for this separate write. If the user edits the wording, use their version.

**For wins** — if `reusable_in` mentions 2+ distinct areas, propose adding to
`_patterns/cross-project.md` the same way: show the exact text, wait for explicit
confirmation, then write.

### Step 5: Confirm

> "Logged [mistake/win]. [N] total [mistakes/wins] tracked.
> [Promoted to hard rule in CLAUDE.md. / No promotion triggered.]"

---

## STATUS — Dashboard

```
## Self-Learning Status — vmm-rada-web-ui

### Pattern Store
- Mistakes: [N] ([H] high, [M] medium, [L] low)
- Wins: [N]
- Cross-project patterns: [N]
- Anti-patterns: [N]
- Hard rules promoted: [N]

### Verification Rate
- Tasks with verification: [N]%

### Mistake Categories
| Category | Count | % |
|----------|-------|---|

### Session Hygiene
- Kitchen sink sessions: [N]
- Correction spirals: [N]
- Context overloads: [N]

### Recent (last 5)
| Date | Type | Summary |
|------|------|---------|

### Pending Promotions
[Patterns with 2+ occurrences not yet promoted]

### Last Retrospective
[Date or "Never — run /self-learn retro"]
```

---

## RETRO — Full Retrospective

### Step 1: Gather data

Read:
- `_patterns/mistakes.jsonl`
- `_patterns/wins.jsonl`
- `_patterns/cross-project.md`
- `_patterns/anti-patterns.md`
- `CLAUDE.md` (existing hard rules, including `## Self-Learning Hard Rules`)

If fewer than 3 total entries:
> "Not enough data for a meaningful retrospective. Log more interactions first."
Stop.

### Step 2: Analyze

- **Group mistakes by category.** Flag `banned_pattern` — architectural violation.
- **Recurring patterns:** 2+ times → hard rule candidate; 3+ times → anti-pattern candidate.
- **Verification correlation:** win rate WITH vs WITHOUT tests/lint.
- **Plan mode correlation:** tasks with `/plan` vs ad-hoc.
- **Session hygiene:** count each flag; 3+ times → promote to anti-pattern.
- **Delegation:** subagent-isolated tasks vs inline edits outcomes.
- **Stale patterns:** hard rules not triggered in 30+ days → flag for user review.

### Step 3: Report

```markdown
## Retrospective Report — {date} — vmm-rada-web-ui

### Stats
- Period: {earliest} → {latest}
- Mistakes: {N} ({high} high, {medium} medium, {low} low)
- Wins: {N}

### Verification Impact
- With verification: {N}% success
- Without: {N}% success

### Top Mistake Categories
| Category | Count | Trend |
|----------|-------|-------|

### Session Hygiene Issues
[...]

### Recurring Mistakes (Hard Rule Candidates)
[...]

### Anti-Patterns to Stop
[...]

### Wins Worth Replicating
[...]

### Action Items
- [ ] {specific update}
```

### Step 4: Propose, then apply only after confirmation

Show the report from Step 3 first — it already lists the exact candidate rules,
anti-patterns, and cross-project entries. Then ask once:

> "Apply the [N] hard rule(s), [N] anti-pattern(s), and [N] cross-project pattern(s)
> listed above to CLAUDE.md / `_patterns/`? (y/n, or tell me which to skip)"

Only on explicit "yes" (or an edited subset):
1. Write the confirmed hard rules to CLAUDE.md (`## Self-Learning Hard Rules`)
2. Write the confirmed anti-patterns to `_patterns/anti-patterns.md`
3. Write the confirmed cross-project patterns to `_patterns/cross-project.md`
4. Flag stale patterns (don't auto-remove)

Same reasoning as LOG Step 4: these files are tracked, committed, and (for CLAUDE.md)
override default behavior for every future session — never write to them from
unreviewed pattern data without a distinct confirmation.

### Step 5: Confirm

> "Retrospective complete. Applied: [N] hard rules, [N] anti-patterns, [N] cross-project patterns.
> Anything surprise you?"

---

## TIPS — Personalized Coaching

Only show tips backed by actual tracked data — no generic advice.

**Verification** (if `had_verification=false` on 50%+ of mistakes):
> "**Run tests before every commit.** [N]% of your mistakes happened without verification."

**Plan mode** (if `skipped_planning` has 2+ entries):
> "**Use explore-first on multi-file tasks.** [N] mistakes from jumping straight to code."

**Context hygiene** (if hygiene flags appear):
> "**Use /clear between unrelated tasks.** [N] context-related mistakes logged."

**Banned patterns** (if `banned_pattern` entries exist):
> "**Re-read context-essentials.md's banned patterns before each PR.** [N] violations logged."

**Delegation** (if context mistakes exist but few subagent wins):
> "**Delegate code generation to subagents.** Keeps main context clean for coordination."

**Top wins** (always — top 3 by `reusable_in` breadth):
> "**Your best patterns:** [top 3 from wins.jsonl]"

---

## ALWAYS-ON BEHAVIORS

### Before any significant task
1. Check `_patterns/mistakes.jsonl` — made a related mistake before?
2. Check `_patterns/anti-patterns.md` — about to violate a known bad approach?
3. Check `CLAUDE.md § Self-Learning Hard Rules` if touching a flagged area.

### After any significant task
1. Did anything fail that required retry? → Offer to log mistake.
2. Did user correct the approach? → Log mistake immediately (don't ask).
3. Clever solution found? → Offer to log win.
4. Tests/lint failed and revealed a bug? → Log as verified mistake.
5. PR passed clean? → Offer to log win with `used_plan_mode` and `delegation`.

### Session hygiene monitoring
- 3+ unrelated tasks mixed → suggest `/clear`
- Same correction made 2+ times → suggest `/clear` + fresh prompt
- 20+ file reads in one investigation → suggest subagent delegation

---

## RULES

1. **Never overwrite pattern files** — always append. Data is sacred.
2. **Never delete entries** — mark stale instead.
3. **Always confirm classification** before logging.
4. **Log wins too** — validated approaches matter as much as mistakes.
5. **Severity is honest** — don't downplay.
6. **Promotion is automatic** — 2+ occurrences = hard rule.
7. **Retrospectives are non-judgmental** — analyze patterns, not blame.
8. **Cross-project patterns require evidence** — at least 2 distinct contexts.
9. **Anti-patterns are conclusive** — 3+ failures of the same approach.
10. **Stale patterns get flagged, not auto-removed** — user decides.
11. **Tips are data-driven** — only show tips backed by actual data.
