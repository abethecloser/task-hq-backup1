# Activation production handoff — 2026-10-19

Priority: release the existing activation page, then activate the first real employee. No new features are required. This handoff did not change shared files, deploy anything, confirm employee affiliation, or issue employee codes.

## Verified targets and state

- Supabase: **task-hq**, `xthyyxnfjaxmtrqrhyxc`, `https://xthyyxnfjaxmtrqrhyxc.supabase.co`.
- Quest Roofing organization: `492f0048-85ad-4f38-aef7-9b8e7f823cff`.
- Vercel: **novum-systems/task-hq**, project `prj_NE7Eb9HUGVfuv8syT7QigR0uPtby`, team `team_RC3voGc5EEH8n534NIo285UK`.
- Current Ready production deployment: `dpl_DhZENQLqWsG1arQNDZJafv5x6QHV`, `https://task-5oelsg9n9-novum-systems.vercel.app`.
- Current production aliases: `https://task-hq-three.vercel.app` and `https://task-hq-novum-systems.vercel.app`.
- Use **https://task-hq-three.vercel.app** for both activation and normal app sign-in. Choose this one origin consistently when distributing links.
- Activation-only review preview: `https://task-ox50kthsu-novum-systems.vercel.app/activate/index.html`. **Do not promote this deployment**: it contains only the isolated activation site, not the full application.
- Edge Function **employee-activation v2**, ACTIVE, gateway `verify_jwt=false`; admin operations validate the JWT inside the handler and enforce org permissions in SQL.
- Migration **20261019115203_employee_activation_v1** is already applied and recorded. It extends the existing `team_activation_codes`; do not reapply it, create a duplicate table, or run `supabase db push` across unrelated candidates.
- Controlled QA account `qa.prototype.33@gmail.com` already passed live Auth confirmation, password sign-in, employee linking, member/field membership, workspace reads and concurrent redemption. Do not rerun the provisioning script against it. Its generated password was not saved; normal password recovery is available.

## Fast path if the shared release is delayed today

The existing HTTPS activation preview already uses the verified live Quest backend. After an authorized owner confirms the employee identity, role and affiliation through the existing People & Roles interface, that owner can sign into the preview's `?admin=1` page and issue an ID-bound code. The employee can redeem on that preview immediately, then sign into `https://task-hq-three.vercel.app` separately with their new email/password. This creates no new deployment and does not touch Claude's files. It does **not** provide same-origin session continuity; use the production release below to remove that extra sign-in. Do not assume a platform administrator is a workspace owner. If the existing production UI lacks the affiliation control, use the reviewed release rather than bypassing permissions or editing tables directly.

## Environment

Edge runtime requires these existing Supabase-provided variables:

| Variable | Value/source |
|---|---|
| `SUPABASE_URL` | Specified Quest project URL |
| `SUPABASE_ANON_KEY` | Built-in project anon key, used for JWT-validated admin calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Built-in server-only key for Auth admin and protected RPCs |

No additional custom Edge secrets are required. Do not put the service key in Vercel/Vite/browser variables or paste it into commands.

Vercel Production already has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (names verified; encrypted values were not retrieved). They must point to the Quest project above and use its publishable/anon key. Existing `.env.local` and `.env.production.local` URLs point to that project. Vite embeds these at build time, so runtime-only environment changes do not repair an already built page.

For the production activation build, leave `ACTIVATION_PREVIEW_HOME` and `ACTIVATION_BUILD_DIR` unset. The default home link is `/`, not a separate preview/deployment origin.

## Release sequence for Claude

The current checkout is dirty on `main` (`b3b66de`) with active shared App, main, core, dispatch and UI changes. **Stop before deployment until Claude checkpoints/reconciles the intended release.** Do not stage everything, stash/reset others' work, or deploy this active tree blindly. Use a reviewed release checkout that includes the intended full application plus the isolated activation files. The clean-tree guard below intentionally fails in the current checkout.

Activation payload: `src/activation/`, `public/activate/`, `supabase/functions/employee-activation/`, `supabase/migrations/20261019115203_employee_activation_v1.sql`. Existing auth components are reused, without modification. No navigation or routing rewrite is required: the static page is copied from `public/activate/` to `dist/activate/` by the existing Vite build. Preserve the full app's `vercel.json` and verify its catch-all does not return the app shell for activation HTML/assets.

Run from the reviewed, coordinated Task HQ release checkout:

```sh
# 1. Conflict/release boundary. If this fails, reconcile with Claude first.
git status --short
test -z "$(git status --porcelain)" || exit 1
cat .vercel/project.json
# If using a fresh isolated release checkout, link ONLY that checkout to task-hq:
# vercel link --project task-hq --scope novum-systems

# 2. Validate and rebuild the isolated static page for the same origin.
unset ACTIVATION_PREVIEW_HOME ACTIVATION_BUILD_DIR
# Pull only into a private temporary file; do not print or commit its contents.
umask 077
vercel env pull /private/tmp/quest-activation-production.env \
  --environment=production --scope novum-systems
node --env-file=/private/tmp/quest-activation-production.env --input-type=module -e '
if (process.env.VITE_SUPABASE_URL !== "https://xthyyxnfjaxmtrqrhyxc.supabase.co" || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error("Wrong activation backend configuration");'
node --test src/activation/*.test.ts
npx tsc -p src/activation/tsconfig.server.json
node --env-file=/private/tmp/quest-activation-production.env src/activation/build.mjs
npm run build
test -f dist/activate/index.html

# 3. Backend is already deployed. Redeploy ONLY if its reviewed source changed.
# Do not deploy dispatch or apply other migrations as part of activation.
supabase functions deploy employee-activation \
  --project-ref xthyyxnfjaxmtrqrhyxc --no-verify-jwt --use-api

# 4. Build a FULL-APPLICATION production candidate without moving live aliases.
vercel deploy --prod --skip-domain \
  --project prj_NE7Eb9HUGVfuv8syT7QigR0uPtby --scope novum-systems
```

Set `RELEASE_URL` to the new **full-application** Ready candidate URL printed by step 4. On that candidate, verify `/activate/index.html` renders activation (not the normal SPA shell), its assets load, `?admin=1` opens existing sign-in/admin UI, and `/` still opens Task HQ. Sign in as the authorized owner; confirm employee IDs/status and normal workspace access. Authentication must not start a shift. Do not create another QA account just to repeat completed validation.

Only after that review:

```sh
# Use the reviewed candidate URL, NOT either activation-only preview URL.
vercel inspect "$RELEASE_URL" --scope novum-systems
vercel promote "$RELEASE_URL" --scope novum-systems
```

After promotion, verify both `/` and `/activate/index.html` at `https://task-hq-three.vercel.app`, and that activation's Continue link stays on that origin and retains the Auth session. Then distribute this stable production activation URL:

**https://task-hq-three.vercel.app/activate/index.html**

If the release fails, restore the previous full-app production deployment, preserving backend audit/link data:

```sh
vercel promote https://task-5oelsg9n9-novum-systems.vercel.app --scope novum-systems
```

Do not roll back the database or delete activated employee/Auth records to undo a UI release.

## Activate Kristin and the first field employees

The user called the first employee “Kristen”; the database spells the existing record **Kristin Montes**. Verify that is the intended person; do not create a duplicate or rename automatically.

| Existing employee | Actual database UUID | Current planned access |
|---|---|---|
| Kristin Montes | `b02727eb-1121-4d7c-8fcf-e7fb4952efac` | admin / coordinator |
| Alkeith Cabezzas | `b346568c-518a-4f97-b9bb-2ad4145e27c0` | member / field |
| Ralph Palad | `ed4672d2-c973-477e-9a9e-c6f9be5ed276` | member / field |

All three remain **affiliation unconfirmed** and have no activation link. Their existing roles were not changed. An owner must approve Kristin's planned admin access; an admin alone cannot issue her admin activation. Confirm intended roles before generating codes, since editing an employee afterward invalidates the outstanding code.

1. Owner signs into the production Task HQ origin. In People & Roles, select the existing Quest Roofing employee, verify identity and planned role, and click **Confirm** affiliation. This existing control invokes `confirm_staged_affiliation`; it does not send an invitation. Do not also create a legacy invitation for this activation flow.
2. Open **https://task-hq-three.vercel.app/activate/index.html?admin=1**. Select Quest Roofing, then the existing employee. Match the displayed UUID to the table above. Click **Generate one-time code**. Copy it privately to that employee with the production activation URL. Codes expire after 24 hours; raw codes are shown once and not stored.
3. Employee opens the production activation URL, enters the code, confirms their displayed identity/company, and supplies their own email/password. They submit their password themselves. The server creates a confirmed Auth account and the exact authorized membership, consumes the code, and the page signs them in. **Continue to Task HQ** must stay on the same origin. Starting a shift remains a separate explicit action; the new Shift module integration is not a prerequisite for this sign-in release.
4. Refresh admin status: it must read **active**. Have the employee refresh Task HQ and verify their workspace is available. For a field employee, verify member/field access and absence of admin controls. Do not ask employees to share passwords.

If an email already has an Auth account, this flow does not overwrite/adopt it. Use existing sign-in/access management rather than relinking it with a code.

## Verify redemption / revoke / regenerate

Read-only verification in the specified project's SQL Editor (example is Kristin; replace UUID for a field employee):

```sql
select c.id as employee_id, c.full_name,
       l.user_id, u.email_confirmed_at,
       m.role, m.work_role,
       a.redeemed_at, a.redeemed_by
from public.staged_contacts c
left join public.employee_auth_links l on l.employee_id = c.id
left join auth.users u on u.id = l.user_id
left join public.memberships m on m.org_id = c.org_id and m.user_id = l.user_id
left join public.team_activation_codes a on a.id = l.activation_id
where c.id = 'b02727eb-1121-4d7c-8fcf-e7fb4952efac'
  and c.org_id = '492f0048-85ad-4f38-aef7-9b8e7f823cff';
```

Success: non-null linked user, confirmation timestamp and redemption timestamp; `redeemed_by = user_id`; membership exactly matches the approved role/work-role. Combine this with actual employee sign-in and workspace access, rather than treating the SQL row alone as a complete UX check.

- Before redemption: select the employee in the admin activation page and click **Revoke code**; refresh status to **revoked**. The code stops working immediately.
- **Regenerate code** revokes the prior open code and displays a fresh 24-hour code. Share only the new code. Use Generate again for expired/revoked codes.
- After redemption, the code is already consumed. Code revocation does **not** remove an active account/membership; use the established owner-managed access controls if access must change.
- Two legacy code rows without employee IDs were preserved. They cannot activate these employees through this flow. Generate new ID-bound codes; do not repair them by matching names or hand-writing raw codes into SQL.
