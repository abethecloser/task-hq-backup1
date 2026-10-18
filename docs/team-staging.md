# Team staging: represent people before inviting them

Status: **candidate, not applied to production.**

Production checks so far were read-only:
- Postgres 17.11.
- The only triggers are on `auth.users`. There is no `pg_net`, no database webhooks and no `pg_cron`.
- Realtime publishes only `workspace_state`.
- The only organization is Quest Roofing. **Quest Construction does not exist yet.**
- There are no open invitations and no access requests.

## Files

| Step | File | Writes? |
|---|---|---|
| 1. Preview | `supabase/staging/01_preview_roster.sql` | No. A single `SELECT`, safe on production today, before any migration. |
| 2. Schema | `supabase/migrations/20261018030000_team_staging.sql` | DDL only (two tables, three functions). Apply **on its own**, never with `supabase db push`, because other unapplied candidates sit in that folder. |
| 3. Seed | `supabase/staging/02_seed_roster.sql` | Ends in `ROLLBACK` (a dry run) unless you change it to `COMMIT`. Idempotent. Aborts if any account, membership or invitation changes. |
| 4. Validate | `supabase/tests/team_staging.sql` | Rolls everything back and prints `RESULT pass=… fail=…`. |

## Model

- **`staged_contacts`**
  - Holds name, email, phone and title for one organization (`org_id` is required, and the roster names the org explicitly).
  - Also holds a provisional organization role (never owner), a provisional work role, a planned reporting line and an `affiliation_confirmed` flag.
  - Reporting lines use composite keys, so they can only point to a staged person or an active member of the **same** organization.
- **`staged_assignments`**
  - Planned work for a staged person.
  - The task engine accepts only real members as task owners, so planned work stays here until the person is active. An owner then creates the real task.
- **No status column.**
  - "Not invited / Invited / Invitation expired / Active" is derived by email from the real `invitations` and `memberships` tables in `org_staging_overview`.
  - There are no triggers, and only one source of truth.
- **Access**
  - Tables: no grants to `anon`, `authenticated` or `service_role`, so the dispatch function can't read them either.
  - Functions: they check `private.is_org_admin(org)`. That excludes members, other organizations, platform admins without a membership, and support-access grants. Contact details are personal data.
  - RLS is enabled with owner/admin read policies as a second layer.
- **Abraham**: a roster row with an active member's email is skipped ("already an active member"). The owner's membership is checked unchanged by the seed's invariant, and by the test.

## Where staged people appear

People & Roles → Directory, for owners and admins only. Each staged person is a striped row with:
- the status (**Not invited**, Invited or Invitation expired);
- provisional roles marked "· planned";
- "Reports to: … (planned)";
- "affiliation unconfirmed" until confirmed;
- "Not assignable until active";
- a planned-work count.

The rows do not appear in task owner pickers, Company Work, notifications or anywhere else. They aren't members.

## Activation path (later, one person at a time)

1. An owner or admin confirms the person belongs to this organization: **Confirm affiliation** (`confirm_staged_affiliation`, audited).
2. **Prepare invitation** (`invite_staged_contact`).
   - It requires confirmed affiliation and an email, and the person must not already be a member.
   - It calls the existing `create_invitation`, so every owner/admin rule applies, and pre-fills the provisional roles.
   - It records the invitation, **sends nothing**, and shows a message for you to send yourself.
3. The person creates an account or signs in with that email, confirms it (Supabase sends that confirmation email at *their* sign-up), and accepts. Only then does a membership exist. The row then shows as an active member, and planned work can become real tasks.

## Notification guarantee

Running the preview, migration, seed or test, confirming affiliation, or preparing an invitation sends **no** email, notification, webhook or invitation:
- nothing in these files calls Supabase Auth, the network or a scheduler;
- the database has no outbound paths, and staging never touches `auth.users`, the only table with triggers.

The single email in the entire path is Supabase's own sign-up confirmation, triggered when a person creates their own account in step 3.

## Verification performed

Run in PGlite (in-memory Postgres 17) with a **stubbed** Supabase layer: roles, `auth.users`, `auth.uid()`, and broad default privileges as a worst case. This is not a Supabase run.

- The 4 migrations production has, plus this one, apply cleanly.
- The existing `rls_isolation.sql`: 31 passed, 0 failed.
- `team_staging.sql`: **29 passed, 0 failed**. It covers:
  - no identity, membership or invitation is created;
  - idempotent upsert and duplicate-email refusal;
  - owners are never staged;
  - cross-tenant reporting lines and assignments are refused;
  - owner-only reads;
  - member, other-org owner, platform admin, anon and `service_role` are all denied;
  - invite before confirmation and invite without email are refused;
  - confirm → invite → accept → active, with the provisional roles carried over;
  - re-inviting an active member is refused;
  - the owner's membership is unchanged.
- **Synthetic roster through preview and seed:**
  - the owner's email (in different case) was skipped;
  - the Construction row was skipped because the org is missing;
  - the duplicate email was flagged FIX;
  - two committed runs left the same 2 rows;
  - accounts, memberships and invitations were unchanged;
  - the default dry run left nothing.
- **UI**: rendered with a stubbed client. Staged rows show as above; without the migration, the section stays hidden and no error appears.
