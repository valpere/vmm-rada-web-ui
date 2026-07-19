# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies
npm run dev        # dev server at http://localhost:5173
npm run build      # production build
npm run lint       # ESLint
npm run preview    # serve the production build locally
```

**Skill setup (one-time, per machine):**
```bash
mkdir -p ~/.claude/skills
for skill in .claude/skills/*/; do
  [ -d "$skill" ] || continue
  ln -sfn "$(pwd)/$skill" ~/.claude/skills/"$(basename "$skill")"
done
```

This registers all project skills in `.claude/skills/` as slash commands in Claude Code.
Note: `.claude/` is excluded from git by the global gitignore (`.*`), so skill files live only on the local filesystem and must be set up per machine using the snippet above.

There is no test suite.

## Architecture

The frontend is a single-page React app for the LLM Council system — a 3-stage deliberation pipeline where multiple LLMs answer a question, peer-review each other anonymously, and a Chairman model synthesizes a final answer.

**State lives entirely in `App.jsx`** (no Redux, no Context). It flows down via props. The key shape is the assistant message, which is built progressively during streaming:

```javascript
{
  role: 'assistant',
  stage1: null | [{model, response}],
  stage2: null | [{model, ranking, parsed_ranking}],
  stage3: null | {model, response},
  metadata: null | {label_to_model, aggregate_rankings},
  loading: {stage1, stage2, stage3},  // drives per-stage spinners
  error: null | string               // set on SSE error event; ephemeral, not persisted
}
```

**`src/api.js`** is the single API client. `API_BASE` is read from `VITE_API_BASE` env var (defaults to `http://localhost:8001`). The streaming method reads a `ReadableStream` and calls `onEvent(eventType, event)` for each SSE `data:` line.

**`src/components/Stage2.jsx`** does de-anonymization: Stage 2 responses from the backend use labels (`Response A`, `Response B`, ...) and `Stage2.jsx` replaces them with bold model names using `metadata.label_to_model`. This mapping is ephemeral — not stored by the backend — so it is only available during and immediately after the streaming response, not when loading a saved conversation.

## Backend

The Go backend repo is at `../llm-council-backend`. Docs:
- `docs/user-guide.md` — how to use the app (UI, three stages, limitations)
- `docs/api-contract.md` — REST endpoint shapes and JSON types
- `docs/streaming.md` — SSE event sequence and payload formats
- `docs/architecture.md` — component tree, state model, layered architecture
- `docs/development-workflow.md` — skills, agents, pipelines, conventions

The backend must be running before starting the dev server. CORS is configured on the backend for `localhost:5173`.

Backend config env vars relevant to frontend: `COUNCIL_MODELS` (comma-separated model list), `CHAIRMAN_MODEL` (Stage3 synthesizer), `TITLE_MODEL` (title generation model — runs in parallel with pipeline). Port is configurable via `PORT` (default 8001).

## Workflow

**Branch naming:**
```
feat/{short-description}      e.g. feat/stage3-error-ui
fix/{description}             e.g. fix/loading-stage3-never-clears
docs/{description}            e.g. docs/update-streaming-contract
refactor/{description}        e.g. refactor/extract-sse-handler
```

**Commit format:** `fix(scope): description` / `feat(scope): description` / `docs: description`

**Debt levels** — label all PRs and proposals:
- ⚡ quick-fix: targeted, no refactor
- ⚖️ balanced: sensible trade-offs
- 🏗️ proper: full refactor

**Skills** (invoke with `/skill-name`):
- `/backlog` — show top 5 backlog items or plan a specific task; reads affected files, writes a plan file, offers to create a GitHub issue
- `/fix-review` — address Copilot PR comments (one round, Code Review Pyramid priority); does not merge
- `/ship` — full PR lifecycle: lint → create PR → Copilot → fix → squash merge → checkout main
- `/find-bugs` — 5-phase security/bug audit of current branch changes; report-only
- `/improve` — research-first critic for plans and designs; SHIP IT / IMPROVE IT / RETHINK IT / KILL IT verdict

**Agents** (invoked via `Agent` tool):
- `tech-lead` — architectural authority; reviews plans before implementation and code before merging; enforces SSE adapter boundary, App.jsx state model, and security rules
- `backend-sync` — runs hourly (cron re-created on SessionStart); checks backend git log, SSE contract, and new issues for frontend-relevant changes
- `bug-fixer` — surgical one-bug fix; one bug, one minimal fix, one commit
- `code-simplifier` — behaviour-preserving JS refactor; no TypeScript, no test suite
- `docs-maintainer` — post-merge doc sync for CLAUDE.md, docs/, and .proposals.md
- `security-reviewer` — OWASP/XSS security audit of recently changed code; report-only
- `static-analysis` — ESLint cosmetic fixes only; flags semantic violations for escalation
- `code-generator` — full issue implementation lifecycle: branch → code → parallel review → PR
- `pm-issue-writer` — translates informal requests into RFC 2119-compliant GitHub issue drafts
- `ci-build-agent` — GitHub Actions workflow creation and CI pipeline maintenance

All agents have persistent memory in `.claude/agent-memory/<agent-name>/`.

**Proposals:** open `.proposals.md` at repo root for pending ideas and design decisions.

## Known gaps

No known gaps currently.
