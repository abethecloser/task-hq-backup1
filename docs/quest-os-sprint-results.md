# Quest OS backend candidate — 2026-10-17

Status: implemented locally, tested without a database, not deployed. Production and its previously verified owner task persistence baseline are unchanged. Construction intake remains disabled. The independent local demo and UI files were preserved.

## Working functionality

- Shared validated intake for website quotes, receptionist calls, business email and manual entry; stable source/submission identity, canonical payload checks, bounded retry and configurable approved follow-up owner. Atomic SQL creates the receipt, lead, follow-up and audit together; SQL execution remains unverified.
- Authenticated organization-scoped operations, executive intelligence, command preview and durable intake-event interfaces. Receipt feeds expose bounded metadata rather than customer envelopes. Command previews execute no actions.
- Bounded automation reuses the shared deterministic rules for unowned work, intake response SLA, overdue/blocked work and unresolved handoffs. Prepared persistence reconciles attention with meaningful-change audits, revision/authority checks and protection against older evaluations overwriting newer results.
- Atomic workspace save/initialization RPCs; live adapter ignores older revisions and reports ambiguous saves as unconfirmed.
- Pure communication and calendar normalization adapters with synthetic tests. These do not connect accounts, verify provider webhooks, fetch mail/calendar records, route calls or send messages.

## Verification actually performed

| Check | Result |
|---|---|
| npm test | 101 passed, 0 failed; includes existing app, executive simulations, automation, adapter and HTTP contract fixtures |
| npm run test:intake:runner | 5 guard tests passed |
| npm run test:intake:ui | 4 offline rendering scenario groups passed |
| npm run build | Web application and extension builds passed |
| npm run check:server | Server TypeScript passed, including production entry point with Deno ambient declarations |
| node --check scripts/intake-db/run.mjs | Passed |
| npm run test:integration:db | Blocked before connection: no authorized database URL; executed=false, passed=false |

HTTP/backend tests use fixtures; they do not prove deployed authentication, SQL, RLS, Realtime or provider transport. No database integration suite or new production smoke ran in this sprint. No local Docker/Podman runtime is available. No source-control SHA can be supplied: this checkout has an empty .git directory rather than a usable Git repository.

## Integration handoff

[Backend contract](quest-os-backend-contract.md) describes createOperationsClient, scoped records, permissions, bounds, shared intelligence, command previews and migration order. Claude can consume the shared intelligence and scoped feeds; Copilot can build interactions against these interfaces without duplicating rules or database access. [Communication contract](communications-contract.md) describes the four intake adapters and calendar normalization. No authenticated direct Copilot conversation was possible; its CLI lacks authentication. Existing UI files were not edited.

## Release gates and next action

1. Authorize an isolated disposable Supabase staging target and operator access. Execute the guarded database runner against it: SQL transaction/rollback, tenant RLS, permissions, idempotency, retry and independent-session concurrency must actually pass. Then stage the function and perform authenticated multi-user/Realtime checks and database advisors. See the backend contract for release order; do not replay production setup or owner seeds.
2. Explicitly approve the dedicated Construction organization, operational owner, authorized data source and release before enabling any Construction source. Never route into Roofing or default ownership to Abraham.
3. Provider-specific credentials, webhook verification and transport require separate authorized integration work; supplied-data adapters alone are not live integrations.
4. Production deployment requires explicit approval after staging evidence. No infrastructure, deployment, live website, personal account, call routing or external messaging changes occurred.

Recommended next action: authorize one disposable non-production Supabase target so the prepared database suite can run. This candidate is ready for that validation, not approved for production.

The source archive and per-file manifest are in checkpoints/task-hq-quest-os-candidate-2026-10-17.*. They exclude credentials, provider linkage caches, production setup scripts and build artifacts. Existing checkpoints remain intact.
