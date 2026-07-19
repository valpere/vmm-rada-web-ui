# Frontend Architecture

Single-page React application presenting VMM Rada's multi-LLM deliberation
system as a chat interface. Multiple models answer a question independently,
peer-review each other, and a Chairman model synthesises a final answer —
via one of seven backend deliberation strategies (see
[api-contract.md](./api-contract.md) and [streaming.md](./streaming.md)).

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| React | 19.2 | UI framework |
| Vite | 8.1 | Dev server + build tool (rolldown-based) |
| react-markdown + rehype-highlight | 10.1 / 7.0 | Render markdown + syntax-highlighted code in model responses |
| Vitest + Testing Library | 4.1 / 16.3 | Test suite (`npm test`) |
| ESLint | 10 | Linting (flat config in `eslint.config.js`) |
| Node | ≥20.19 | Runtime requirement (`engines` in `package.json`) |

No Redux, no Context API, no TypeScript — state lives in `App.jsx` and flows
down via props.

## File Structure

```
src/
├── api.js                     # API client (all backend calls, SSE adapter)
├── App.jsx                    # Root: state, streaming, message flow
├── App.css
├── App.test.jsx
├── api.test.js
├── main.jsx                   # React entry point
├── index.css
├── theme.css                  # Design tokens (dark theme is the default)
├── utils.js                   # stripMarkdown() — plain-text title fallback helper
├── test-setup.js              # Vitest + Testing Library setup
└── components/
    ├── Sidebar.jsx            # Conversation list, new/delete/rename
    ├── Sidebar.css
    ├── ChatInterface.jsx      # Message thread, input form
    ├── ChatInterface.css
    ├── EmptyState.jsx         # Welcome screen + suggested prompts
    ├── EmptyState.css
    ├── Stage0.jsx             # Clarification questions form (optional round)
    ├── Stage0.css
    ├── Stage1.jsx             # Tabbed view of individual model responses
    ├── Stage1.css
    ├── Stage2.jsx             # Strategy-polymorphic dispatcher (7 kinds + fallback)
    ├── Stage2.css
    ├── Stage2.test.jsx
    ├── Stage3.jsx             # Final synthesized answer + error banner
    ├── Stage3.css
    └── Markdown.jsx           # Sole react-markdown wrapper (rehype-highlight)
```

Each component has a co-located `.css` file.

## Component Tree

```
App
├── Sidebar
│   ├── new/delete/rename conversation controls
│   └── ConversationItem[] (title, message count)
└── ChatInterface
    ├── EmptyState                      (shown when no conversation is active)
    ├── Message[] (user messages)
    └── AssistantMessage
        ├── Stage0   (clarification questions, if pending)
        ├── Stage1   (tabs per model, markdown responses)
        ├── Stage2   (dispatches on `kind` — see streaming.md)
        └── Stage3   (chairman's final answer, or error banner)
```

## Layered Architecture

```
App.jsx (state owner)
  ↓ props only
Components (Stage0, Stage1, Stage2, Stage3, EmptyState, ChatInterface, Sidebar)
  ↑
src/api.js (SSE + REST adapter — sole HTTP/SSE client)
```

**Immutable rules** (enforced by the `tech-lead` agent):

1. **Components are pure UI.** They receive data via props and call handler
   functions passed from `App.jsx`. No direct calls to `src/api.js` or
   `fetch` from any component.
2. **`src/api.js` is the adapter boundary.** `onEvent(type, event)` is the
   only interface `App.jsx` sees. Raw SSE lines and HTTP status codes never
   leak past this boundary.
3. **`App.jsx` owns all state.** Only `App.jsx` writes to the assistant
   message shape via `setCurrentConversation`.
4. **`react-markdown` (via `Markdown.jsx`) is the only renderer for LLM
   output.** Inserting raw HTML (`dangerouslySetInnerHTML`) is forbidden —
   it is an XSS risk with LLM-generated content.

## State Management

All application state lives in `App.jsx`:

```javascript
conversations[]        // List metadata for sidebar
currentConversationId  // Active conversation ID
currentConversation    // Full object with messages[]
isLoading              // True while an SSE stream is active
```

### Message Shape

**User message:**
```javascript
{ role: 'user', content: '...' }
```

**Assistant message (built progressively during streaming):**
```javascript
{
  role: 'assistant',
  stage1: null,
  stage2: null,
  stage2Kind: null,       // discriminator from stage2_complete.kind
  stage3: null,
  metadata: null,
  loading: { stage0: false, stage1: true, stage2: false, stage3: false },
  error: null,             // set on SSE error event; ephemeral, not persisted
  pendingClarification: null,  // {round, questions} while Stage 0 awaits input
}
```

On replay (loading a saved conversation), persisted messages are augmented
with fresh `loading`/`error`/`pendingClarification` defaults and a
`stage2Kind` derived from `metadata?.council_type` (unrecognised/legacy
values default to `peer_ranking`).

Only `App.jsx` writes to this shape — components read it via props.

## Key Behaviours

### Optimistic Updates
When the user sends a message, a user message and an empty assistant message
are added to the list immediately, before any backend response arrives.

### Progressive Streaming
`handleSendMessage` opens an SSE connection via `api.sendMessageStream()`.
Each event updates only the relevant part of the last assistant message via
`setCurrentConversation`, so React re-renders just the changed stage.

### Stage 0 — Clarification (optional)
If the backend's clarification stage is enabled, `stage0_round_complete`
pauses the pipeline with a set of chairman-generated questions (rendered via
`Markdown` in `Stage0.jsx`). The user answers some/all/none and submits (or
skips), which re-POSTs `{answers:[...]}` to the same endpoint to resume.
Skipped by default — `stage0_*` events never fire when the backend has
clarification disabled.

### Strategy-Polymorphic Stage 2
`Stage2.jsx` dispatches on `kind` to one of seven view components
(`peer_ranking`, `role_stub`, `vote_tally`, `rank_refine`, `debate_round`,
`moa_aggregator`, `delphi_round`), each rendering that strategy's specific
metadata shape. An unrecognised `kind` renders a fallback rather than
crashing. See [streaming.md](./streaming.md#stage-2-kind-values) for the
full table.

### SSE Chunk Buffering
`src/api.js` buffers incomplete lines across TCP chunks so SSE events split
at chunk boundaries are correctly reassembled before parsing.

### Auto-scroll
`ChatInterface.jsx` uses a `useRef` on the message container to scroll to
the bottom whenever messages update.

### Markdown Rendering
All model responses and evaluation text are rendered through `Markdown.jsx`
(`react-markdown` + `rehype-highlight`). Raw HTML insertion is forbidden.

### De-anonymization (`peer_ranking` Stage 2)
PeerReview's Stage 2 responses use generic labels (`Response A`, …). The
`peer_ranking` view replaces these with bold model names via
`metadata.label_to_model`. Ephemeral — not stored by the backend, so
reloaded conversations show the original anonymous labels.

### Error Handling
If the SSE stream emits an `error` event, `App.jsx` sets `msg.error` and
clears all `loading.*` flags. `Stage3.jsx` renders an error banner when
`msg.error` is set instead of a final answer.

## Configuration

`API_BASE` is read from `VITE_API_BASE` at build time; when unset, relative
URLs are used (the Vite dev-server proxy handles `/api` locally, and the
built app is expected to be served same-origin as the API in production):

```javascript
const API_BASE = (() => {
  const raw = import.meta.env.VITE_API_BASE;
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed || '';
})();
```

Set `VITE_API_BASE` in a `.env` file only when serving the built frontend
from a different origin than the API. See `.env.example`.

## Dev Setup

```bash
npm install
npm run dev     # starts at http://localhost:5173, proxies /api → :8001
npm test        # Vitest
npm run build   # production build → dist/
```

The Go backend must be running on port 8001 (or the port the dev-server
proxy is configured for). CORS is configured on the backend for
`localhost:5173`.
