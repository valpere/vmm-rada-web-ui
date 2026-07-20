# Anti-Patterns — vmm-rada-web-ui

Approaches that keep failing or are explicitly banned. When about to try one — stop.

## From CLAUDE.md / context-essentials.md
- ❌ `--no-verify` on git operations
- ❌ Direct `fetch` in components — must go through `src/api.js`
- ❌ Raw HTML rendering of LLM output — `react-markdown` only (XSS risk)
- ❌ State writes outside `App.jsx`
- ❌ TypeScript (plain JS project by design)
- ❌ Commits skipping pre-commit hooks unless user explicitly requests

## Learned (auto-promoted)

---
