# Streaming Protocol (SSE)

`POST /api/conversations/{id}/message/stream` returns a `text/event-stream`
response. Events arrive as the deliberation pipeline progresses.

## Event Format

Each event is a single line followed by a blank line:

```
data: <JSON>\n\n
```

The JSON object always has a `type` field — there is no separate `event:`
line, demux by `type`. Additional fields depend on the event type.

## Event Sequence

```
data: {"type":"stage0_round_complete", ...}   ← optional, stream CLOSES here
  … client re-POSTs with {"answers":[...]} …
data: {"type":"stage0_done"}                   ← Stage 1 follows on the same stream

data: {"type":"stage1_start"}
data: {"type":"stage1_complete", "data":[...StageOneResult]}
data: {"type":"stage2_start"}
data: {"type":"stage2_complete", "data":[...], "kind":"...", "metadata":{...}}
data: {"type":"stage3_start"}
data: {"type":"stage3_complete", "data":{...StageThreeResult}}
data: {"type":"title_complete", "data":{"title":"..."}}   ← may be absent (30s timeout)
data: {"type":"complete"}
```

`stage0_*` only appears when the backend's clarification stage is enabled
(`CLARIFICATION_MAX_ROUNDS` > 0 on the backend; off by default). `*_start`
events exist purely to drive per-stage loading spinners in the UI — they
carry no payload. `title_complete` runs concurrently with the pipeline and
may arrive before or after `stage3_complete`; the frontend handles either
ordering.

## Event Payloads

### stage0_round_complete

Emitted when the chairman has clarification questions for the user. **The
SSE stream closes after this event** — the client must open a new stream
(same conversation, `POST .../message/stream`) with `{"answers":[...]}` as
the body to continue.

```json
{
  "type": "stage0_round_complete",
  "data": {
    "round": 1,
    "questions": [
      { "id": "q1", "text": "What database are you currently using?" },
      { "id": "q2", "text": "What is prompting this migration?" }
    ]
  }
}
```

The frontend's `Stage0` component renders each question via `react-markdown`
with a free-text answer box; "Skip" submits all-empty answers, which the
backend treats as ending the clarification loop.

### stage0_done

Emitted when the clarification loop ends (chairman satisfied, round limit
reached, or the user submitted all-empty answers). `stage1_start` /
`stage1_complete` follow immediately on the same stream.

```json
{ "type": "stage0_done" }
```

### stage1_start / stage2_start / stage3_start

No payload — flip the corresponding `loading.stageN` flag in the UI.

```json
{ "type": "stage1_start" }
```

### stage1_complete

```json
{
  "type": "stage1_complete",
  "data": [
    { "label": "Response A", "content": "...", "model": "openai/gpt-5.1", "duration_ms": 1240 },
    { "label": "Response B", "content": "...", "model": "anthropic/claude-sonnet-4.5", "duration_ms": 980 }
  ]
}
```

Labels are assigned sequentially (`A`, `B`, `C`, …). The label → model
mapping is revealed in `metadata.label_to_model` at `stage2_complete`.

### stage2_complete

`metadata` is a **top-level field** on the event, not nested inside `data`.
`kind` is a discriminator selecting how the frontend renders Stage 2 — see
[Stage 2 `kind` values](#stage-2-kind-values) below. Defaults to
`"peer_ranking"` when absent/empty (older backends, or a malformed event).

```json
{
  "type": "stage2_complete",
  "kind": "peer_ranking",
  "data": [
    { "reviewer_label": "Response B", "rankings": ["Response A", "Response C", "Response B"] }
  ],
  "metadata": {
    "council_type": "default",
    "label_to_model": { "Response A": "openai/gpt-5.1", "Response B": "anthropic/claude-sonnet-4.5" },
    "aggregate_rankings": [{ "model": "openai/gpt-5.1", "score": 1.5 }],
    "consensus_w": 0.83
  }
}
```

`aggregate_rankings` is sorted by `score` ascending (lower = better).
`consensus_w` (0–1) indicates agreement across reviewers — this field is
specific to `peer_ranking`.

#### Multi-round strategies — `stage2_round_complete`

Two strategies (`MultiAgentDebate`, `Delphi`) run multiple rounds. Each fires
one `stage2_round_complete` per round, then a terminal `stage2_complete`
carrying the cumulative transcript:

```
data: {"type":"stage1_complete", "data":[...]}
data: {"type":"stage2_round_complete", "kind":"debate_round", "round":1, "data":[], "metadata":{"debate":{"rounds":[{"round":1,"revisions":[...]}],"final_round":1}}}
data: {"type":"stage2_round_complete", "kind":"debate_round", "round":2, "data":[], "metadata":{"debate":{"rounds":[{"round":2,"revisions":[...]}],"final_round":2}}}
data: {"type":"stage2_complete", "kind":"debate_round", "data":[], "metadata":{"debate":{"rounds":[{"round":1,...},{"round":2,...}],"final_round":2,"dropouts":[...]}}}
data: {"type":"stage3_complete", "data":{...}}
```

Wire-format invariants:
- `round` is **required** on `stage2_round_complete` (not omitempty) — the
  event is meaningless without it. The terminal `stage2_complete` omits
  `round` when zero.
- Each per-round event's transcript field (`metadata.debate.rounds` or
  `metadata.delphi.rounds`) carries **only that round**. The terminal event
  carries the **cumulative** transcript across all rounds.
- A client that misses round events can still render the full result from
  the terminal `stage2_complete` alone — persisted/replayed conversations
  only ever carry the terminal state.

### stage3_complete

```json
{
  "type": "stage3_complete",
  "data": { "content": "The trolley problem is a thought experiment...", "model": "openai/gpt-5.1", "duration_ms": 1100 }
}
```

### title_complete

```json
{ "type": "title_complete", "data": { "title": "The trolley problem is a thought experimen" } }
```

May be absent if title generation exceeds a 30-second deadline. The title is
derived from the first 50 **bytes** of the Stage 3 response — multi-byte
UTF-8 characters may be cut mid-character. The frontend reloads the
conversation list on this event.

### complete

```json
{ "type": "complete" }
```

Stream finished — no payload. The frontend sets `isLoading = false` and
reloads the conversation list.

### error

```json
{ "type": "error", "message": "council quorum not met" }
```

Stream terminates immediately after this event — no `complete` follows. The
frontend sets `msg.error = event.message` and resets all `loading.*` flags.

---

## Stage 2 `kind` values

| `kind` | Strategy | `data` | Metadata field | Round-based? |
|--------|----------|--------|-----------------|--------------|
| `peer_ranking` | PeerReview | `StageTwoResult[]` | `label_to_model`, `aggregate_rankings`, `consensus_w` | no |
| `role_stub` | RoleBased | `[]` | `aggregate_rankings: []`, `consensus_w: 1.0` | no |
| `vote_tally` | Majority | `[]` | `vote_tally: {clusters: VoteCluster[], winner_label}` | no |
| `rank_refine` | GenerateRankRefine | `[]` | `rank_refine: {rankings: RankedCandidate[], top_k, criteria}` | no |
| `debate_round` | MultiAgentDebate | `[]` | `debate: {rounds: DebateRound[], final_round, dropouts?}` | yes |
| `moa_aggregator` | MixtureOfAgents | `[]` | `moa_aggregator: {aggregators: AggregatorOutput[]}` | no |
| `delphi_round` | Delphi | `[]` | `delphi: {rounds: DelphiRound[], final_round, converged, criteria}` | yes |

For every kind except `peer_ranking`, `data` is empty — the actual Stage 2
content lives in the strategy-specific `metadata` field, not per-reviewer.
An unrecognised `kind` renders via a fallback view
(`Stage 2 — kind: <X> (view not implemented yet)`) rather than crashing.

The frontend UI does not currently expose strategy selection — it always
sends `council_type: "default"`. Which strategy that resolves to (and thus
which `kind` you'll actually see) is decided by backend configuration. See
[api-contract.md](./api-contract.md) for the full JSON shape of each
metadata sub-object.

## Frontend Implementation

`src/api.js` reads the SSE stream using the Fetch API and a `ReadableStream`
reader, buffering incomplete lines across TCP chunk boundaries:

```javascript
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = done ? '' : lines.pop();

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const event = JSON.parse(line.slice(6));
        onEvent(event.type, event);
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    }
  }

  if (done) break;
}
```

`App.jsx`'s `makeStreamHandlers` maps each `eventType` to a state update:

| Event | State change |
|-------|---------------|
| `stage0_round_complete` | `msg.pendingClarification = event.data`, clears `loading.stage0`/`loading.stage1` |
| `stage0_done` | clears `pendingClarification`, `loading.stage1 = true` |
| `stage1_start` | `loading.stage1 = true` |
| `stage1_complete` | `msg.stage1 = event.data`, `loading.stage1 = false` |
| `stage2_start` | `loading.stage2 = true` |
| `stage2_round_complete` | appends into `msg.metadata.<debate\|delphi>.rounds`, sets `msg.stage2Kind` |
| `stage2_complete` | `msg.stage2 = event.data`, `msg.stage2Kind = event.kind`, `msg.metadata = event.metadata`, `loading.stage2 = false` |
| `stage3_start` | `loading.stage3 = true` |
| `stage3_complete` | `msg.stage3 = event.data`, `loading.stage3 = false`, marks conversation closed, reloads conversation list |
| `title_complete` | reloads conversation list |
| `complete` | reloads conversation list, `isLoading = false` |
| `error` | `msg.error = event.message`, resets all `loading.*` flags, `isLoading = false` |

Unknown event types are silently ignored (`handlers[eventType]?.(event)`).
