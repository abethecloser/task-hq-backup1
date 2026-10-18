# Website intake and future receptionist contract

Latest follow-up: [staging candidate and exact remaining requirement](intake-staging-candidate.md).

Implemented locally 2026-10-17. **Not migrated, deployed, source-mapped, or connected to the website.** FormSubmit remains the live website delivery route. This work does not access mail, phone systems, personal accounts, or Podio.

`src/adapter/intake.ts` is the shared React/provider adapter; `scripts/submit-intake.mjs` is a runnable trusted-operator transport. It calls authenticated PostgREST RPC `receive_intake(p_envelope)`. No public anonymous webhook, browser secret, AI dependency, or automatic outbound contact.

The smallest initial operating path is an authorized operator supplying a website submission envelope from information already provided to them. Automated ingestion needs a separately approved delivery transport; this does not retrieve FormSubmit emails. Do not run synthetic Construction deliveries into Roofing.

```json
{
  "version": 1,
  "sourceId": "quest-construction.website",
  "externalId": "original-provider-submission-id",
  "receivedAt": "2026-10-17T18:00:00Z",
  "contact": { "name": "Synthetic example", "email": "fixture@example.test", "phone": "+16025550100" },
  "inquiry": { "need": "Synthetic estimate request", "address": "Synthetic address" }
}
```

At least one valid email/phone is required; every provided method must be valid. Required name (1–120), need (3–2000), external ID (1–200), ISO timestamp with timezone, source ID (3–80). Address <=500, email <=254, phone 7–15 digits with optional leading `+`. Formatted phone separators are removed; email lowercased, surrounding whitespace trimmed. Payload <=16 KiB. Unknown envelope/contact/inquiry fields are rejected, including tenant/owner overrides. Timestamps over five minutes in the future are rejected. Old arrivals are retained so delayed deliveries remain visibly overdue.

**User decision:** keep Construction disabled until a dedicated Construction organization is explicitly configured and authorized. Never route to Quest Roofing. Follow-up owner is configurable with no default to Abraham. No production changes without approval.

The server resolves `sourceId` from `private.intake_sources`: approved organization UUID, website/receptionist channel, HTTPS provenance URL, and accountable operational member. A current owner of that organization must be recorded as approver with a meaningful approval note. Default `enabled=false`; **no mappings are seeded**. Source configuration is inaccessible to browser roles. Caller must be a current operational member of the mapped organization. Reviewers, foreign tenants, missing source/owner/approval, and disabled sources cannot accept new deliveries. Platform administration alone does not grant intake access. The RPC rejects Roofing-preset organizations and the `quest-roofing` slug even if an operator mistakenly creates an enabled mapping. A separately authorized dedicated Construction organization must be used.

Receipt, real lead, owned task, workspace revision, activity event, and audit event commit in one transaction. Intake is an additional narrow server write path beside dispatch; ordinary client writes remain revoked. Workspace row locking coordinates with dispatch's revision compare-and-swap. Existing Realtime subscriptions receive the updated workspace. No first-contact attempt is fabricated.

## Retry and deduplication

The stable key is `(sourceId, externalId)`, never name, phone, or email. Use a durable provider submission ID, original email Message-ID provided by an operator, or future call ID. Generate and persist a delivery ID upstream once if no provider ID exists. Do not make a fresh ID on retry. Distinct provider IDs are distinct inquiries; possible repeat customers are not auto-merged.

Exact normalized retries return the original receipt with `status=duplicate`, without changing the workspace revision or adding signal/audit events. Reusing the key with different normalized data is a conflict. Source lock + unique constraint handles simultaneous delivery; all writes roll back if any later step fails. Receipt reconciliation remains possible after disabling the source, while the caller still has membership; moving a source to another organization cannot disclose an old receipt. Source IDs should never be repurposed across organizations.

The shared adapter snapshots the envelope before sending, retries transient failures at most three times, and preserves the key even if the caller mutates its object. Failure after retries remains **unconfirmed**. Durable queuing is the upstream provider/operator's responsibility: retain the original envelope across process/browser restarts and retry it. Do not discard it based on a toast, timeout, or non-receipt response.

Success: `{ok:true,status:"accepted"|"duplicate",receiptId,orgId,leadId,taskId,acceptedAt}`.

| Adapter code | Behavior |
|---|---|
| invalid | Correct invalid details before delivery; no auto-retry |
| unavailable | Confirm session, source approval, workspace and owner; no auto-retry |
| conflict | Review original receipt; do not generate another ID to bypass deduplication |
| retry | Unconfirmed; retain and retry exact envelope/key |
| server | Unconfirmed; retain original envelope and investigate |

## UI contract for Copilot

Coordination was attempted with the installed Copilot CLI using the contract alone and no repository tools. It exited without a response; its log reports no authenticated GitHub host. **Copilot review has not occurred.** This document is the concrete handoff.

Use `receiveIntake(live.client, envelope)` only in authenticated live mode. Disable repeated submission while pending. Keep the same original envelope on retries; display structured error text from the adapter, never raw SQL details. Show success only with a receipt, and link to its task/lead in the mapped workspace. Do not show Construction as available in Roofing without approved mapping. Live lead cards now render email, source event ID, and channel when present. Existing local/demo capture stays unchanged. No new intake form has been added to the product.

## AI receptionist

Use a separately approved `sourceId` with `channel=ai_receptionist`, the original call ID as `externalId`, and call arrival as `receivedAt`. Same validation, tenant checks, transaction, retries, and receipt. Only caller-provided contact/inquiry details belong here. Do not store audio/transcripts, claim consent, make appointments, change routing, or contact customers through this contract.

## Future Daily Signal

Read `public.intake_events` with the existing signed-in Supabase client. RLS restricts reads to organization membership. Query by `org_id`, `event_kind='intake.accepted'`, and `(accepted_at,id)` cursor; store processed receipt IDs downstream. For example:

```sql
select id, org_id, source_id, lead_id, task_id, accepted_at
from public.intake_events
where org_id = :authorized_org and accepted_at >= :day_start and accepted_at < :day_end
order by accepted_at, id;
```

Only successful transactions appear. Retries do not emit another success. No Daily Signal scheduler, AI summary, or customer message is implemented.

## Deployment gate

1. Review/apply the additive migration on a disposable/staging database with the existing tenancy migrations. It is CLI-generated as `20261017193403_website_intake.sql`; earlier migrations have future-stamped filenames up to `20261017203000`. Review actual remote migration history; do not blindly push or repair it. This migration needs the tenancy core first.
2. Run `supabase/tests/intake.sql` using psql with `ON_ERROR_STOP` (it rolls back fixtures), plus existing tenant isolation tests. Run Supabase security advisors. Exercise concurrent duplicate delivery and dispatch/intake revision conflict against that database. These database checks are pending, not passed.
3. Establish the Construction organization and follow-up owner explicitly. Do not create a new organization or map Roofing by inference. Operator creates a disabled source row with the approved UUIDs/channel/provenance, owner approval and note, then verifies it before enabling. No client mapping administration is included.
4. With an authorized member session, deliver one approved test envelope, reload via dispatch, verify the receipt/lead/task/audit and cross-tenant denials, then repeat the exact envelope to verify deduplication. A synthetic test environment is preferable.
5. `npm test && npm run build:app`. Deploy Task-HQ only after database checks and release approval. No dispatch Edge Function changes are required. Live website capture and FormSubmit remain untouched.

Trusted operator invocation (requires an explicitly authorized member access token supplied securely through the environment; this script does not sign in, read browser credentials, or connect any account):

```sh
node --env-file=.env.production.local scripts/submit-intake.mjs /absolute/path/to/original-envelope.json
```

Set `TASK_HQ_ACCESS_TOKEN` through an approved secret/session mechanism, never a shell argument, checked-in file, or log. The script pins the current Task-HQ Supabase hostname, limits request duration and input size, and prints only a receipt or sanitized error. Exit 75 means retryable/unconfirmed; exit 1 means review is required, exit 2 means missing invocation configuration.
