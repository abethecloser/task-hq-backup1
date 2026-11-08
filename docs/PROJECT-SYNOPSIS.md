# Task HQ — living project synopsis

**Now (2026-11-08):** evolving the existing product, not rebuilding. Two increments done on `feat/task-hq-adaptive-surface` (local + origin up to Clarify); command palette is local only. Production (`task.questroofing.com`) = `main` @ 91202d1; neither increment is deployed.

## State recovered
- `main` @ 91202d1 (PR #52). Branch is 1 ahead, 6 behind; merge `main` in before a PR.
- Uncommitted work by the owner, untouched: `src/app/App.tsx`, `Home.tsx`, `src/ui/home.css`, `docs/design/`.
- Already in the product (verified in tree, not rebuilt): Home operating desk, adaptive rows with Compact/Standard/Detailed density, spatial shell (`docs/SPATIAL-SHELL.md`), global search (`Search.tsx`), `dependsOn` + blocking/dependents selectors, event log, org-role authority.
- QuestBase repo not touched (out of scope by directive).

## Implemented this session
| Increment | Files | Evidence |
|---|---|---|
| Clarify (provider-neutral, human-approved rewrite of unclear next actions) | `core/clarify.ts`, `app/ClarifyPanel.tsx`, `ui/clarify.css` | 15 unit tests; Playwright at 1280/820/390 |
| Command palette ⌘K / Ctrl+K: go to page, find task, New task | `core/palette.ts`, `app/CommandPalette.tsx`, `ui/palette.css`, mounted in `TopBar.tsx` | 5 unit tests; full suite 438/438; Playwright 1280/820/390 (open, rank, Enter navigates, Esc closes, no overflow, focus) |

## Cloudflare patterns: selected / not yet
- **Applied:** keyboard-first quick search and command palette (ref F).
- **Not started (next, by value):** task resource tabs; dependency explorer / workflow view (ref E); table column/view persistence + AND/OR filters (ref G); event-style delay investigation (ref D).
- **Not yet studied from source:** Kumo repo, dashboard, navigation case study. No Cloudflare dependency or branding is used.

## Known gaps
- Palette: demo top bar showed no New task action (create wiring is `onCreate`, absent there); status/assign/comment commands and shortcut help not built; palette→task page rendering confirmed by route only, not by reading the title.
- Stale protection for Clarify is client-side only.
- Workbook not located in this session; not a prerequisite.

## Next highest-value actions
1. Dependency explorer on the task page (uses existing `dependsOn`/`blockingDeps`).
2. Palette: status/assign/comment commands through the engine, shortcut help.
3. Merge `main` into the branch and open a PR (needs the owner's go-ahead to merge/deploy).
