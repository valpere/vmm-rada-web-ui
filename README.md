# VMM Rada — Frontend

The frontend for **VMM Rada**, a multi-LLM deliberation system. Instead of
asking one model, you ask a Rada (council): multiple LLMs answer
independently, evaluate each other, and a Chairman model synthesizes a
final answer — via one of seven deliberation strategies.

This repository is the React UI. The backend is a separate Go service at
[`vmm-rada`](https://github.com/valpere/vmm-rada).

---

## How it works

Every message you send goes through a pipeline that the UI reveals
progressively as each stage completes:

**Stage 0 — Clarification (optional)**
If enabled on the backend, the chairman may ask a round of clarifying
questions before deliberation starts.

**Stage 1 — Individual responses**
All Rada models answer your question in parallel, with no knowledge of
each other.

**Stage 2 — Peer review**
Each model evaluates the Stage 1 responses — anonymized so no model knows
which answer is its own. What this looks like depends on the active
strategy (peer ranking, vote tally, ranked candidates, debate rounds,
mixture-of-agents layers, or a Delphi rating panel) — see
[`docs/streaming.md`](docs/streaming.md#stage-2-kind-values).

**Stage 3 — Chairman synthesis**
A designated model receives the full Stage 1 + Stage 2 output and writes a
final, synthesized answer.

The conversation is saved and can be revisited, renamed, or deleted from
the sidebar.

---

## Tech stack

| | |
|---|---|
| [React 19](https://react.dev) | UI framework |
| [Vite 8](https://vite.dev) | Dev server and build tool |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [rehype-highlight](https://github.com/rehypejs/rehype-highlight) | Renders markdown + syntax-highlighted code in model responses |
| [Vitest](https://vitest.dev) | Test suite |

No state management library — all state lives in `App.jsx` and flows down
via props. Communication with the backend uses the Fetch API — REST for
conversation management, and a `ReadableStream` reader for the
Server-Sent Events deliberation stream.

---

## Prerequisites

- Node.js ≥20.19
- The Go backend running on port 8001 (see
  [`vmm-rada`](https://github.com/valpere/vmm-rada))

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server proxies
`/api` requests to the backend (`vite.config.js`), so the backend must
already be running.

---

## Other commands

```bash
npm run build     # production build → dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint
npm test          # Vitest
```

---

## Project structure

```
src/
├── api.js               API + SSE client — all backend communication lives here
├── App.jsx               Root component, all state, streaming message handler
└── components/
    ├── Sidebar.jsx        Conversation list — new/rename/delete
    ├── ChatInterface.jsx  Message thread, input form
    ├── EmptyState.jsx     Welcome screen with suggested prompts
    ├── Stage0.jsx          Clarification questions (optional)
    ├── Stage1.jsx          Tabbed view of each model's individual response
    ├── Stage2.jsx          Strategy-polymorphic peer-review/evaluation view
    ├── Stage3.jsx          Chairman's final synthesized answer
    └── Markdown.jsx        Sole react-markdown renderer (XSS-safe LLM output)
```

Each component has a co-located `.css` file. See
[`docs/architecture.md`](docs/architecture.md) for the full file listing
including tests.

---

## Configuration

`API_BASE` is read from the `VITE_API_BASE` env var and defaults to a
relative URL (works with the dev-server proxy). Only set it when serving
the built frontend from a different origin than the API:

```
VITE_API_BASE=https://your-backend-host
```

Copy `.env.example` to `.env` and adjust as needed.

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — component tree, state
  shape, key behaviors (optimistic updates, SSE streaming, strategy
  dispatch)
- [`docs/api-contract.md`](docs/api-contract.md) — REST endpoint reference
  with request/response shapes
- [`docs/streaming.md`](docs/streaming.md) — SSE event sequence and
  per-strategy payload shapes
- [`docs/user-guide.md`](docs/user-guide.md) — how to use the app
- [`docs/development-workflow.md`](docs/development-workflow.md) — skills,
  agents, and contribution conventions for this repo
