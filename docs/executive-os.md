# Quest OS executive layer (Executive Brief, Decision Desk)

Task-HQ is still the execution engine. Quest OS is a read-only intelligence layer over the same `QuestState`. It never changes anything by itself. Each option it offers is an engine action that the UI performs with `apply()` only after the principal confirms, and the engine still decides what is allowed.

The goal is fewer things for the executive to manage. Every item is either **needs you** (on the desk, or the person asked is you) or **with the person who owns it**, and the headline counts only the first group.

## What exists

| Piece | File | Status |
|---|---|---|
| Executive Brief | `src/core/executive.ts` → `executiveBrief(state, now, principal, { since?, calendar? })` | Working on Task-HQ records |
| Decision Desk | `decisionDesk(state, now, principal)` | Working; options are dry-run against the engine |
| Follow-up intelligence | `followUps(state, now, principal)`, `handoffHistory(state)` | Working |
| Owner recommendation | `recommendOwner(state, { task \| lead }, exclude)` | Working; deterministic, explained |
| Daily Signal | `dailySignal(state, now, day?)` | Task-HQ source only; other sources reported `not-connected` |
| Voice-first commands | `src/core/executive-commands.ts` → `parseExecCommand`, `runExecCommand` | Text input works; voice is a contract only |
| Tests | `src/core/executive.test.ts`, desk soundness in `src/core/simulate.test.ts` | 14 scenario tests, plus a seeded property check |
| Demo | `node scripts/executive-demo.ts` (also `--ask "Who needs me?"`, `--principal maya`) | Synthetic data only, runs in-process |

There is **no screen yet**. That is Copilot's area (see the handoff below).

## Live vs simulated

- **Live (works on a real workspace today):** Brief, Desk, follow-ups, Daily Signal and the commands all run on whatever `QuestState` they are given, including a live workspace loaded from `workspace_state`. Every item carries `source: { kind, id, synthetic }`. `synthetic` is true when `workspace.plan === 'local-demo'` or `lead.simulated`.
- **Simulated / not connected:**
  - **Calendar:** shows only when an authorized feed is passed in as `calendar`. Otherwise the section says `not-connected` and has zero items.
  - **Business calls, email and customer interactions:** listed in the Daily Signal as `not-connected`. Nothing reads them, and private communications are never read.
  - **Voice:** `modality: 'voice'` is accepted, but no speech service exists. A future adapter turns speech into the same text and reads `spoken` aloud.
  - **"Since your last briefing":** the caller passes `since`, and nothing stores it yet. History is capped at 400 events; when `since` is older than that, the section says `partial`.
- **The demo principal:** in the demo workspace, "Abraham" is the reviewer persona, and the engine refuses him all operational actions by design. The demo therefore runs the desk for Jordan Lee (Operations Manager), labeled as the synthetic stand-in.

## Decision Desk rules

A decision is listed only when it needs the principal's authority. An engine dry-run never decides this.

| Kind | When | Options (recommended in bold when it applies) |
|---|---|---|
| `access` | Pending Critical Focus request that the principal may decide (never their own) | **Allow**, Deny |
| `approval` | In review, and the principal is the approver, or there is no approver and the principal is a manager | Approve (**when work waits on it**), Send back (note required), **Let another manager or coordinator approve** (when nothing waits) |
| `escalated-lead` | Escalated to the principal, or to nobody and the principal is a manager | **Back to the owner with a follow-up date** (clears the escalation), or Give to sales when unowned; Hand on to delivery |
| `needs-your-call` | Blocked and the principal is the helper asked, or the decision owner | Resolve, **Ask someone else** (unless it is explicitly the principal's call) |
| `unowned-priority` | Manager principal; unowned work that is high priority or due | **Assign the recommended person**, Assign someone else |

Each option has `supported`, plus `refusal` with the engine's own reason. It is performed through `offer` (collect `offer.inputs`, then `actionFor` + `apply`) or through `action` (`apply` directly). The seeded walk checks that every option marked supported is accepted.

Delegation never recommends the principal, a reviewer, or anyone in `exclude`.

## Follow-up intelligence

- **Sources:** `no-owner`, `stalled`, `unanswered-lead` and `missed-deadline` come from the existing `insights()` rules.
- **`handoff-failure`:** detected from event structure: 3 or more reassignments, or 2 or more send-backs, on an open task. Undone events are ignored.
- **Suggested actions:** one-click actions appear only when the engine accepts them for the person who handles the item.

## Commands (text today, voice later)

| Command id | Example phrases | Returns |
|---|---|---|
| `holding-us-up` | "What's holding us up?" | Blocked and unowned work, and who has each item |
| `who-needs-me` | "Who needs me?" | Desk decisions, plus follow-ups only the principal can do |
| `what-happened` | "What happened today?" | Changes since `since` if given, otherwise today's Daily Signal |
| `assign` | "Assign this to the right person." | A **proposal** (`kind: 'action'`) for the selected task or lead. Nothing changes until it is confirmed |
| `summarize-day` | "Summarize my day." | The brief headline, section counts, and the Daily Signal summary |

The response is `ExecResponse`: the existing `Intent` union from `intent.ts` plus `command`, `spoken` (short, read-aloud sentences) and `sources`.

## Handoff: Copilot (presentation)

- Render `executiveBrief(...)` and `decisionDesk(...)` for the signed-in principal.
- Show `needsPrincipal` items first, and mark `onDesk` items in other sections as "on your decision desk".
- For an option with `offer.inputs` (a note or a date), collect those values before calling `actionFor` + `apply`. Never auto-perform a recommendation.
- Show `not-connected` and `partial` sections with their `note`, never as empty success.
- Changes to existing UI behavior from this work:
  - `Insight.action` is now omitted when the engine would refuse it for `insight.who` (Critical Focus, unmet dependencies, self-approval).
  - An approval with no approver now routes to a manager.
  - An access request never routes to the person who asked. Under `manager-context`, if the activating manager requested it, `who` is `''`.

## Handoff: Codex (server, persistence, security)

- **Engine changes:** `src/core/engine.ts` changed in two places, found by the seeded simulation and covered by tests.
  - `lead/advance` now completes the follow-up task through the normal completion path: it clears the blocker, unlocks dependents and releases focus.
  - `undo` of a task creation is refused when other work depends on that task.
  - **Server impact:** the next `npm test` / `sync:functions` copies them into `supabase/functions/dispatch/core`, and they reach the server on the next dispatch deploy. `logic.test.ts` passes against the new engine. Nothing has been deployed.
- **Live authority:** `peopleFrom` maps any member whose `work_role` isn't recognized, owners included, to `field`. Unless the executive's live membership has `work_role = manager`, the engine refuses them approvals, and their desk shows those options as unsupported.
- **Permissive `task/update`:** any operational member may change `approver` or `owner` on non-Ultra tasks. The desk doesn't rely on that for authority, but the server may want to restrict it.
- **Persistence needed:** storing the last-briefing time per principal, which drives "changes since".
- **Not yet built:** any calendar, call, email or customer integration. Each needs its own authorization decision.

## Open product questions (not decided here)

- **Self-requested access deadlock:** under `manager-context`, if the manager who activated focus is also the person in focus and requests access, nobody can decide it. This is part of the open Only Priority governance decision.
- **Leftover escalation task:** scheduling a follow-up on an escalated lead leaves the separate "Escalated lead: …" task open with the manager. The engine has no de-escalation step that closes it. It is high priority and due the day it was escalated, so it comes back as an overdue item that needs the manager the next day. Suggested engine fix (server-synced, so Codex's call): `lead/follow-up` and `lead/advance` complete an open escalation task through `completeTask`.
- **Delegating a blocker resets it:** "Ask someone else" runs `task/request-help` as the principal. That rewrites `blocker.by` to the principal and restarts `blocker.at`, so the original asker and the blocked-for age are lost.
- **What happened:** "What happened today?" answers for today; other "what happened" phrasing answers since the last briefing when `since` is known.
