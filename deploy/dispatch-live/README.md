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
