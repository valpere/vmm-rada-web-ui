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
- **`metadata` is ephemeral.** `label_to_model`, `aggregate_rankings`, and the
  strategy-specific fields (`vote_tally`, `rank_refine`, `debate`,
  `moa_aggregator`, `delphi`) are only returned during the streaming/blocking
  response and are not persisted. `GET /api/conversations/{id}` does not
  include them.
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

Response `200 OK` (or `204`) — empty body. Used by `Sidebar`'s delete action.

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

**Errors:** `400` (invalid body/UUID), `404` (not found), `503` (quorum not
met), `500`.

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

### Metadata (ephemeral — streaming/blocking response only, not stored)

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
- Methods: `GET`, `POST`, `OPTIONS`
- Headers: `Content-Type`

The Vite dev server also proxies `/api` → the backend (see `vite.config.js`),
so `VITE_API_BASE` is only needed when serving the built frontend from a
different origin than the API.
