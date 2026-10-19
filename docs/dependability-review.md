# Dependability review: legacy Quest HQ findings applied to Task-HQ (2026-10-17)

Sources (historical evidence about Quest HQ, not Task-HQ):
- `quest-hq/findings/authority-parity.md`
- `quest-hq/findings/runtime-observation-boundary.md`
- experiments 001 and 002
- the old harnesses
- the ROI & Metrics Framework

No Quest HQ code, schema, identities or data were copied; only techniques were reused.

## 1. Already addressed in Task-HQ

- **One source of task authority.**
  - The browser and the server run the same engine (`src/core/engine.ts`, synced into dispatch).
  - The server rebuilds people and roles from real memberships before every action.
  - Most UI offers (situations, Executive Desk options) are engine dry-runs.
  - Quest HQ's root cause, a client mirroring one of two differently shaped server functions, doesn't exist here.
- **Successful writes are audited** (`commit_workspace_action`), and revision conflicts never fabricate a save.
- **Tenant isolation** is enforced by RLS and security-definer functions, with no client write grants.
- **Operational signals already present:**
  - Speed to Lead first-response timing;
  - stalled-work rule;
  - handoff history (reassignments, send-backs);
  - the Decision Desk.

## 2. Genuinely missing (before this pass)

1. **UI predicates that aren't dry-runs** had no parity check: Move Work Forward, reopen, New task, the Ultra field lock, and every People & Roles control.
   - They *are* in parity today (tests below).
   - One real divergence existed: an **admin** could select a person planned as **Admin** for invitation. The server refuses (only owners invite admins), so the all-or-nothing batch failed. **Fixed.**
2. **Refused and failed writes left no durable trace.** The client showed a toast and the server returned an error, with nothing recorded. This is the same condition the Quest HQ research found.
3. **Automatic consequences were prose only.** Unlocking dependents, assigning their owner, hand-offs and focus release appeared in event text. Nothing structured said which task, or why a dependent *wasn't* unlocked.
4. **No executable test of browser → server → database.** The server tests used scripted database replies.
5. **The owner-invite security gap** was only a document, not a failing test.

## 3. Smallest improvements made

- `src/core/permissions.ts` and `src/app/authority.ts`: the UI's permission checks as pure functions the screens import, so the same code is tested.
- **Events gain optional `effects`** (`rule`, `outcome: executed|skipped`, `taskId`, `owner`, `reason`), written only by task completion. Old events are unaffected and undo still works.
- **Dispatch writes `task.<type>.denied` / `task.<type>.failed`** to `audit_log`: actor, target ids, reason, revision, no payload. Revision conflicts the client retries are skipped. The audit write never changes the reply. *Takes effect with the next dispatch deploy.*
- **Operational measures** (`src/core/metrics.ts`) in the existing Executive Desk:
  - lead first response (median, within target);
  - blocked → resolved (median);
  - stalled now;
  - reassignments per completed task;
  - rework (send-backs + reopens);
  - decisions waiting on the principal.

  Each shows its sample size and window. **Measurement → estimate ready** is shown as *not measured*, because there are no estimating records yet. No baselines, savings or ROI figures.
- **`npm run test:db`:** Task-HQ's migrations on an in-memory Postgres (PGlite, one pinned dev dependency, the existing `node --test`), with Supabase auth stubbed.

## 4. Test results

| Suite | Result |
|---|---|
| `npm test` | 117 passed, 0 failed |
| Task parity (`src/core/parity.test.ts`) | Every person × task × action in 5 states (incl. Critical Focus and granted access): no UI offer the engine refuses, no hidden action the engine accepts. A deliberately broken predicate makes it fail. |
| `npm run test:db` | 8 passed, 0 failed |
| `rls_isolation.sql` | Passes with the platform-admin checks included (≥36) |
| `team_staging.sql` | 54 / 54 |
| `platform_owner_invite.sql` | **Fails on the production baseline** (detects the gap), passes with the candidate fix |
| Membership parity | 5 roles × invite, approve, change role, remove, stage, prepare invitation, against the real SQL. 0 server-stricter cases. The 7 UI-stricter cases are listed and harmless (self-removal, owner self-demotion, admin planning an Admin). The old bug makes it fail. |
| Browser → server → database | Real `createLiveBackend` → real `handleDispatch` → real SQL as `service_role`.<br>**Shared work:** create/assign by one user, then start/complete by another in a separate session; the reload matches database revision 4, and executed writes are audited.<br>**Outcomes:** executed (unlock effect persisted), denied (reviewer: no change, audit row with reason), failed (commit refused: audit row, nothing visible).<br>**Isolation:** another organization and an unknown session are refused. |

**Limitations:**
- Stubbed Supabase auth, no PostgREST, no Realtime, no real browser.
- The end-to-end test runs the **candidate** dispatch with the operational-attention migration, not dispatch v3 in production. This is the first execution of those commit and initialize functions, and they passed.

## 5. Decisions that need authorization

1. **Anyone can reassign anyone's task.** Any operational member can change the owner or approver of any non-Ultra task. The UI and server agree; whether it should be narrower is Abraham's call.
2. **Deploying the candidate server.** The operational-attention migration, then dispatch. That brings denied/failed auditing and live reopen to production.
3. **The owner-invite hardening migration** (security gap proven above).
4. **ROI numbers:** Abraham's twelve inputs and a 20–30 job baseline sample (framework sections B and C) before any savings figure is stated.
5. **A real staging target** for the remaining live checks: Realtime and real sign-in.
