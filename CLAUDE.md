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

Or use `make`:
```
make install       # npm install
make dev           # dev server at http://localhost:5173
make build         # production build
make lint          # ESLint
make test          # vitest run
make ci            # npm ci + lint + test + build
```

Test suite: `npm test` (Vitest + Testing Library). Single file:
`npx vitest run src/api.test.js`. Single test by name: `npx vitest run -t
"<test name>"`. Watch mode: `npm run test:watch`.

`.claude/agents/`, `.claude/skills/`, `.claude/plans/`, `.claude/dreaming/`,
and `.claude/context-essentials.md` are git-tracked (explicitly un-ignored
in `.gitignore` — no manual symlink setup needed, they work on any clone).
`.claude/settings.local.json` (session-recall/session-end hooks) and
`.claude/agent-memory/` (created lazily on first agent write) stay
per-machine and are gitignored.

**One-time per-machine setup:** `/recall` (semantic session search) is a
**user-level** skill (`~/.claude/skills/session-recall/`) — nothing to
install here. It requires the `session-indexer` binary on `PATH`; if
missing, `/recall` prints install instructions
(`~/wrk/common/skills/session-recall/generate/SKILL.md`).

## Architecture

The frontend is a single-page React app for the VMM Rada system — a
multi-LLM deliberation pipeline where models answer a question, peer-review
each other, and a Chairman model synthesizes a final answer. An optional
Stage 0 clarification round can precede deliberation. The backend supports
seven deliberation strategies; Stage 2's shape is polymorphic per-strategy
(`Stage2.jsx` dispatches on a `kind` discriminator).

**State lives entirely in `App.jsx`** (no Redux, no Context). It flows down via props. The key shape is the assistant message, which is built progressively during streaming:

```javascript
{
  role: 'assistant',
  stage1: null,
  stage2: null,
  stage2Kind: null,             // discriminator from stage2_complete.kind
  stage3: null,
  metadata: null,
  loading: { stage0, stage1, stage2, stage3 },  // drives per-stage spinners
  error: null,                   // set on SSE error event; ephemeral, not persisted
  pendingClarification: null,    // {round, questions} while Stage 0 awaits input
}
```

**`src/api.js`** is the single API client. `API_BASE` is read from `VITE_API_BASE` env var; when unset, relative URLs are used (the Vite dev-server proxy handles `/api` locally). The streaming method reads a `ReadableStream` and calls `onEvent(eventType, event)` for each SSE `data:` line.

**`src/components/Stage2.jsx`** dispatches on `kind` to a strategy-specific view. The default strategy's view (`peer_ranking`) does de-anonymization: responses use labels (`Response A`, `Response B`, ...) replaced with bold model names via `metadata.label_to_model`. This mapping is ephemeral — not stored by the backend — so it is only available during and immediately after the streaming response, not when loading a saved conversation. See `docs/streaming.md` for the full `kind` table.

## Backend

The Go backend lives at [`vmm-rada`](https://github.com/valpere/vmm-rada). Docs:
- `docs/user-guide.md` — how to use the app (UI, pipeline stages, limitations)
- `docs/api-contract.md` — REST endpoint shapes and JSON types
- `docs/streaming.md` — SSE event sequence and per-strategy payload formats
- `docs/architecture.md` — component tree, state model, layered architecture
- `docs/development-workflow.md` — skills, agents, pipelines, conventions

The backend must be running before starting the dev server. CORS is configured on the backend for `localhost:5173`.

Backend config env vars relevant to frontend: `RADA_MODELS` (default-strategy model list), `CHAIRMAN_MODEL` (Stage 3 synthesizer), and `DEFAULT_RADA_TYPE` (which strategy `council_type: "default"` resolves to) only take effect when the backend's `COUNCIL_CONFIG_PATH` is explicitly emptied — by default vmm-rada ships `configs/council.yaml` as the source of truth for all 7 strategies' model rosters, which silently overrides these env vars (no effect on frontend request/response shapes; `council_type` wire values are unchanged). Title generation is local truncation of Stage 3's content (`truncateTitle`), not a configurable model — there is no `TITLE_MODEL`. `CLARIFICATION_MAX_ROUNDS` (enables/limits Stage 0, `0` disables it) and `PORT` (default 8001) are unaffected by the above and always apply.

## Workflow

**Branch naming and commit format:** see `docs/development-workflow.md` §
"Branch, Commit, and PR Conventions" — the single source of truth for both
lists (includes `chore/` and `task(scope):`, which this file used to omit).

**Debt levels** — label all PRs and proposals:
- ⚡ quick-fix: targeted, no refactor
- ⚖️ balanced: sensible trade-offs
- 🏗️ proper: full refactor

**Skills** (invoke with `/skill-name`):
- `/backlog` — show top 5 backlog items or plan a specific task; reads affected files, writes a plan file, offers to create a GitHub issue
- `/fix-review` — multi-model PR review (3 concurrent Ollama models + Claude arbiter, see `.claude/skills/fix-review/config.yaml`); merges when clean. Not Copilot-based.
- `/ship` — full issue lifecycle: branch → implement → pre-PR review → PR → `/fix-review` → merge → resolve → next
- `/find-bugs` — 5-phase security/bug audit of current branch changes; report-only
- `/improve` — research-first critic for plans and designs; SHIP IT / IMPROVE IT / RETHINK IT / KILL IT verdict
- `/apply-dreaming` — walk the latest weekly dreaming report, apply high-confidence findings
- `/session-end` — write today's session summary to `.claude/session-log.md` (also auto-runs on session Stop; this is the higher-quality manual version)
- `/doubt-driven-development` — subjects non-trivial decisions to a fresh-context adversarial review before they stand; in-flight, not a post-hoc PR verdict like `/fix-review`
- `/housekeeping` — recurring repo-health check (stale branches, debug output, tracked secrets, framework version drift, CI coverage delta); read-only, pass/fail table
- `/self-learn` — log mistakes/wins, auto-promote recurring patterns to hard rules in CLAUDE.md (behind explicit confirmation), run retrospectives

**Dependabot PRs** are handled by the global `dependabot-reviewer` agent
(`~/.claude/agents/dependabot-reviewer.md`), not `/fix-review` or `/ship`.

**Agents** (invoked via `Agent` tool):
- `tech-lead` — architectural authority; reviews plans before implementation and code before merging; enforces SSE adapter boundary, App.jsx state model, and security rules
- `bug-fixer` — surgical one-bug fix; one bug, one minimal fix, one commit
- `code-simplifier` — behaviour-preserving JS refactor; no TypeScript
- `docs-maintainer` — post-merge doc sync for CLAUDE.md and docs/
- `security-reviewer` — OWASP/XSS security audit of recently changed code; report-only
- `static-analysis` — ESLint cosmetic fixes only; flags semantic violations for escalation
- `code-generator` — full issue implementation lifecycle: branch → code → parallel review → PR
- `pm-issue-writer` — translates informal requests into RFC 2119-compliant GitHub issue drafts
- `ci-build-agent` — GitHub Actions workflow creation and CI pipeline maintenance
- `test-generator` — generates colocated Vitest test files for untested components/utilities; mocks `src/api.js`, never hits the real network

Agents get persistent memory in `.claude/agent-memory/<agent-name>/`, created
lazily the first time an agent writes to it — the directory won't exist on
a fresh clone.

**Session recall & dreaming:** `/recall <query>` (user-level skill) searches
past session transcripts semantically. `.claude/dreaming/` runs a weekly
scheduled self-review (drift from `context-essentials.md`, recurring
`/fix-review` themes, stale plans) — see `.claude/dreaming/README.md` for
the systemd timer setup. Reports land in `.claude/dreaming/reports/`,
applied via `/apply-dreaming`.

## Known gaps

- **No strategy picker in the UI.** `handleSendMessage` hardcodes
  `council_type: "default"`. All seven strategies are already supported by
  the Stage 2 dispatcher and the message state shape — only the
  request-composition and any strategy-selection UI are missing.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
