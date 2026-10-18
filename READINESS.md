# Readiness — Task-HQ (2026-10-17)

**Unified experience candidate (2026-10-17, local):** [All Tasks, three-zone shell, Executive Desk, People & Roles, platform-admin access path](docs/unified-experience-candidate.md). 109 tests and builds pass; live sign-in steps await real sessions. One security candidate migration (platform owner invites) awaits staging. Nothing deployed.

**Latest backend candidate (2026-10-17):** [implemented functionality, verification and release gates](docs/quest-os-sprint-results.md). 101 tests, 5 runner guards, 4 rendering groups, web/extension builds and server TypeScript pass. SQL/RLS/concurrency execution awaits an authorized staging database. No production deployment; Construction intake stays disabled.

## Resume verification update

Follow-up: [staging candidate](docs/intake-staging-candidate.md). 40 unit tests, 5 database-target guard tests, 3 offline UI scenarios and the build pass. SQL/concurrency execution remains pending an authorized database; no local Docker/Podman runtime is available. No production changes were made.


Authenticated owner task create → save → refresh → reopen **passed on the live application** on 2026-10-17. Construction intake is implemented locally but **disabled, not deployed, and awaiting database execution/security verification**. No Construction organization/mapping is configured; never route it to Roofing, and never default its follow-up owner to Abraham. No production changes without approval.

See [current verification evidence and blockers](docs/intake-verification-2026-10-17.md) and [intake contract / Copilot handoff](docs/intake-contract.md). The historical readiness details below predate this successful owner task test; their pending two-user and database verification limits still apply.


**Production URL:** https://task-hq-three.vercel.app (Vercel team `novum-systems`, project `task-hq`)
**Backend:** Supabase project `task-hq` (`xthyyxnfjaxmtrqrhyxc`). It is separate from Novum Bridge and from every Quest production system.

## Operational release — status

| # | Requirement | Status |
|---|---|---|
| 1 | Working auth for both accounts | Built and deployed: password, magic link, sign-up, reset. **Not yet exercised by either real account.** Reset and magic links also need the Auth URL setting below. |
| 2 | Platform Super Admin and Quest Roofing Owner | `team@enternovum.com` is in `private.platform_admins`, which no client can read or write; it is not a Quest Roofing member. `admin@questroofing.com` has an open **owner invitation** (expires 2026-10-31). Ownership becomes real only when that confirmed account signs in and accepts it. |
| 3 | Tenant-scoped persistence | `workspace_state` holds one row per organization, with RLS on every table and writes revoked from clients. Isolation test: **36/36 pass** (`supabase/tests/rls_isolation.sql`, rolled back). |
| 4 | Real create, assign, status and complete | All writes go through the `dispatch` Edge Function. It verifies the JWT, takes the actor from the token, rebuilds people from real memberships and runs the same engine as the app. It refuses demo-only actions and uses optimistic revision checks, and every write is audited. Covered by server-logic tests; also clicked through in the live UI against a simulated server. |
| 5 | Stable HTTPS URL | **Done.** HSTS, `X-Frame-Options: DENY`, nosniff. No secret keys in the bundle (checked). |
| 6 | Both users see the same live changes | Supabase Realtime on `workspace_state` (RLS applies). **Pending the real two-user test below.** |
| 7 | Recovery, errors, backups | Conflicts reload and retry once. Network and permission errors show without changing anything. Owners and managers can **download a full workspace backup (.json)** in Policy & data. Supabase shows **no platform backups yet** (new project, point-in-time recovery off); see the decisions section. Rollback: `vercel rollback` to the previous deployment. |

**This release is not yet "operational".** It becomes operational after the two-user test passes with the real accounts. Until then, don't invite the wider team.

### Two-user test (about 5 minutes)

By design, the Platform Super Admin is **not** a Quest Roofing member and sees no task data. So for both accounts to see the same live changes, the second user must be a member. **Your decision:** (a) the owner explicitly invites `team@enternovum.com` as a Member for the test (an owner action, not an auto-grant; this touches the Novum-membership question you deferred, and the owner can remove it afterwards), or (b) use a second address you personally control. No other people should be invited before this passes.

1. **Owner:** at the URL, sign in as `admin@questroofing.com` → “You’ve been invited” → **Join Quest Roofing**. You land in an empty Quest Roofing workspace.
2. **Platform admin:** in a second browser or private window, sign in as `team@enternovum.com` → the Platform console lists Quest Roofing with one owner, and no task data.
3. **Second member (per your decision):** owner → Policy & data → Members & access → invite the chosen address as Member. That account signs in (a new address must first create its account and confirm the email) and accepts. A platform admin who is also a member sees “Your own workspaces → Open” in the console.
4. Owner creates a task assigned to the member. The member sees it appear without reloading, then starts and completes it. The owner sees each change live.
5. Check that the Activity view shows who did what, and that the member can't change roles.

The owner's first sign-in is the **first end-to-end run** of the deployed server function with a real session. Its code has been boot-checked (an anonymous token gets the function's own 401), but no signed-in request has run yet.

## Incident 2026-10-17 18:26 UTC — owner saw "You are not a member of this workspace"

- **Cause:** the `dispatch` function runs as `service_role`, which had no table privileges in this project (Supabase didn't grant them by default here). Its membership lookup failed with `permission denied`, and the code treated that error as "not a member". The invitation and membership were correct throughout.
- **Fix:** migration `20261017203000_grant_dispatch_service_role.sql` grants `service_role` only what dispatch uses. Client roles and RLS are unchanged. Dispatch now returns a 500 server error on database errors instead of a false 403. The load-error screen now offers Try again, Switch workspace (when there is another) and Sign out.
- **Verified on the real records (read-only):** the function's lookup finds the Owner, `my_context` returns the single Quest Roofing membership, and the platform admin sees the console but no tenant rows.

## Built for the live workspace

- **Signed-in routing:** pending invitations are offered first; then a workspace (or a chooser); platform admins get the Platform console; anyone else can request access.
- **Members & access (owners and admins):** approve or deny requests, invite (recorded only; **Task-HQ sends no email**), change roles and work roles, remove members, revoke invitations. The server re-checks every rule: only owners touch owners and admins, and the last owner can't be removed.
- **Platform console:** list and create organizations, invite a first owner. It has no tenant data unless an owner grants time-limited, audited support access.
- **Live mode hides demo controls:** Working-as, simulate lead, reset demo, invitation drafts and the demo workspace editor. Copy that described "this device / demo" now describes the shared workspace.
- **Only Priority** in a live workspace runs in the server engine, so locked actions are refused on every device. Temporary access expires on the server (`tick`).
- **Task-HQ Demo** is unchanged and separate (local data, synthetic people), reachable from the sign-in page. The **extension stays demo-only** for now.

## Known limits (live)

- People appear by **email** until they set a name (profiles have no edit screen yet).
- Feedback **screenshots and recordings stay on the device** that captured them; written feedback is shared.
- **Speed to Lead receives no leads:** no lead source is connected, and simulated leads are refused in live workspaces.
- All of an organization's work is one JSON document with revision checks. That suits a small team; at scale it should be split into per-task rows.
- Membership changes reach other open sessions on their next load or next change.

## Decisions / access needed from you

1. **Supabase Auth URL configuration (needed for password reset, magic link and email-confirmation links).** In Dashboard → Authentication → URL Configuration, set **Site URL** to `https://task-hq-three.vercel.app` and add the redirect URL `https://task-hq-three.vercel.app/**`. I didn't push it from the CLI, because that would overwrite every auth setting with local defaults.
2. **Email delivery.** Password reset, magic links, sign-up confirmation and new members all depend on email. If the project still uses Supabase's built-in sender, check whether it only delivers to your Supabase team's addresses at a few emails per hour. If so, configure custom SMTP (Auth → SMTP), which is a provider and cost decision. Password sign-in needs no email: does each of the two accounts already know its password?
3. **Backups:** the project shows no platform backups. Daily backups and point-in-time recovery depend on the Supabase plan, which is a cost decision. Until then, use the owner's JSON export.
4. Optional hardening: enable **leaked-password protection** (Auth → Passwords).
5. Still open from before: Only Priority governance (Abraham), a lead source, extension distribution, and whether Novum team members belong in Quest Roofing (deferred by you).

## Verification limits

- I couldn't sign in as either real account (I don't have their passwords and must not use them), so steps 1–4 above are untested with real sessions.
- The Chrome extension's site permissions block vercel.app for me. I checked the production bundle and headers over HTTPS and exercised the same build on localhost.
- Earlier limits still apply to the demo: the unpacked extension hasn't been loaded by me, and screen capture hasn't been clicked through.
