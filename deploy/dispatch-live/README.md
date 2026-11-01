# Live `dispatch` Edge Function sources

The repository's `supabase/functions/dispatch` needs database functions from migration
`20261017230608_operational_attention`, which production doesn't have yet. Until that ships,
production runs a patched copy of the version that was live before it.

- `v3-original/`: dispatch v3 exactly as it was deployed (rollback copy). Don't edit it.
- `v4/`: deployed 2026-10-19 as dispatch v4 (verify_jwt on). Changes from v3:
  - Authority comes from organization role (`Person.authority`, rebuilt from memberships on every call). Work-role titles never grant authority.
  - Members create and edit their own work. Supervisors coordinate. Admins handle routine operations. The Owner keeps Ultra Priority authority, access windows, the agent pilot and the workspace identity.
  - `task/comment` is supported, so comments no longer return a 500.
  - Actions the engine doesn't know return 400 instead of 500.

To roll back, redeploy the `v3-original/` files as `dispatch` (same layout, verify_jwt true).

## v5 candidate (not deployed)

- `v5/`: v4's `index.ts`/`logic.ts` write path (direct `workspace_state` update + `audit_log`, no new database functions or migrations) with the current engine from `src/core` (9 files, kept in sync by `npm run sync:functions`).
- Adds task types/tags/due times, `task/reopen`, `lead/claim`, `lead/tags`, `roles/label`, `taxonomy/*`, and stored mention/tag references.
- `task/update` accepts only `EDITABLE_TASK_FIELDS` (src/core/contract.ts). v4 spreads `changes` verbatim, so a member can set `status`, `ultra`, `createdBy` or `id` on their own task with a crafted request (found 2026-10-21; no sign of use in production, which has no `task/update` in its audit log). This is the one deliberate difference on a shared action; rolling back to v4 reopens it.
- Every reply carries `contract: 5`. The client enables those features only when the latest reply advertises it, so client and server can ship in either order, and a rollback to v4 closes the gates again on the next reply.
- `v5-parity.test.ts` (part of `npm test`) runs every action type through v4 and v5 for owner, admin, supervisor, a member titled "manager", a member and a reviewer. Shared actions must match in verdict and stored facts; the added actions are checked against the org-role matrix. It also checks that v4 still loads and acts on state written by v5.
- Deploy: the 11 files in `v5/` as `dispatch`, verify_jwt true. Read them back after deploying. Roll back by redeploying `v4/`. Once deployed, freeze `v5/` (remove it from `sync-functions.mjs`) and start any further change as `v6/`.
- The repository `supabase/functions/dispatch` does not advertise a contract yet; add `contract: 5` (or later) to its replies before it replaces v5.

## v7 candidate (not deployed)

- `v7/`: v6's `index.ts`/`logic.ts` with `CONTRACT = 7` and the current engine (`v7/core` must equal `src/core`; `v7.test.ts` checks it).
- Adds `project/create` `{ name }`.
  - Supervisors, admins and owners can create projects. Members and reviewers are refused.
  - Names must be non-empty, at most 80 characters, and unique (case-insensitive), with up to 200 projects.
  - No migration or new database function. The project is stored in `workspace_state.projects` like the seeded "General" project.
- The app sends `project/create` only after a reply advertises contract 7. Before that it refuses without sending ("needs the server update (dispatch v7)").
- Deploy: the files in `v7/` as `dispatch`, verify_jwt true. Read them back after deploying.
- Roll back: redeploy `v6/`. v6 refuses `project/create` and leaves stored projects untouched.
- After deploying, freeze `v7/` and start further changes as `v8/`. (Deployed; `v7/` is frozen.)

## v8 candidate (not deployed; superseded by v9, frozen)

- `v8/`: v7's `index.ts`/`logic.ts` with `CONTRACT = 8` and the current engine (`v8/core` must equal `src/core`; `v8.test.ts` checks it).
- Adds `task/archive` `{ id, reason: 'legacy' }` for unfinished work.
  - Supervisors, admins and owners only. Members and reviewers are refused.
  - The task keeps its status (it is not marked done, and no completedAt/completedBy is written). `archivedAt`, `archivedBy` and `archivedReason: 'legacy'` are recorded, plus one event: "… archived “X” as legacy data (not completed)."
  - `task/unarchive` returns it to the same status. Until then only comments are accepted on it.
  - Completed-work archiving is unchanged.
  - Archived unfinished work is no longer open (`isOpen`), so it leaves overdue counts, dependencies, lists and reports; the app's active views read the workspace without it.
- No migration or new database function; the fields are stored on the task in `workspace_state`.
- The app sends the legacy reason only after a reply advertises contract 8. Before that it refuses without sending ("dispatch v8").
- Deploy: the files in `v8/` as `dispatch`, verify_jwt true. Read them back after deploying.
- Roll back: redeploy `v7/`. v7 refuses legacy archives, and still reads and writes state that has them (legacy tasks then show as archived; restoring one needs v8).
- After deploying, freeze `v8/` and start further changes as `v9/`.

## v9 candidate (not deployed)

- `v9/`: v8's `index.ts`/`logic.ts` with `CONTRACT = 9` and the current engine (`v9/core` must equal `src/core`; `v9.test.ts` checks it). It includes everything in v8, so v8 doesn't need to be deployed first.
- Adds `project/archive` and `project/unarchive` `{ id }`.
  - Supervisors, admins and owners only. The default project (`general`) can't be archived.
  - Records `archivedAt` and `archivedBy` on the project plus one event. Its tasks are not touched: no status change, no completion, no move.
  - An archived project takes no new tasks (`task/create`) and no tasks moved into it (`task/update`). Tasks already in it stay editable and can move out.
  - Restoring clears the two fields; nothing else changes.
- No migration: projects are stored in `workspace_state.projects`.
- The app sends the new actions only after a reply advertises contract 9. Before that it refuses without sending ("dispatch v9").
- Deploy from an isolated copy, never from the repository root (the root's `supabase/functions/dispatch` is a different handler that needs migration `20261017230608_operational_attention`):
  `rm -rf /tmp/v9 && mkdir -p /tmp/v9/supabase/functions && cp -r deploy/dispatch-live/v9 /tmp/v9/supabase/functions/dispatch && cd /tmp/v9 && supabase functions deploy dispatch --project-ref xthyyxnfjaxmtrqrhyxc`
- Roll back: redeploy `v7/` the same way. v7 and v8 refuse the new actions and still read and write state that has archived projects (archived projects then show as ordinary projects).
- After deploying, freeze `v9/` and start further changes as `v10/`.
