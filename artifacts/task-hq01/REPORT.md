# Task HQ 01 — preserve and continue

Completed two narrowly scoped task-data fixes and added local acceptance coverage. Calendar, navigation, sidebars, top bars, routes, drawer implementations and their styling were not edited or repaired in this continuation. Quest Task HQ and Novum Workspace remain separate; no files in Novum Workspace were accessed or changed.

## Preserved state

- Worktree/root: `/private/tmp/quest-b03-adaptive-flow`.
- Repository: `https://github.com/Lumen-Marketing/task-management-platform.git`.
- Branch: `ux/b03-adaptive-flow`; HEAD remains `2a3fd83`.
- Recent commits include Batch 2 PR #14 merge `2a3fd83`, compact Home metrics `cc2a045`, PR #13 merge `2302aa0`, and earlier Batch 2 changes `e0bbaa4`/`5afa2e1`.
- `git worktree list` confirmed this isolated worktree alongside the existing main development, Batch 2/review and release worktrees; none was switched, cleaned or changed.
- Starting inventory: 18 modified tracked files plus untracked AGENTS.md, B03/B04 review scripts, drawer/focus implementation/tests and artifacts. SHA-256 hashes captured for all 65 existing modified/untracked files; every one remained byte-identical at final preservation check.
- Final tracked inventory: 28 modified files (the original 18 plus 10 in-scope files below). Prior untracked work remains, with this report added. Nothing staged or committed. No reset, clean, stash, revert, push, deployment or production-data writes.

## Requirements assessed and work completed

Reviewed README.md, READINESS.md, the functionality implementation map, T1/T2 sprint evidence, backend/dependability records, project AGENTS.md, task engine/contract/permissions, task form handlers and existing adapter/database regressions. Historical deployment/account statements in those records were not treated as current live proof.

### Confirmed-state persistence boundary

`dispatch` already required HTTP success; `load` and `tick` trusted a JSON `ok:true` even on a failed HTTP response. Tests reproduced 401/500 loads being accepted and a failed tick replacing revision 1 with revision 99. Both paths now require HTTP 2xx before remembering state. Regressions prove cached revision/capabilities remain intact, subsequent valid loads recover, and valid ticks still advance state.

### Task field clearing

The engine merged optional type/time edits using `??`, so explicit clearing retained the old value. Task form handlers also sent `undefined`, which JSON removes before the server receives it. Clearing a due date could leave a time without a date.

The existing task forms now send empty-string clearing values, which survive JSON. Due-date clearing includes time clearing when that capability is supported. The engine honors present fields and drops an existing time when its date is removed; explicit time-without-date remains refused. Existing ownership, permissions and lifecycle rules are unchanged. Local dispatch and v6 candidate engine copies received exactly the same minimal patch; the frozen v5 source was not modified. Compatibility tests demonstrate JSON-safe clearing against frozen v5.

### Task workflow acceptance evidence

Existing engine tests cover creation, assignment, start, help/blocking, resolution, review/approval, completion, dependency release, reopening/archive, undo and role enforcement. The added database-path test verifies task title/description/next action/due date reload across synthetic sessions; comment/mention text and actor history persist; reviewer edits and former-owner edits are refused; reassignment retains earlier comments and records the acting owner.

Mention text persistence is proven here; no external notification or hosted mention delivery is claimed. Existing reference tests separately exercise stable reference identities and metadata locally.

## Exact files changed in this continuation

1. `src/adapter/live.ts`
2. `src/adapter/live.test.ts`
3. `src/app/TaskControls.tsx`
4. `src/app/TaskPage.tsx`
5. `src/core/engine.ts`
6. `src/core/engine.test.ts`
7. `supabase/functions/dispatch/core/engine.ts`
8. `deploy/dispatch-live/v6/core/engine.ts`
9. `deploy/dispatch-live/v6.test.ts`
10. `tests/db/live-e2e.test.ts`

Plus this report and preservation evidence under `artifacts/task-hq01/`. No schema, migration, policy, membership, database configuration or external-service settings were modified. Server engine files are local source candidates only, not deployed functions. No new application abstraction or feature was introduced.

## Actual checks

- Initial targeted baseline: 63 engine/adapter/reference/permission tests and 4 local database-path tests passed.
- Red regressions before fixes: 3 adapter cases failed (two loads accepted, failed tick poisoned revision); 1 optional-field clearing test failed (old type retained). All resolved.
- Wider regression command: `node --test src/core/*.test.ts src/adapter/store.test.ts src/adapter/live.test.ts supabase/functions/dispatch/*.test.ts deploy/dispatch-live/v6.test.ts` — **232 passed, 0 failed**.
- `node --test tests/db/live-e2e.test.ts` — **5 passed, 0 failed**. PGlite in-memory SQL, local candidate handler, stubbed Supabase auth and subscriptions. No hosted connection or actual account was used.
- Final small guard refinement (avoid reclassifying date-only tasks with no saved time): `node --test src/core/engine.test.ts deploy/dispatch-live/v6.test.ts` — **17 passed, 0 failed**.
- App TypeScript (`npx tsc --noEmit`) and server TypeScript (`npx tsc -p tsconfig.server.json`) — PASS.
- Browser configuration validation — PASS; current configured hostname matches the existing production backend documented in README. No local server was started.
- Isolated application build — PASS, output `/private/tmp/quest-task-hq01-build`; existing >500 kB chunk warning remains.
- `git diff --check` — PASS. Three current engine copies match byte for byte; v6 parity check passes.
- `npm test` wrapper not used: it deletes/rewrites generated server directories through sync:functions. Equivalent relevant test files were invoked directly to preserve unrelated work.
- No browser/server, real-account, physical-device, hosted Auth/PostgREST/RLS/Realtime or external-service acceptance was run. Rendered UI acceptance involving parked navigation/drawers is deferred. No component was recovered or modified to make a check pass.

## Remaining acceptance and blockers

1. Current hosted task create/edit/assign/status/comment reload, Realtime synchronization and negative authorization still need an explicitly approved non-production target and two approved account sessions. Existing production-pointing configuration is not a safe test target under this request. Local tests do not close this criterion.
2. Task date/time/type clearing is verified at engine/JSON contract level and statically typechecked, including v5 compatibility. Actual rendered form interaction remains unverified; no server was started under the production-pointing environment.
3. Capability-gated fields remain unavailable on older server contracts; no server release or widening of advertised capabilities occurred. Candidate engine fixes remain local until an independently authorized release.
4. Calendar/navigation/drawer acceptance is parked per the latest instruction, not certified or repaired in this pass. Broader messaging, provider integrations, membership/invitations and external notification delivery were not added.

Highest-value next action: provide/configure an approved isolated non-production Task HQ target and two authorized test sessions, then verify the existing task create → assign → edit → comment → complete → reload workflow without changing parked components or production data.
