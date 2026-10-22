# Employee activation (isolated module)

> **Identity v1 (2026-10-20, local, not deployed):** links last 7 days; the employee proves their email with a six-digit Supabase code and the endpoint's `activate` action redeems the link for that account (`employee_activation_redeem`). The account-creating `redeem` action below is retired (410), and `?admin=1` points to People & access → Invite. See `docs/identity-v1-release.md`. The sections below describe the v1 flow as deployed on 2026-10-19.

This module adds no shared routing, navigation, auth-screen, dispatch or core edits.

## Entry points

- Employee: `/activate/index.html`
- Administrator: `/activate/index.html?admin=1` (reuse the existing Task HQ signed-in session)
- Source during Vite development: `/src/activation/index.html`
- `node src/activation/build.mjs` rebuilds only `public/activate/`. These static files are copied by the existing production Vite build, without editing its configuration. Rebuild after source changes. Browser configuration uses existing publishable Supabase settings only.

Admin: use People & Access → Invite or the existing employee row, and confirm affiliation before issuing access. The server sends the employee-bound setup link through Resend and records `pending`, `sent`, or `failed` delivery state. A retry in the same browser session reuses the current code; when its plaintext is no longer available, the administrator must explicitly replace the active link. Replacement revokes the previous code. Revocation is immediate. Owners alone may issue admin access; owner access cannot be issued by this flow. Only code hashes are stored in the database.

Email delivery uses the Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; neither is available to the browser. Apply `20261022010000_activation_delivery.sql` and deploy the updated `employee-activation` function before deploying the frontend delivery controls.

Employee: code → employee/company confirmation → email and password (12–128 characters) → confirmed account → password sign-in → normal Task HQ. Authentication never starts a shift. The isolated ShiftBridge still requires Claude's coordinated application integration; this module does not mount it or deploy its separate schema.

## Backend

`supabase/migrations/20261019115203_employee_activation_v1.sql` extends the existing `team_activation_codes` table. Original `employee_name`, `employee_ref`, `redeemed_at`, `redeemed_by` fields remain. New codes bind to `staged_contacts.id` UUID plus organization, issuer and exact role/work-role/version. The dedicated `employee_auth_links` relationship records the employee UUID and Auth UUID; no name matching grants access.

Unbound legacy code rows remain unchanged and cannot be redeemed through this endpoint. Do not attach them to employees by guessed name. Confirm affiliation and issue fresh, ID-bound codes. No production codes were issued by the acceptance check.

`employee-activation` Edge Function deliberately has gateway `verify_jwt=false` so employees without accounts can redeem. Admin actions independently validate JWT with Supabase Auth and call the existing-user RPC; all permission checks run again in SQL. The service key stays in Edge environment variables. Never put it in Vite or browser configuration.

Raw codes contain 192 random bits, formatted as eight hex groups. Only normalized SHA-256 hashes persist. Public preview/redemption uses persistent global (120/minute) and per-code (20/15 minutes) budgets, including invalid attempts. These do not trust forwarded IP headers. A traffic flood can temporarily exhaust the global budget; this bounded v1 has no per-device bypass. No passwords/codes/IPs are logged by this implementation.

Claiming binds the code to one email. Supabase Auth admin creates the confirmed account; an Auth transaction trigger consumes the code and adds the exact approved membership/link. GoTrue writes app metadata then confirmation inside the account-creation transaction; failure rolls everything back. Concurrent requests serialize on employee/code row locks. Same-email retry after a lost success returns completion, never a session; the browser must prove the chosen password to sign in. Different-email replay fails. Existing accounts are never automatically adopted, overwritten or relinked. If an email was mistyped or creation fails, retry the same email or have the administrator regenerate the code.

The trigger ignores unrelated Auth users and subsequent updates of an already linked user. It checks affiliation, archive state, employee version, expiry, revocation, issuer's current permissions, confirmation and exact email again. Changes to staged employee data invalidate an outstanding code instead of changing its grant.

## Validation

```
node --test src/activation/*.test.ts
npx tsc -b
npx tsc -p src/activation/tsconfig.server.json
node src/activation/build.mjs
npm run build
```

SQL tests use real PostgreSQL in PGlite with stubbed Supabase Auth. Endpoint tests mock transport. They are not hosted Auth/concurrency evidence.

The separately authorized live check is `ACTIVATION_TEST_EMAIL=qa.prototype.33@gmail.com node src/activation/live-check.mjs`. It deliberately refuses to overwrite an existing account. **It has already run successfully; do not rerun against this account.** It provisions only a clearly labeled test employee, invokes admin issuance in a database-authenticated owner context (not an owner browser login), then uses actual public Edge requests and GoTrue sign-in. Its random password was kept only in memory; use normal password recovery for future access to the test account. No message or recovery email was sent by the check.

Live result on 2026-10-19, project `xthyyxnfjaxmtrqrhyxc`:
- Employee `5a751698-b7c3-4d07-82c8-4663b1a58d78`, name `TEST — Activation QA`.
- Auth `cb2bd744-a94a-4076-8bb7-35853026f84f`, controlled email `qa.prototype.33@gmail.com`, confirmed.
- Quest Roofing member/field membership; actual workspace read and password sign-in passed.
- Two concurrent redemptions returned completion with exactly one Auth user/link/membership; consumed code cannot preview or redeem to another email.
- Anonymous admin issuance and test member administration denied.
- Existing employee and membership snapshots matched before/after.
- Four real staged employees retained their data, affiliation state and permissions. Two independently added legacy code rows were preserved.

The migration was applied alone, transactionally, and recorded in migration history. Only the new Edge Function was deployed. Other candidate migrations, including the Shift module, were not applied.

## Coordinated handoff

The administrator signs in through the normal app, then opens `/activate/index.html?admin=1` on the same origin. A separate preview origin does not share the original app session; its admin entry reuses the existing Task HQ AuthScreen for explicit sign-in. Do not issue employee codes until an owner has tested the admin controls on the intended production origin. Production publication remains a coordinated release of the existing app; do not deploy the dirty shared tree as part of this module. The existing server endpoint is `https://xthyyxnfjaxmtrqrhyxc.supabase.co/functions/v1/employee-activation` (POST API, not the employee HTML page).

Isolated HTTPS preview: https://task-ox50kthsu-novum-systems.vercel.app/activate/index.html (no production alias changed).

The isolated preview signs in on its own origin. Continuing to the existing production application requires sign-in there again. The normal same-origin `/activate/index.html` release shares the existing Auth session automatically. Do not transfer sessions through URL parameters.
