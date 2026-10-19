# Local takeover candidate — 2026-10-18

Continued the existing working tree. No commits, resets, deployments, real accounts, memberships, source connections, or migration applications. Existing edits and checkpoints preserved. The last existing checkpoint was `checkpoints/task-hq-stageA-awareness-2026-10-17.tar.gz`. Baseline: 149 tests passed.

## Delivered scope

- **B:** Ultra Priority is a compact disclosure, closed when inactive and open for active focus/access requests. Activation uses the existing engine, permissions, grants, and task picker. Existing Studio rail, pullout and three-zone geometry remain. Prior All Tasks, Company Work, attention-card and Executive Desk implementations remain intact. Exact visual parity against the Claude Design artifacts and a complete mobile visual acceptance pass are not claimed.
- **Universal Command Input:** inspected and retained the already implemented person/tag/type autocomplete, deterministic natural-language dates, editable structured preview, task/plan clauses, dependencies, assignment confirmation and permission-checked task dispatch. Existing command tests pass. No AI provider is connected; suggestions are deterministic. See `command-input.md` for syntax and live taxonomy limitations.
- **C:** manager-configured workspace work-label definitions, searchable custom entry and assignment to existing people. “Operations & Systems Lead” is suggested. Labels are separate state fields; no role, membership, policy or permission changes. Local demo writes only in this release; live configuration explicitly waits for a candidate server release.
- **D:** searchable Relationship Vault built directly on existing inquiry identities and opportunities. Contact details, ownership, tags, next actions, contact history, event history, and linked tasks share existing lead/task records. No duplicate CRM or task store. This minimum directory covers inquiry relationships, not a general independent multi-contact CRM. Tag editing is local-only until server release.
- **E:** First Response uses existing synthetic intake, queue, contact-attempt and follow-up workflows. New `lead/claim` atomically requires an unclaimed, open inquiry. Competing local writes serialize; candidate server actions use authenticated membership and the existing revision-checked commit. Stale server retries re-evaluate the claim. The Instrument Deck's claim offer now uses this action. Reassignment remains a separate existing authorized workflow. Response clock uses existing policy configuration. Unconnected source states are explicit.
- **F:** optional collapsed Response League preview derives points from reached contacts and completed linked follow-up/handoff tasks. No points for claims, scheduling, no-answer attempts or repeated contact attempts. Contact credit goes to the first reached logger; task credit to recorded task owner. No prizes, durable score counter, external reporting or anti-fraud claims.

## Local review

```sh
npm run dev -- --host 127.0.0.1 --port 5196
```

Open http://127.0.0.1:5196 and choose **Explore the Task-HQ Demo**. This origin isolates browser demo storage from existing local sessions. In the demo, select Jordan for work-label configuration and compact Ultra Priority; First Response and Relationship Vault share the same records. All demo people and inquiries are synthetic. No communication is sent.

## Evidence

- `npm test`: 152 passed after takeover (149 baseline plus 3 regression tests).
- `npm run test:db`: 9 passed, in-memory PGlite only; no remote database. Includes the baseline owner-invite vulnerability reproduction and candidate-fix verification.
- `npm run check:server`: passed.
- `npm run build`: web and extension builds passed. Existing Vite native-config and large-bundle warnings remain.
- Chrome at isolated local origin: directory rendering; claim; synthetic reached outcome; linked follow-up creation; relationship history; reload persistence; custom label save without permission change; collapsed Ultra Priority in Needs Attention; optional League leaderboard shows 10 points for reached contact and no points for scheduling the follow-up.
- New regressions cover serialized competing claims, label permission separation, reviewer/foreign-owner refusals, shared follow-up links, no activity-count rewards, and the candidate HTTP handler's server-derived claim actor/refusal of an existing claim. HTTP tests stub auth/database replies; they are not live RLS or deployment verification.

## Approval-dependent release work

The pending owner-invitation security migration remains an explicit release blocker. No migration was applied by this takeover. Candidate dispatch/frontend release, approved source routing, real authentication/Realtime concurrency acceptance, and any actual invitations require a separately authorized release/testing scope. New actions are available in source and the synthetic local experience, not asserted to exist in the deployed server. Operational Tools remains the pre-existing local prototype. General CRM identities, external communication delivery and AI planning are outside this minimum implementation.
