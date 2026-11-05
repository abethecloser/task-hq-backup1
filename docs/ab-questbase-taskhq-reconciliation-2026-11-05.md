# Project AB — Task HQ / QuestBase reconciliation and acceptance map
Date: 2026-11-05  
State: **Review evidence / implementation candidate, NOT an approved new baseline**  
Source branches inspected: `task-management-platform/main@17c6bec`, `qb/main@24f3fe5`  
Source context: Project AB ACTIVE.md / BASELINE.md / OPERATING_MODEL.md and system CONTEXT files (Nov 4), Abraham's Oct 19 recorded feedback, Task HQ and QB repo code/records.

## Product boundaries — preserve
- **Task HQ is the task execution authority.** Its `dispatch` Edge Function, engine, task identity, permissions, live/demo separation, and standalone UI remain intact.
- **QuestBase is the connected operating environment.** Identity, organizations, navigation, membership, cross-product context and intelligence belong there. QB does not acquire or duplicate Task HQ task writes.
- **Integration first = scoped, read-only reference and authorized deep link.** A verified task link now exists in Task HQ (`#/task/<id>?org=<workspace>`, PR #49); QB `src/integrations/taskhq.ts` still explicitly returns NOT CONNECTED. Do not imply shared login, role equivalence, or synced records.
- **No silent org/identity unification.** Task HQ and QB use distinct Supabase projects and account/membership authorities. Map subject + issuer + source org explicitly, deny ambiguities.
- **Data classification:** source-verified > historically reported > prototype/demo > hypothesis. Never display fake data as live.

## Abraham's saved product feedback (screen recording Oct 19)
See `docs/abraham-feedback-2026-10-19.md`, a transcript/frame review of Abraham comparing old Quest HQ and Task HQ.

| Requested behavior | Repo evidence by Nov 5 | Next verification |
| --- | --- | --- |
| Large, readable task rows; inline status, priority, assignee, due edits | `src/app/AllTasks.tsx` uses `TaskControls`; `src/app/TaskControls.tsx` dispatches engine-checked updates. | Signed-in authorized and unauthorized member walkthrough; visual density at 390/1280. |
| Dedicated prominent New task button | `AllTasks.tsx` `registry-new` button. | Confirm focus, placement and mobile accessibility. |
| Full-screen task instead of forced side panel | `src/app/TaskPage.tsx` is full task canvas. PR #50 additionally allows optional inline *peek* before navigating into full task. | Confirm opening full task stays available and unambiguous. |
| Comments prominent, Quick actions, watchers | `TaskPage.tsx` contains conversation, engine-authorized actions, watch toggle. | Confirm visibility, exact role permissions, persistence and live delivery. |
| Next-owner handoff creates the follow-up task | Task responsibilities and next-owner are implemented; historical baseline explicitly warns that a handoff label **does not prove** automatic follow-up task creation. | Audit engine hooks, follow-up idempotency and live `dispatch` version. Human authorization needed before automatic creation. |
| Add project inline, labels, Roofing/Construction/Drafting switch | Old batch-3 plan flagged deployed dispatch/schema parity as a blocker. | Verify backend supports project/taxonomy operations; do not alias Construction to Roofing. |
| Task creation form simplified; `Assigned` wording | `TaskPage.tsx` and `TaskControls.tsx` use Assigned; current create flow requires in-app walkthrough. | Test optional detail disclosure and creation persistence. |
| Watcher awareness without task authority | Watchers are a task authority field in the engine; do not repurpose as customer sharing. | Test engine-permitted watch and notifications, no external distribution. |

## Current code/PR checkpoints
### Task HQ
- `main@17c6bec` (PR #51, Nov 3): expanded task focus and contextual collaboration.
- PR #50: row-level context and Compact / Standard / Detailed densities.
- PR #49: workspace-scoped task links survive sign-in and reject unauthorized access.
- PR #48: Home Operating Desk and single bottom navigation. Prior collaboration pullout intentionally retired; communication remains in Inbox and task conversation.
- Repo includes `src/core/task-surface.ts`, `src/core/responsibility.ts`, `src/app/TaskPage.tsx`, `src/app/AllTasks.tsx`, `src/app/TaskControls.tsx`, `src/core/engine.ts` and `supabase/functions/dispatch`.

### QuestBase
- `main@24f3fe5` (PR #23, Nov 4/5): My Configuration; contact, device, consent and identity-evidence UI. Consent/identifier/monitor migrations were **reported unapplied** at merge, and real Auth testing outstanding.
- PR #22: invited-person email codes; SMTP and real email delivery unverified.
- PR #21: real identity, organizations, memberships and invitations; migration reported applied, but real two-account HTTP acceptance outstanding.
- `src/ui/hq/TaskHqEntry.tsx` links to standalone Task HQ; `src/integrations/taskhq.ts` is a version-0 *unavailable* adapter. No live cross-product read.
- QBIO `20261106000000` was reported applied remotely but current `qb/main` tree does not contain that migration. Prior inspection found the applied schema differs from later local editing. Treat as **separate reconciliation**, never run `db push`, reset, reapply or repair history as part of integration.

### Environment boundary
- Task HQ Supabase: `xthyyxnfjaxmtrqrhyxc`.
- QB Supabase: `jjfisgmaleyxgzmfonak`.
- Both are independent production projects. Connector inspection on Nov 5 returned **permission denied** to both; this record makes **no live DB assertions**.
- Vercel projects: `novum-systems/task-hq` and `novum-systems/qb`. GitHub branch/merge does not prove which SHA is live; inspect deployments separately.

## Prototype and source maturity
| Surface | Reality / limitation |
| --- | --- |
| Home, adaptive dock, task list, full task | Merged UI code; actual current production interactions not verified. |
| Team and responsibility projections | Deterministic logic built; derived from records, not a workforce capacity guarantee. |
| Channel Inbox | Historical implementation map says shared channel messaging is **demo/local only**. Don't label live shared messages without new evidence. |
| Calendar | Task due-date presentation exists; external calendar sync unverified. |
| Operational estimating/proposals | Demo-only; no approved live pricing/persistence/proposal-send path. |
| Podio import | Historical 569-row export has no stable Podio item IDs; 18 duplicate clusters / 43 rows; live extractor 0; no import authorized. |
| QB cross-product task adapter | Contract only, **not connected**; preserve source authority. |
| QBIO/ATA | Parallel experimental work; do not require it to launch Task HQ integration or claim AI delivery. |

## Acceptance sequence: Identity → Organization → Access → Task HQ → Collaboration → Persistence → Return

1. **Inventory.** Verify current checkout, clean/dirty status and unpushed work in both local repos and any existing Codespace. Record running Vercel deployment SHAs and current Supabase function/schema versions before tests.
2. **Identity.** Sign in to both applications with authorized test identities; verify actual principals independently. Never equate emails alone to shared authorization.
3. **Organization.** Record which source organization is selected; require a precise cross-product mapping. Unknown/mismatched org returns a non-enumerating denial, not another organization's work.
4. **Task HQ.** As authorized source user, open a task and use its existing share link; verify full task, action affordances and standalone return. As unauthorized user, link never reveals source data.
5. **Collaboration.** With two authorized Task HQ members, create one test task, assign, comment, hand off, refresh both sessions; no demo-only channel messaging claim.
6. **Persistence.** Verify engine-confirmed state, revision and audit after refresh and reopen; verify negative permission cases.
7. **Return.** QuestBase supplies a read-only source reference and explicit link-out; the task opens in Task HQ with its **own** authentication. On return, QuestBase does not claim to own task edits.
8. **Regressions.** List, Board, Calendar, create, inline edits, full task, task history, navigation/dock, mobile focus, standalone Task HQ, permission denial and demo mode remain intact.

### Smallest suggested implementation slice — additive, reversible, separately reviewed
- Begin in QB with a `TaskHqRef` carrying source product, source org, type and immutable task ID; keep `TaskHqReadAdapter` versioned and `not-connected` until identity mapping and authorized read have been demonstrated.
- Reuse Task HQ's existing link format rather than introducing a second deep-link scheme.
- In QB render the existing source state explicitly: `available` / `not-connected` / `denied`; no fabricated task list.
- Tests: malformed IDs/orgs denied; unrelated organization denied without data leakage; missing source explicit; auth return preserves target; no cross-product write path; links are URL-encoded and permission checked by Task HQ.
- Only after first live read works: make QBIO an optional *read-only* signal consumer of explicitly permitted task context. Do not alter task authority, archive, dispatch or roles.
- Deliver in an isolated feature branch with local tests and an acceptance record; production promotion and new database migrations are separate gates.

## Unresolved risk gates
1. **Abraham ownership/identity:** previously zero tasks despite activity and duplicate accounts; identify live auth subject, memberships and task assignees before any migration or task population.
2. **Event retention:** workspace task event log historically capped at 400 entries; durable task history needs explicit server schema/dispatch decision.
3. **KPI accounting:** Home completion attribution and Reports attribution differ historically; reconcile before executive reporting.
4. **Podio:** authoritative Construction org, Jobs app and export origin need Abraham decision before source-ID capture or staging import.
5. **Task HQ shared channel messaging:** not live; avoid mixing it with QB Connect/WhatsApp work.
6. **QBIO migration:** remote/current local contract mismatch; repair only with forward-only reviewed migration, not destructive reset.

## Session recovery
- Task HQ Claude session URL embedded in prior commits: `https://claude.ai/code/session_01Wb4pNhx5wZvJMtYDXaA1Pa`.
- Local Codex/Claude sessions are runtime history, distinct from Git branches. In a **matching original machine/container** use `codex resume` or `claude --resume` after inspecting `pwd`, `git status`, branch and remote. A freshly created GitHub Codespace may not contain local Mac session history.
- Do not reset, force push, switch a dirty checkout or blindly recreate worktrees while retrieving sessions.

**This document adds no code or new authority.** It preserves existing approved baselines and identifies a testable future integration candidate.
