---
title: "Add a strategy picker to the UI"
type: feature
priority: p2-medium
status: draft
debt: balanced
effort: m
component:
  - ui
  - stage2
  - config
labels:
  - enhancement
  - p2-medium
  - ux
blocked_by: null
github_issue: null
created: 2026-07-31
updated: 2026-07-31
---

## Summary

`handleSendMessage` in `src/App.jsx:324` hardcodes `council_type: 'default'`
on every request. All 7 backend deliberation strategies are already fully
supported end-to-end — `deriveStage2Kind` and the `Stage2.jsx` dispatcher
handle every `kind` value, `docs/streaming.md` documents all 7 payload
shapes — but there is no UI affordance to choose anything but the default.
This has been a documented gap in `CLAUDE.md`'s "Known gaps" section since
before this plan existed; the 2026-W30 dreaming report (§7, "Patterns I
noticed") flagged it as "the highest-value, lowest-risk product work
available" given the backlog was otherwise empty.

## Acceptance Criteria

- [ ] A strategy picker UI element lets the user choose a `council_type`
      before sending a message (or per-conversation — see Approach).
- [ ] `handleSendMessage` sends the selected `council_type` instead of the
      hardcoded `'default'` literal.
- [ ] The default selection remains `'default'` — no behavior change for
      users who don't interact with the picker.
- [ ] If the backend rejects an unregistered `council_type` (see Risks),
      the resulting error surfaces through the existing error-handling path
      (`msg.error`), not a silent failure.
- [ ] `CLAUDE.md`'s "Known gaps" entry for the strategy picker is removed
      once this ships.
- [ ] The picker sends a value from the fixed enum of 7 known
      `council_type` strings — never free text — to avoid arbitrary
      `council_type` injection (flagged by security-reviewer during this
      plan's pre-PR review).

## Implementation

### Files to change

- `src/App.jsx` — `handleSendMessage` needs a `council_type` value to send;
  state for the current selection must live here per the immutable
  App.jsx-owns-all-state rule.
- `src/components/ChatInterface.jsx` or `src/components/Sidebar.jsx` — the
  picker UI itself (pure UI, no `api.js` calls — passes the selection up via
  a prop/callback into `App.jsx`, same pattern as existing user-input
  handlers).
- `CLAUDE.md` — remove the "Known gaps" bullet once shipped.

### Files to read (context only)

- `src/components/Stage2.jsx` — confirms the dispatcher already handles all
  7 `kind` values; no changes needed here.
- `docs/api-contract.md:143-156` — the `council_type` request field is
  already documented; note whether its description needs updating once a
  picker exists (currently says "defaults to the backend's
  `DEFAULT_RADA_TYPE` env var" when omitted — still true, the picker would
  just stop omitting it).

### Approach

Two open design questions with real trade-offs — resolve before implementing,
not during:

1. **Where does the picker live?** Options: (a) a dropdown in the chat input
   area, selected per-message; (b) a per-conversation setting chosen once
   when a conversation starts, immutable after the first message (mirrors
   how `council_type` actually behaves server-side — it's read once per
   request, but changing strategy mid-conversation on already-persisted
   messages would produce a conversation with mixed `stage2Kind` values,
   which the frontend already handles via replay's shape-based
   `deriveStage2Kind`, but may be a confusing UX).
2. **What's the source of truth for the available strategy list?** The
   backend has no "list registered council types" endpoint (verified: not
   in `docs/api-contract.md`'s Endpoints section). Options: (a) hardcode the
   known 7 wire values (`default`, `role-based`, `majority`,
   `generate-rank-refine`, `debate`, `moa`, `delphi` — these are stable,
   documented in the backend's `configs/council.yaml` header comment as
   wire-compatible identifiers that won't change), accepting that a given
   backend deployment may not have all 7 registered (request fails at
   send-time with a normal error, same as any other invalid input); (b) file
   a backend issue requesting a discovery endpoint first, blocking this plan
   on that. Given the backend explicitly commits to the 7 names staying
   stable, (a) is very likely the right call for a first version — no backend
   change required, ships faster, and the failure mode (a strategy not
   registered on this deployment) is no worse than any other 400/503 the
   app already surfaces.

### Risks / Unknowns

- **Very likely fine:** the 7 wire values are stable per the backend's own
  `configs/council.yaml` header comment (a repo the current investigation
  already read directly) — hardcoding them client-side is low risk.
- **Likely needs a decision, not a default:** per-message vs.
  per-conversation strategy selection (open question 1 above) — surface
  this to the user/reviewer rather than picking silently.
- **Unlikely but possible:** a backend deployment has fewer than 7 strategies
  registered (e.g. `configs/council.yaml` omits one, or the legacy env-var
  path is in use with only some `*_MODELS` vars set) — the picker would
  offer a strategy that 503s or 500s at send time. Acceptable for v1; a
  future backend discovery endpoint would close this gap.

## Not in Scope

- A backend endpoint to list registered strategies (see Risks) — this plan
  assumes the hardcoded 7-value list.
- Per-strategy configuration UI (model rosters, temperature, etc.) — only
  strategy *selection*, not strategy *configuration*.
- Changing the default strategy or any existing strategy's behavior.

## Commit Message

```
feat(app): add strategy picker to chat UI ⚖️
```

## After Implementing

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Manual smoke test with backend running: send a message with each of
      the 7 strategies, confirm Stage2.jsx renders the correct view for
      each
- [ ] `/ship` to create PR and merge
- [ ] Remove the "Known gaps" bullet in `CLAUDE.md`
- [ ] Move plan status to `done`, fill `github_issue` if created
