# Communication inquiry normalization

`src/integrations/communications.ts` exports `normalizeCommunicationInquiry(channel, payload, { sourceId, now? })`. This pure adapter returns `{ok:true,envelope}` using the existing `IntakeEnvelope` or `{ok:false,errors:[{field,code,message}]}`. No network calls, credentials, subscriptions, account connections or outbound messages are implemented.

All channels require `receivedAt` with timezone, `contact: {name,email?,phone?}`, and `inquiry: {need,address?}`. At least one valid contact method is required. The stable identity field depends on the channel:

| Channel | Required original identity |
| --- | --- |
| `website_quote` | `submissionId` |
| `business_email` | `messageId` (original Message-ID) |
| `receptionist_call` | `callId` (original provider call/session ID) |
| `manual` | `entryId` (persisted once upstream) |

The caller verifies provider authenticity and authorization before normalization, supplies a server-controlled source ID, and durably retains the resulting envelope before calling `receiveIntake`. A retry reuses the exact same envelope. This adapter never generates an identity, assigns an owner, infers an organization, or parses arbitrary email/transcript text. It projects only explicitly supplied inquiry fields and drops attachments, transcripts, headers, and routing overrides. Validation errors contain field names and instructions, never supplied customer details.

RingCentral support is a contract for explicitly supplied call facts; this does not parse or validate raw RingCentral webhooks, verify provider signatures, or implement a live connector. Business email input likewise does not access a mailbox or parse raw MIME. Website input does not alter FormSubmit. Manual input still requires an authorized session and approved server mapping. Owner, organization, channel provenance, enabled state and approvals remain enforced by the intake RPC. Construction remains disabled pending organization, owner, source and release approvals.

Focused inspection of `package.json`, `src/integrations`, and `src/adapter` found no RingCentral, mailbox, or calendar provider SDK or live connector. The existing foundation is authenticated Supabase intake delivery and retry handling. Final envelopes pass the shared `validateIntakeEnvelope` boundary: lowercase source IDs without colons, actual calendar dates, at most millisecond precision, and normalized UTC timestamps. These checks do not replace provider authenticity verification or server authorization.

Calendar access is deferred: intake does not infer an appointment or create calendar events from an inquiry. A future read-only calendar reference must be separately authorized and must not imply availability, booking, or customer consent.

Contract checks: `node --test src/integrations/communications.test.ts`.

## Available foundations, without connecting accounts

The current tool catalog exposes Gmail and Google Calendar capabilities; no RingCentral capability was found. Tool availability is not proof of an authorized business-account connection. None of those tools were invoked to inspect mail, calendars, customers or accounts. The Task-HQ package/source inspection found no existing provider SDK or active mailbox/calendar integration to reuse. The existing FormSubmit delivery route remains unchanged.

`src/integrations/calendar.ts` now normalizes explicitly supplied, organization-scoped appointment references into Claude's existing `CalendarFeed` type. It requires an explicit synthetic flag, bounds the feed to 100 references, validates unique IDs/time ranges, and strips attendee/private metadata. It does not fetch calendars, establish account authorization or create appointments. Two synthetic contract tests cover the boundary.
