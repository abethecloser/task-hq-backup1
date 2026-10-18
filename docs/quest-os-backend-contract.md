# Quest OS backend contract — version 1

This is the shared integration boundary inside the existing Task-HQ application, not another app. Codex owns the transport/persistence modules below. Claude owns `src/core/executive.ts`, `executive-commands.ts`, rules, simulations and recommendations; Copilot owns presentation/interactions. Codex's only shared core type change is adding `business_email` and `manual` to existing lead intake channel metadata. Core intelligence and UI files have not been replaced.

## Authenticated interfaces

Use the existing Supabase session and publishable configuration:

```ts
import { createOperationsClient } from '../adapter/operations.ts';
const operations = createOperationsClient(live.client, supabaseUrl, publishableKey, live.org.id);
const result = await operations.snapshot(100);
if (result.ok) {
  const brief = result.snapshot.intelligence.brief;
  const desk = result.snapshot.intelligence.decisionDesk;
  const followUp = result.snapshot.intelligence.followUps;
  const signal = result.snapshot.intelligence.dailySignal;
}
// Durable receipt metadata for Daily Signal; no customer contact envelope:
const intakeEvents = await operations.intakeEvents(undefined, 100);
const preview = await operations.previewCommand('Who needs me?');
// Owner/admin/supervisor only; on demand, not a background schedule:
const receipt = await operations.runAutomation();
```

All calls use the existing `dispatch` Edge Function with the current JWT, `orgId` and one of `operations`, `command-preview`, `automation`, or `intake-events`. The function verifies the session with Supabase Auth and reads real current memberships. Platform administration or support access alone does not authorize these operations. No actor/principal/records supplied by a browser are trusted. Server-created people/workspace fields replace stored authority.

- **operations:** read-only `OperationalSnapshot` from `src/automation/contract.ts`. Version, organization, workspace revision, generation time and runtime timezone accompany normalized tasks/leads, attention records, event references, coverage and executive totals. `intelligence` calls Claude's existing Executive Brief, Decision Desk, Follow-up Intelligence and Daily Signal directly. Their options remain proposals; nothing executes them.
- **intake-events:** member-scoped, read-only durable successful receipt metadata (source, original ID, channel, provenance URL and linked task/lead). No contact envelope is returned. Default window is the last 24 hours; a supplied start and limit are bounded, with `truncated` stated explicitly. Database errors return unavailable rather than an empty/no-activity claim. Poll an overlapping time window and deduplicate receipt IDs; this is a bounded read feed, not an exactly-once streaming subscription or complete historical export.
- **command-preview:** read-only text adapter to Claude's existing `runExecCommand`. Principal comes from the JWT. Text is limited to 1,000 characters; selection is task/lead IDs only. Output is an answer, refusal, or proposal, never a committed action. A future voice provider supplies text to this same boundary after its own authorization; no voice provider/audio processing is connected. Approved actions still go through the existing `dispatch` engine after user confirmation.
- **automation:** current operational owners/admins/supervisors can reconcile up to 200 attention records. No actor with reviewer work-role can run it. Evaluation reuses existing workflow rules; it doesn't create a second detector, auto-contact anyone, approve decisions, or assign from a guessed person. New intake owner assignment and follow-up creation happen only through the explicitly approved intake source mapping. Missing owners surface an assignment request; manager accountability for handling that request does not assign the underlying task.

Claude can also import the same pure core functions for local demo/simulation. No service key or direct database access is needed by either consumer. `projectExecutive` is only a transport/bounding wrapper; intelligence remains in shared core. The function sync script copies the same pure implementation into the Edge Function.

## Coverage and deterministic execution

At most 200 records per collection are returned (default 100). `coverage` and `intelligence.complete` state when output is truncated. Activity is explicitly limited to retained workspace history, not a complete business communication log. The oldest available event is reported. Disconnected calendar/call/email sources remain labeled disconnected by the shared core; no missing-source activity is inferred. Date-only task/day semantics use the reported runtime timezone; staging must check server/browser date-boundary parity before release.

Rule evaluation refuses workspaces exceeding 2,000 combined task/lead/grant inputs, so execution is bounded. Automation refuses incomplete batches instead of silently resolving omitted records. Stable rule IDs are scoped by organization. Unknown/former operational owners project as missing ownership without changing stored historical attribution. Suggested actions are dry-run through the existing engine for the current actor.

Persistence compares meaningful rule/subject/owner/next-action/condition-version fields. Changing countdown prose or polling doesn't generate another attention/audit event. A complete run resolves absent conditions; reappearance reopens the same key. Stored prose describes the last meaningful transition; use the live projection for current countdown text. Attention synchronization doesn't increment task revision or create follow-up tasks repeatedly. There is no background scheduler in this candidate.

## Persistence and authorization safety

Candidate migration `20261017230608_operational_attention.sql` adds:

- Tenant-scoped, read-only-for-clients `operational_attention` records; RLS requires organization membership.
- A private evaluation watermark, checked under the workspace lock, preventing an older time-based evaluation from overwriting a newer evaluation of the same task revision.
- Service-only `initialize_workspace`, `commit_workspace_action`, and `sync_operational_attention` RPCs. Ordinary clients cannot call them or write attention directly.
- Atomic task state/revision + audit writes. A failed audit rolls back the task write. Initialization is audited only on its first successful insert.
- A roster authority fingerprint locked/compared before commit. Role demotion or assignee removal invalidates a previously evaluated action even if workspace revision didn't change. A narrow private definer helper acquires membership row locks; it does not grant the service role a general membership-update privilege.

The expiry/tick path returns no changed state if its commit loses a race. The browser live adapter retains the highest observed revision and treats a lost response as unconfirmed, requiring reload before retry rather than promising nothing changed. This does not add task-action retry IDs: after an ambiguous task save, reload before issuing a new creation.

## Intake and communication interfaces

`validateIntakeEnvelope` is the shared boundary validator; SQL remains authoritative. `normalizeCommunicationInquiry(channel,payload,{sourceId})` supports website quote, supplied business email, supplied receptionist call facts and authorized manual entry. Original event IDs/arrival times survive retries. Intake retains the shared 400-event workspace history bound while preserving successful receipts separately for the durable metadata feed. Provider payloads are allowlisted and exclude transcripts, recordings, attachments, credentials and tenant/owner overrides. `normalizeCalendarReferences` maps bounded supplied facts to Claude's existing `CalendarFeed`, discarding private metadata; it does not connect or create appointments.

These are normalization adapters, not authenticated webhooks/OAuth connectors. RingCentral signature/challenge handling, mailbox authorization and calendar authorization are not implemented or activated. FormSubmit is unchanged. Construction has no enabled mapping; its dedicated organization, operational follow-up owner, source and release still require explicit approval. No Abraham default, Roofing route, Podio migration, customer communication or private-account connection is introduced.

## Integration tests and release order

Run `npm test`, `npm run check:server`, `npm run test:intake:runner`, `npm run test:intake:ui`, and `npm run build`. The new HTTP handler tests use a synthetic database boundary; they verify real request routing/permissions and pure engine integration, not a deployed Supabase backend.

`npm run test:integration:db` is the existing guarded independent-session runner. It now also requires the operational migration, runs `supabase/tests/operations.sql`, and includes out-of-order evaluation and concurrent membership-demotion races. SQL tests cover attention RLS, polling idempotency, atomic audit rollback, authority changes and source channel metadata. No database run is claimed unless its generated report says it passed on an explicitly authorized non-production target.

Deployment is blocked until an authorized test database exists and these SQL/concurrency tests pass. Prepare the tenancy baseline on a disposable Supabase target, then both candidate intake and operational migrations; no production data/setup seeding. Review migration history first. **Migrate and verify the new RPCs before deploying the candidate dispatch function**, because task writes now require atomic commit RPCs. Then smoke-test authenticated task creation/persistence, role changes, operations, command preview and Realtime on staging. Use staging Vite configuration for any hosted preview. Record/export current provider deployment versions before an approved release; retain an additive-schema rollback path by restoring the previous function/app artifacts. No deployment was performed.
