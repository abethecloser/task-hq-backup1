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
