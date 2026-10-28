# Demo and real-profile parity check

Status: partial parity; demo is not a role-accurate preview of live Member permissions.

## Direct authenticated production UI checks

Both accounts were inspected in Quest Roofing at task.questroofing.com without editing task or membership records.

| Account | Verified organization / work role | Observed behavior |
| --- | --- | --- |
| team@enternovum.com | Admin / Manager | Task registry exposes editors for other owners' assignment, status, priority, and due date. People & Access identifies Admin authority separately from platform administration. |
| qa.prototype.33@gmail.com | Member / Field | Other owners' task rows show read-only assignment, status, priority, and due date. People & Access has no invitation, role-change, or removal controls. Own open-work count is zero. |

The Admin entered through Continue without a shift. QA was already on shift when inspected; this audit did not start, end, or alter that shift.

Both live profiles still showed the older production shell and four Home metric cards. The newer local styling is not verified as deployed by this audit.

## Source and deterministic checks

LiveRoot renders the shared App with LiveContext and a live backend, after WorkdayGate. The demo renders App with synthetic people and local data; its people lack membership authority.

permissions.ts intentionally grants broader legacy behavior when authority is absent. A direct check of seed Alex versus the same person with Member authority returned:

| Check | Current demo Field persona | Member authority |
| --- | --- | --- |
| Assign other people | allowed | denied |
| Edit another owner's task | allowed | denied |

The focused parity and live-adapter suites passed: 22 tests. These are deterministic tests, not authenticated server negative tests.

## Remaining work

- Give demo role presets explicit membership authority if the demo is to represent Admin and Member workflows accurately; preserve synthetic records and never substitute real account IDs or data.
- Validate the latest frontend while authenticated as both accounts; production currently displays the older build.
- Persistence, cross-user synchronization, cross-tenant isolation, and live server rejection of unauthorized mutations were not exercised. No production task, membership, password, or shift mutations were performed by this audit.
