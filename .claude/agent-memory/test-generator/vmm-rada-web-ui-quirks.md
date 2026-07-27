---
name: vmm-rada-web-ui-quirks
description: Non-obvious Vitest/RTL quirks specific to this repo's component shapes, useful when generating or extending tests for App.jsx/Stage*.jsx/ChatInterface.jsx.
type: project
---

- **`vi` is global** in this project (`vitest.config` sets `test.globals: true`
  via `vite.config.js`) — no `import { vi } from 'vitest'` needed, matching
  the pattern already used in `App.test.jsx`/`Stage2.test.jsx`.
  **Why:** avoids import-vs-global inconsistency across new test files.
  **How to apply:** just call `vi.fn()`/`vi.mock()`/`vi.hoisted()` directly.

- **Avoid case-insensitive regex text queries when a label and its rendered
  content share a substring** — e.g. Stage3's header span literally reads
  "Final Answer" and its content `<p>` can independently contain the word
  "Final" (e.g. "Final answer text" from LLM content), producing a
  `getByText(/Final Answer/i)` multiple-match error.
  **Why:** RTL's `getByText` throws on ambiguous matches; regex loosens exact
  matching more than expected when test fixtures reuse header vocabulary in
  body content.
  **Evidence:** hit this exact collision in `ChatInterface.test.jsx` when
  asserting Stage3's "Final Answer" header alongside fixture content
  "Final answer text" — fixed by switching to the exact string
  `screen.getByText('Final Answer')`.
  **How to apply:** prefer exact string matches for short header/label text
  when the render tree also includes prop-driven fixture content; save regex
  matching for cases where no legitimate ambiguity risk exists.

- **`Stage0`/`Stage1`/`Stage3` are plain prop-driven components with no
  internal accordion state persisted across prop changes** — `Stage1`'s
  accordion starts collapsed and `activeTab` resets are not needed between
  tests since each `render()` call is a fresh mount.
  **Why:** simplifies test setup — no need to manage/reset internal state
  between assertions within a single test, just drive via `userEvent` clicks
  in sequence.
  **How to apply:** test the collapsed state first, then click to expand,
  then click tabs, all within one `it()` block using a single `render()`.
