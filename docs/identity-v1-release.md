# Identity v1 — release plan (prepared 2026-10-20, nothing deployed)

Approved direction: one mobile-first Invite path; setup links and QR codes on `task.questroofing.com`; seven-day, single-use, revocable links; six-digit email verification; badges never act as sign-in credentials; all existing accounts, memberships, invitations and history preserved.

Production target: Supabase `xthyyxnfjaxmtrqrhyxc` (task-hq), Vercel `task-hq` (team `team_RC3voGc5EEH8n534NIo285UK`) serving `task.questroofing.com` from `95043cb`.

## What changed locally

| Area | Change |
|---|---|
| `supabase/functions/badge-check-in` | A scan records a check-in/check-out only. No sign-in link, token or account email is ever returned (`generateLink` removed). |
| `src/auth/BadgeCheckIn.tsx`, `src/app/Badges.tsx` | Scan screen never signs in. Issuing badges is paused in the UI (`BADGE_ISSUANCE_OPEN = false`) until the function fix is verified; revoke and confirm stay available. |
| `supabase/migrations/20261020120000_identity_v1.sql` | `employee_activation_admin`: links last 7 days (only change; body otherwise identical to production). New service-only `employee_activation_redeem(hash, user)`: requires a confirmed email; the email on file must match; refuses existing members; re-checks issuer authority and the role snapshot; single use; idempotent for the same person. |
| `supabase/functions/employee-activation` | `activate` requires the caller's session to come from an email code (`amr` `otp`) within 15 minutes. The old `redeem` (create a confirmed account for any typed email) returns 410. `preview` returns only name and company. |
| `src/activation/entry.tsx` → `public/activate/` (rebuilt) | Link → "This is me" → email → six-digit code → (new accounts) password → Task HQ. Signs out any existing local session first. `?admin=1` now points to People & access. |
| People & access | One **+ Invite** button. Every person gets a setup link (existing accounts included — they prove their email, nothing is duplicated). Result shows QR code, Share (device share sheet), Copy message, Copy link. Old "invite an existing account" form removed; older open invitations stay listed with Revoke. |
| Sign-in / no workspace | "Sign up" and "Request access" replaced by one "Getting set up" screen. The waiting room screen becomes "Ask your manager for a setup link". Server records for requests and the waiting room are untouched; pending ones (none today) still appear in People. |
| `src/core/people-access.ts` | `PRODUCTION_ORIGIN = https://task.questroofing.com`; messages mention the six-digit code, never a password. |

Verification (local): `npm test` 251 passed; `node --test src/activation/*.test.ts` 14 passed (4 new SQL tests on PGlite + stubbed Auth); `npm run test:db` 16 passed; server and activation typechecks passed; `build:app` and activation build passed. The full employee flow was walked in Chrome against a local dev server with every Supabase call stubbed in the page (preview → email code → verify → activate with the user's own session → password → done), at a 744 px viewport — phone width was not reached, and the People result panel (QR + message) was not rendered. Not verified: real email delivery, hosted RLS, phone-width layout.

`amr` check, verified against the Supabase Auth source (`internal/api/verify.go`, `internal/models/factor.go`): `POST /verify` with an email code issues the session with `models.OTP` (`"otp"`) for both new (signup token) and existing (recovery token) users. Tapping the email's link instead goes through `GET /verify` and records `magiclink` / `email/signup`; `activate` then refuses with "Enter a fresh six-digit code", safely, but the person lands outside the setup page. Hence the template prerequisite below and the "tap the link" acceptance case.

## Production facts used (read-only, 2026-10-20)

- Badges: 0 active (all revoked), 3 historical check-ins. Deployed `badge-check-in` v1 returns a magic-link `token_hash` on every valid scan.
- Activation: 0 open bound codes, 1 redeemed, 7 legacy unbound rows (untouched). 10 invitations (3 open), 6 memberships, 8 staged contacts, 0 pending access requests.
- `/activate/index.html` is already served on `task.questroofing.com`.

## Migration history reconciliation

Function bodies in production were compared with the repo by MD5 of `prosrc` (latest definition per migration, in order).

| Repo file | Production | Notes |
|---|---|---|
| 20261017180000_tenancy_core | applied, recorded as `20261017172927` | |
| 20261017193403_website_intake | **not applied** | `receive_intake` absent |
| 20261017200000_org_admin_overview | applied, recorded as `20261017174029` | later replaced by waiting_room |
| 20261017201000_harden_rls_auto_enable | applied, recorded as `20261017174039` | |
| 20261017203000_grant_dispatch_service_role | applied, recorded as `20261017183116` | |
| 20261017230608_operational_attention | **not applied** | dispatch v4/v5 do not need it |
| 20261018020000_harden_platform_owner_invite | **not applied** | production `platform_invite_owner` is the original (no single-owner/first-invite guard). Separate decision. |
| 20261018030000_team_staging | applied, **not recorded** | 12 functions differ only by the `require_section('people')` line the restricted-navigation migration injects at apply time (expected) |
| 20261019113920_shift_activity_v1 | **not applied** | |
| 20261019115203_employee_activation_v1 | applied, recorded (same version) | all 4 functions identical |
| 20261019140000_temporary_restricted_navigation | applied, **not recorded** | |
| 20261019160000_owner_people_access | applied, recorded as `20261019140242` | |
| 20261019180000_people_access_status | applied, recorded as `20261019150409` | |
| 20261019200000_observer_navigation | applied, recorded as `20261019151854` | |
| 20261019210000_people_access_accounts | applied, recorded as `20261019171240` | |
| 20261019230000_waiting_room | applied, **not recorded** | |
| 20261020010000_badge_check_in | applied, **not recorded** | |
| 20261020120000_identity_v1 | new | apply alone |

Repair touches only `supabase_migrations.schema_migrations` (no schema). It renames the recorded versions to the repo's filenames rather than renaming files (tests reference them). `migration repair` works on the linked project (it has no `--project-ref` flag):

```sh
supabase link --project-ref xthyyxnfjaxmtrqrhyxc
supabase migration list        # confirm the starting state matches the table above
supabase migration repair --status reverted \
  20261017172927 20261017174029 20261017174039 20261017183116 20261019140242 20261019150409 20261019151854 20261019171240
supabase migration repair --status applied \
  20261017180000 20261017200000 20261017201000 20261017203000 20261018030000 20261019140000 \
  20261019160000 20261019180000 20261019200000 20261019210000 20261019230000 20261020010000
supabase migration list        # expect only the four "not applied" files plus identity_v1 pending
```

Equivalent without the CLI (MCP `execute_sql`, same effect): delete those eight `version` rows from `supabase_migrations.schema_migrations` and insert the twelve repo versions with their names.

Never run `supabase db push`: it would also apply website_intake, operational_attention, harden_platform_owner_invite and shift_activity.

## Release units (each needs explicit authorization)

1. **Badge fix (independent, first).** Deploy `supabase/functions/badge-check-in/{index.ts,handler.ts}` as `badge-check-in` v2, `verify_jwt=false`. Verify: read back the deployed source and confirm no `generateLink`/`auth.admin`; POST an invalid code and confirm a 400 with no token. Rollback: not recommended (v1 is the vulnerable version). **Until this is deployed, do not issue badges:** the production client (95043cb) still shows a working Issue badge button to the owner and both admins, and any badge issued now is a reusable sign-in. After the fix, that old client treats a token-less success as an error, so a rescan would record a check-out; this matters only if badges are issued before release 6.
2. **Auth prerequisites (dashboard, read and confirm before 4–6).** Custom SMTP configured (the built-in mailer only reaches the project team and is heavily rate limited); "Confirm signup" template shows `{{ .Token }}` (code only is best: open sign-up is gone, so only activation uses it); "Magic Link" template shows `{{ .Token }}` as well as the link (the sign-in screen's magic-link option still needs the link; existing accounts activating receive this template); email OTP length 6; new sign-ups allowed (the email code creates the account); Site URL / redirect allow-list include `https://task.questroofing.com`. These could not be read with the available tools.
3. **Migration history repair** (commands above).
4. **Apply `20261020120000_identity_v1.sql` alone** (MCP `apply_migration`, name `identity_v1`). `apply_migration` records its own timestamp, which is how the earlier mismatches arose, so immediately repair: `supabase migration repair --status reverted <generated version>` then `--status applied 20261020120000`, and check `supabase migration list`. Rollback: re-run the `employee_activation_admin` body from `20261019115203_employee_activation_v1.sql` and `drop function public.employee_activation_redeem(text, uuid)`.
5. **Deploy `employee-activation` v3** (`index.ts`, `handler.ts`, `verify_jwt=false`) right after 4. Rollback: redeploy v2 from git `95043cb`.
6. **Client release** (Vercel `task-hq` → `task.questroofing.com`): People/Invite, activation page (`public/activate/` rebuilt), sign-in and no-workspace screens, badge screen, plus the pending dispatch v5 client gating. Ship 5 and 6 together: the old page's `redeem` gets a clear 410 message, the new page needs `activate`. No open setup codes exist, so nobody is mid-flow.
7. **After 1 is verified:** set `BADGE_ISSUANCE_OPEN = true` in `src/app/Badges.tsx` and release.

Known limits (not changed by this release): open sign-up, `request_access` and `join_waiting_room` are removed from the UI only; they remain callable with the publishable key, and sign-ups must stay enabled because the email code creates new accounts. Such accounts get no workspace (they see "Ask your manager for a setup link"); any requests still appear in People for a decision. Closing them server-side needs a migration and an owner decision.

Acceptance after release: an owner invites a test person (dedicated test mailbox), opens the link on a phone from the QR, receives and enters the code, lands in Quest Roofing with the chosen role; a second redemption of the same link fails; revoking a fresh link makes it unusable; a member account still sees no Invite controls; tapping the email's link instead of typing the code leaves the link unredeemed and shows a clear next step; repeat the walk at phone width (375–430 px).
