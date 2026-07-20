# Context Essentials — vmm-rada-web-ui

> Re-injected into session context after compaction (via SessionStart hook
> with matcher='compact') and emphasized to the compactor (via PreCompact
> hook). Source of truth for rules that MUST survive context summarization.
>
> Keep this file under ~60 lines — every line costs tokens on each
> re-injection.

## Architecture (immutable)

These four rules are **load-bearing**. Violations break the architecture
contract and require Tech Lead override.

1. **Components are pure UI.** No `fetch` or `api.js` calls from any component.
2. **`src/api.js` is the adapter boundary.** `onEvent(type, event)` is the only
   interface `App.jsx` sees. Raw SSE lines and HTTP status codes never leak.
3. **`App.jsx` owns all state.** Only `App.jsx` writes the assistant message
   shape via `setCurrentConversation`.
4. **`react-markdown` is the only renderer for LLM output.** Inserting raw
   HTML is forbidden — XSS risk with LLM-generated content.

## Stack constraints

- React 19 + Vite 8, plain JavaScript. No TypeScript, no Redux, no Context API.
- Tests: Vitest + Testing Library (`npm test`).
- Backend: [`vmm-rada`](https://github.com/valpere/vmm-rada) (Go), separate
  repo. Must be running locally (port 8001) for dev/testing against real data.

## Workflow gates

```
/backlog → Tech Lead (APPROVED) → gh issue create → plan file deleted
    → /ship → code-generator → [/fix-review rounds] → squash merge
```

- **Plans** live in `.claude/plans/` with frontmatter (type, priority, labels,
  github_issue). After issue creation, delete the plan file.
- **Tech Lead approval** is the gate before any code generation.
- **PRs** are squash-merged. Never merge commits or rebase-merge.
- **`/fix-review`** runs parallel multi-model review (Ollama, see `config.yaml`)
  + Claude arbiter. **Not** Copilot-based — Copilot was dropped from the org
  workflow 2026-05-13; never wait for it.

## Docs discipline

- **Mark planned vs current explicitly.** When a doc describes a feature
  not yet wired into code, prefix the section with `PLANNED:` or
  `NOT YET WIRED:`. Never write future-tense behaviour as if it were
  current.
- **Update `CLAUDE.md` and `docs/*.md` together** when a feature lands.
  Drift between these is a common review comment.

## Banned patterns

- No `--no-verify` on git operations.
- No direct `fetch` in components — must go through `src/api.js`.
- No raw HTML rendering of LLM output — `react-markdown` only.
- No state writes outside `App.jsx`.
- No TypeScript.
- No commits skipping pre-commit hooks unless user explicitly requests.
