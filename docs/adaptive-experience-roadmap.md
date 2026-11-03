# Task HQ adaptive experience roadmap

**Direction:** one engine, one record, many expressions. Presentation adapts to role, urgency, density and the action under way. Authority never does: it stays with the server and the engine's authorized offers. Task HQ owns its complete standalone experience; QuestBase owns platform integration, cross-tool intelligence and The In-Between.

| # | Slice | What people get | Reuses | Status |
|---|---|---|---|---|
| 1 | Verified task entry | Links open the right task and workspace through sign-in | Task route, auth | PR #49 |
| 2 | Adaptive task rows | Every row says who acts now. Rows open in place into moves, evidence and history, then grow into the full task. Compact, Standard and Detailed density. Tasks opens on My work for members | `responsibility`, `composeForTask`, `SituationView`, `TaskConversation` | This slice |
| 3 | Same surface on Board and Calendar | Opening a card or calendar item uses the same panel, so there is one way to look closer | `TaskPeek` | Next |
| 4 | What this unblocks | Completing work shows what it released and who owns it, with a one-click Start for that owner | `dependents`, event effects, `Latch`, `FeedbackBar` | Next |
| 5 | Home by role | Default module order follows the work: members start with Today's Focus, coordinators with Signals, owners with decisions. Saved layouts are untouched | Dashboard presets, `coordinates` | Next |
| 6 | Trustworthy KPI signals | Every number states its basis and sample, and opens the records behind it. One definition of "completed" | `companyReport`, `performance`, `operationalMeasures` | Next; definitions below need settling |
| 7 | Durable comments and history | Conversations and history that don't age out | New server storage | Needs a decision |

## Decisions to escalate
- **Slice 7 is a data-integrity change.** Comments and per-task history live in an org-wide event list capped at 400 entries (`src/core/engine.ts`), so "expand into history" can silently lose older entries. Fixing it needs a migration and a `dispatch` change.
- **Per-task privacy.** Every member receives all of a workspace's work, and "my tasks" is an on-screen filter. Real privacy would be a server change.
- **KPI definitions (slice 6).** Home credits completions to the owner while Reports credits who completed the task. Archiving or reopening work changes past totals.

## Preserved in every slice
Approved Baseline v1.0: white continuous workspace, server-confirmed outcomes, 44px phone targets, reduced-motion support and evidence labels. Automated checks, simulated-backend journeys, and real-account verification are always reported separately.
