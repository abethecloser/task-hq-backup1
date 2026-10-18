# Construction intake staging candidate — 2026-10-17

**Status: prepared for staging, not verified on a database and not approved for production.** No project is currently authorized for staging. No production, website, phone, account, or infrastructure changes were made.

The verified production task persistence baseline and its checkpoint remain intact. SHA-256 of `checkpoints/task-hq-before-intake-2026-10-17.tar.gz` remains `32cb66125c6e005dc5e25e0863942547ce0e4a9999fc766a95ba1aeb6bbc0c33`. A second checkpoint, `task-hq-intake-before-db-verification-2026-10-17.tar.gz`, preserves the source as this follow-up began, including the existing UI changes.

## Exact local results

| Check | Result |
|---|---|
| Existing task/core/adapter/server unit suite: `npm test` | 40 passed, 0 failed |
| Database-runner target safeguards: `npm run test:intake:runner` | 5 passed, 0 failed |
| Existing intake UI contract rendering: `npm run test:intake:ui` | 3 scenarios passed with synthetic props, no backend connection |
| TypeScript and production build: `npm run build:app` | Passed; existing Vite future-config-loader warning remains |
| DB runner without an authorized target: `npm run test:intake:db` | Refused before connecting, exit 2, as intended |
| Supabase local runtime: `supabase status` | Unavailable: Docker and Podman are not installed/on PATH |
| SQL/RLS/atomic rollback/idempotency/concurrent sessions | Prepared, **not executed** |
| Hosted Supabase/PostgREST JWT, Edge Function and Realtime parity | **Not tested in staging** |

Earlier installed native PostgreSQL initialization was also blocked by sandbox shared-memory restrictions; no replacement database or infrastructure was installed. The unrelated inactive Supabase project and Task-HQ production were not used. No paid infrastructure was created.

## Functionality and fixes in this candidate

The existing authenticated intake contract, SQL validation, server-controlled organization/source mapping, owned follow-up, source/external-ID deduplication, changed-payload rejection, success event, and shared receptionist envelope are retained. Construction is unmapped and disabled. No automatic FormSubmit/email delivery transport is connected. A trusted authorized operator/provider can use `scripts/submit-intake.mjs` after database setup and source authorization; there is no anonymous endpoint or new product intake form.

Two focused changes were made:

- **Member removal compatibility:** the original intake source foreign key to a membership would prevent normal member removal when that person was configured as follow-up owner. Source configuration now references the auth identity, and acceptance still requires that identity to be a current operational member of the mapped organization. Removed or reviewer owners fail closed; deleting an auth identity clears the source owner. A SQL regression covers disabled-source member removal and rejection after re-enabling with a stale owner. This SQL behavior is **not runtime-certified yet**.
- **Lock contention retry:** SQLSTATE `55P03` (lock timeout) is retryable alongside existing serialization/deadlock failures. The shared adapter retries the immutable original envelope with bounded backoff. Its new Node regression passed.

The migration remains additive and unshipped. Follow-up owner is configurable with no Abraham default. Roofing targets remain explicitly rejected.

## Automated database integration suite

`scripts/intake-db/run.mjs` uses independent `psql` processes and real database roles/locks. It requires `TASK_HQ_TEST_DATABASE_URL`; remote Supabase also requires the explicitly approved `TASK_HQ_TEST_PROJECT_REF` and TLS. Secrets are passed through environment variables, not process arguments or logs. It does not read `.env` files, look up account credentials, create infrastructure, apply migrations, or fall back to a production connection.

The guard rejects the Task-HQ production ref, the explicitly excluded inactive project, remote ref/host mismatches, and ordinary local databases. A local database must be separately named `task_hq_intake_test` or `task_hq_intake_test_<suffix>`. Test source mappings are enabled **only inside the explicitly authorized synthetic test environment**, then cleaned up. This does not enable real Construction intake.

The suite prepares randomly identified synthetic Construction/Roofing organizations and fake `.test` customer/account records. It runs:

1. The transactional `supabase/tests/intake.sql` regression suite: anonymous/foreign/reviewer denial; member-scoped receipt reads; revoked direct writes; validation; owner/source controls; deduplication; changed-payload conflicts; Roofing rejection; forced audit failure with complete rollback; and membership-removal compatibility.
2. The existing `rls_isolation.sql` baseline suite, recognizing its intentional final rollback exception.
3. Simultaneous identical event submissions: one acceptance, one original receipt, one lead/task/event, one revision increment.
4. Simultaneous conflicting payloads under the same key: one acceptance and one key conflict, no second write.
5. Two distinct sources racing in the same organization: both deliveries retained without lost updates.
6. Actual database commit followed by synthetic response loss: adapter retry returns the original durable receipt without another write.
7. Actual source-row lock timeouts: bounded retries remain unconfirmed; later replay safely accepts once and deduplicates.
8. Intake racing dispatch's actual compare-and-swap SQL predicate and server engine: stale dispatch write updates zero rows; reload/reapply preserves the intake. This is **not** an HTTP Edge Function test.
9. Foreign-tenant and platform-only sessions cannot read or create Construction intake events.

Concurrency tests observe lock waits through `pg_stat_activity`; a pair of queued promises alone does not count as concurrency evidence. Synthetic fixtures are cleaned up by exact UUID, and cleanup is checked. A run writes `docs/intake-db-test-result.json` with assertions, target identity, and cleanup status. No successful database report exists yet.

## Copilot UI coordination

The current UI work is present in `src/ui/components.tsx`, `src/ui/quest.css`, and `src/app/SpeedToLead.tsx`: shared `RecordCard`/`RecordMeta` components and intake provenance rendering. Those files were preserved byte-for-byte relative to the start-of-turn checkpoint. Offline rendering verified email-only website intake, receptionist source metadata, escaping of untrusted source text, and reviewer read-only cards. No browser/visual acceptance is claimed.

The receipt/error contract in `docs/intake-contract.md` remains the handoff. An installed Copilot CLI review was attempted again using only that contract and no repository tools; it exited without a response, and its log reports no authenticated GitHub host. No direct Copilot conversation or approval is claimed. Its existing UI code builds with this candidate; an authenticated Copilot review remains pending.

## Exact staging requirement and next approval

Authorize one **disposable non-production Supabase project/branch with no customer data**, or provide a working local Supabase/container runtime. No such target is authorized or available now. Remote testing needs operator database access through an approved secret mechanism (not pasted into chat), not just a publishable browser key. No paid project or branch will be created without explicit cost approval.

On that isolated target, prepare the existing tenancy baseline without production data: `20261017180000_tenancy_core.sql`, `20261017200000_org_admin_overview.sql`, and `20261017203000_grant_dispatch_service_role.sql`, plus the candidate `20261017193403_website_intake.sql`. Supabase Auth schema/roles must already exist. The provider-specific `20261017201000_harden_rls_auto_enable.sql` depends on a provider-installed function; apply it only where that function exists. Do not copy the production setup/owner-seeding SQL, blindly replay or repair remote migration history, or apply this candidate to production.

After configuring the approved target securely:

```sh
npm test
npm run test:intake:runner
npm run test:intake:ui
npm run test:intake:db
npm run build:app
```

Resolve database failures and review the generated report. Then run staging security advisors and an authenticated PostgREST/dispatch/Realtime smoke test against that staging backend. Use the staging Vite URL/key for any staging web build; the local build checked here uses the existing environment and is not a staging deployment artifact.

Production gates remain: successful staging database and authenticated HTTP checks; explicit dedicated Construction organization, operational owner and source-delivery approval; final UI review; and separate production release approval. Source enablement, website changes, or phone routing are not authorized by approval to run synthetic tests.

## Reviewable archive

`checkpoints/task-hq-intake-staging-candidate-2026-10-17.tar.gz` contains source, migration/tests, scripts, docs, package manifest/lockfile, and static build inputs. It excludes environment files, provider caches/linkage, compiled artifacts, dependencies, production setup/owner-seeding SQL, and other checkpoints. The adjacent `.sha256` file verifies the archive. This is a source candidate for staging validation, not a deployable production approval.
