# API Contract

The frontend communicates with the Go backend (port 8001 by default) via REST +
Server-Sent Events. REST endpoints send and receive JSON bodies; the streaming
endpoint uses `text/event-stream` (SSE) and emits events whose `data:` lines
contain JSON payloads.

## Design Constraints

- **One question per conversation.** Each conversation stores exactly one user
  message and one assistant message. Sending a second message to an existing
  conversation is not supported by the UI — the frontend creates a new
  conversation for each question.
- **`metadata` IS persisted and returned on replay.** Verified against backend
  source (`internal/storage/storage.go` `SaveAssistantMessage` — marshals the
  full `council.AssistantMessage` struct, `Metadata` field has no `omitempty`
  or `-` tag) — `GET /api/conversations/{id}` returns the same `metadata`
  object that was present at streaming/blocking-response time, byte-for-byte
  (`Conversation.Messages` is stored as raw JSON). This corrects a prior
  version of this doc that claimed metadata was ephemeral and stripped on
  replay — that claim was never true against current backend behavior. This
  false assumption previously caused `App.jsx`'s `deriveStage2Kind` to
  mis-render 6 of 7 strategies as `PeerRankingView` on replay — fixed (gh#94)
  by inferring `kind` from Metadata's strategy-specific sub-object presence
  rather than from `council_type`, since custom-named registrations sharing
  a strategy (e.g. `"factual-majority"` / `"creative-majority"`, both
  `Strategy: Majority`) make a name-based lookup unreliable.
  **Security note:** this means `label_to_model` (which model produced which
  response) is retrievable indefinitely via `GET /api/conversations/{id}`,
  not just during the live session — this project has no auth layer, so
  anyone with network access to the backend can read it for any past
  conversation. Flagging for awareness; whether that's an acceptable trade-off
  is a backend/product decision, out of scope for this frontend-docs fix.
- **Strategy is server-side configuration, not a client concern.** The same
  two endpoints (`/message`, `/message/stream`) serve all seven deliberation
  strategies. The frontend sends `council_type` (currently hardcoded to
  `"default"` — see [Known gaps](../CLAUDE.md#known-gaps)); which strategy
  that name resolves to is decided by backend config, not the UI.

---

## Endpoints

### List Conversations

```
GET /api/conversations
```

Response:
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "created_at": "2026-01-15T10:30:00Z",
    "title": "Explain the trolley problem",
    "message_count": 4
  }
]
```

Sorted by `created_at` descending (newest first). Returns `[]` when no
conversations exist. Used by `Sidebar` to populate the conversation list.

---

### Create Conversation

```
POST /api/conversations
Content-Type: application/json

{}
```

Response `201 Created`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-01-15T10:30:00Z",
  "title": "New Conversation",
  "messages": []
}
```

---

### Get Conversation

```
GET /api/conversations/{id}
```

Response:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-01-15T10:30:00Z",
  "title": "Explain the trolley problem",
  "messages": [
    { "role": "user", "content": "Explain the trolley problem" },
    {
      "role": "assistant",
      "stage1": [ "...StageOneResult[]" ],
      "stage2": [ "...StageTwoResult[]" ],
      "stage3": { "...StageThreeResult" },
      "metadata": { "...Metadata" }
    }
  ]
}
```

`messages` is heterogeneous — demux by `role`: `"user"` → `{role, content}`;
`"assistant"` → `{role, stage1, stage2, stage3, metadata}`.

**Errors:** `400` (invalid UUID), `404` (not found).

---

### Delete Conversation

```
DELETE /api/conversations/{id}
```

Response `204 No Content` — empty body. Used by `Sidebar`'s delete action.

---

### Rename Conversation

```
PATCH /api/conversations/{id}
Content-Type: application/json

{"title": "A better title"}
```

Response: the updated `ConversationMeta`. Used by `Sidebar`'s inline rename.

---

### Send Message (Blocking)

```
POST /api/conversations/{id}/message
Content-Type: application/json

{"content": "Explain the trolley problem", "council_type": "default"}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | The user's message |
| `council_type` | string | no | Strategy name; defaults to the backend's `DEFAULT_RADA_TYPE` env var |

Response `200 OK` — same `AssistantMessage` shape as the streaming endpoint's
terminal state, all at once (waits for all stages to complete). The frontend
uses the streaming endpoint instead; this one exists for non-streaming
integrations.

**Errors:** `400` (invalid body/UUID), `404` (not found), `409`, `503` (quorum
not met), `500`. **409 has three distinct causes, discriminated only by the
`error` message string — there is no `code` field on the wire (verified
against backend source; a prior version of this doc claimed one existed).**
`src/api.js`'s `ApiError.code` is derived client-side from the message string
(gh#95) — a nonexistent-code fallback previously misclassified the other two
causes as conversation-closed:
| `error` message (wire) | Frontend `ApiError.code` | Cause |
|---|---|---|
| `"conversation is closed"` | `conversation_closed` | Message/answers sent to a closed conversation |
| `"no pending clarification round"` | `no_pending_clarification_round` | Round-N answers submitted with nothing pending |
| `"clarification round already answered"` | `clarification_round_already_answered` | Round-N answers submitted twice |

---

### Send Message (Streaming)

```
POST /api/conversations/{id}/message/stream
Content-Type: application/json

{"content": "Explain the trolley problem", "council_type": "default"}
```

Response headers:
```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

See [streaming.md](./streaming.md) for the full event sequence and payload
shapes, including the Stage 0 clarification round-trip.

**Errors:** `400` (invalid body/UUID), `404` (not found), `409`, `503` (quorum
not met), `500` — all as pre-SSE HTTP responses (SSE headers are not yet
written when these fire). The three 409 causes are the same as [Send Message
(Blocking)](#send-message-blocking) above, discriminated by `error` message
string, no `code` field. Pipeline-run failures that occur *after* SSE headers
are written (quorum, chairman failure, storage) surface as a post-SSE `error`
event instead of an HTTP status — see [streaming.md](./streaming.md#error).

---

## Data Types

> JSON object shapes. Property types use pseudocode notation (`string`,
> `number`, `bool`, `array[]`).

### ConversationMeta

```
{
  id: string           // UUID v4
  created_at: string   // RFC 3339 / ISO 8601
  title: string
  message_count: number
}
```

### Conversation

```
{
  id: string
  created_at: string
  title: string
  messages: (UserMessage | AssistantMessage)[]
}
```

### UserMessage

```
{ role: "user"; content: string }
```

### AssistantMessage (stored)

```
{
  role: "assistant"
  stage1: StageOneResult[]
  stage2: StageTwoResult[]
  stage3: StageThreeResult
  metadata: Metadata          // persisted and returned as-is on replay — see gh#94
}
```

### StageOneResult

```
{
  label: string        // anonymised label, e.g. "Response A"
  content: string       // model's answer
  model: string          // OpenRouter model ID
  duration_ms: number    // wall-clock time for this model's response
}
```

### StageTwoResult

Shape for the default `PeerReview` strategy (`kind: "peer_ranking"`). Other
strategies carry their Stage 2 content in `metadata` instead — see
[streaming.md](./streaming.md#stage-2-kind-values) for the full polymorphic
`kind` table.

```
{
  reviewer_label: string   // label of the reviewing model
  rankings: string[]        // labels ordered best-first
}
```

### StageThreeResult

```
{
  content: string        // Chairman's synthesised answer
  model: string           // OpenRouter model ID
  duration_ms: number
}
```

### Metadata (persisted — same shape on streaming/blocking response and on replay, see gh#94)

```
{
  council_type: string              // strategy name used for this run
  label_to_model: { [label: string]: string }
  aggregate_rankings: RankedModel[]  // sorted by score ascending
  consensus_w: number                // 0–1 agreement weight (PeerReview)
  // Present only for the matching strategy's kind:
  vote_tally?: VoteTally
  rank_refine?: RankRefine
  debate?: Debate
  moa_aggregator?: MoaAggregator
  delphi?: DelphiPanel
}
```

### RankedModel

```
{ model: string; score: number }   // lower score = ranked higher overall
```

### ClarificationQuestion

```
{
  id: string     // stable identifier, e.g. "q1" — use as the id in answer submissions
  text: string    // question text from the chairman (rendered via react-markdown)
}
```

---

## CORS

The backend allows:
- Origins: `http://localhost:5173`, `http://localhost:3000`
- Methods: `GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`
- Headers: `Content-Type`

**Known gap (backend-documented):** these are the frontend's former in-monorepo
dev-server origins, carried over unchanged since extraction (2026-07-19).
There is no origin covering a non-localhost deployment of this frontend, and
no backend env var to add one.

The Vite dev server also proxies `/api` → the backend (see `vite.config.js`),
so `VITE_API_BASE` is only needed when serving the built frontend from a
different origin than the API.
