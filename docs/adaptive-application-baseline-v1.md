# Adaptive Application Foundation — Approved Baseline v1.0

Company engineering reference, issued 2026-10-20. Reference: Quest Task Management, local checkout `~/Projects/bigQ/quest-task-management`. Governing direction: **Reuse first. Adapt intentionally. Ship confidently.** This document records the company directive and its source-based review; it does not approve every feature in this repository as production-ready.

## Authority and scope

Use verified Quest patterns when beginning internal applications, modules and client-specific projects, unless an approved project baseline or explicit requirements take precedence. Inspect actual relevant source before proposing a replacement foundation. Reuse principles independently of Quest branding, terminology, operational rules or technology choices. Do not impose React or Supabase on projects with a more appropriate existing architecture.

Review only: no runtime changes, shared-package extraction, migrations, production-data access or deployment. Existing uncommitted TaskPage.tsx and nexus.css refinements and mobile-standard document were preserved. Source snapshot: branch `main`, HEAD `20742f077ea722f877f45f8ea2dcf8a8ae39e3c3`, plus those local refinements. This identifies reviewed source, not a released artifact or deployed SHA. Recheck drift before reuse.

Repository access is not a distribution license. Generic ideas may be reproduced; actual cross-project code copying requires confirmed reuse rights, dependency/license review, preserved notices, and removal of client-specific assets, private configuration, credentials and data. No extraction is authorized by this review.

## A. Current capability inventory and maturity

Evidence labels: **implemented** = found in source; **tested locally** = targeted checks run in this review; **emulated** = preceding Task Detail browser checks in this session; **demo/device** = explicitly local persistence; **proposed** = not implemented. None of these labels alone means verified in production.

| Area | Source to inspect | Present behavior and maturity | Reuse decision |
|---|---|---|---|
| Application composition | `src/main.tsx`, `src/app/App.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `LiveContext.tsx` | React root, explicit demo/auth entry, application composition, Work/Manage and contextual navigation. Implemented; App contains substantial business coupling. | Adapt composition and context patterns; do not copy the entire shell or route inventory. |
| Styling and layout | `src/ui/quest.css`, `nexus.css`, `studio.css`, `home.css`, `behavior.css`, `brutalist.css` | Base primitives, workspace geometry, white theme, home surfaces, interaction feedback and alternate theme. Implemented; cascade is layered and has specificity overrides. | Reuse white continuous-workspace principles and semantic token roles; choose new brand values. Dark/historical references are not the visual standard. |
| Task workspace | `src/app/TaskPage.tsx`, `TaskControls.tsx`, `AllTasks.tsx`, `RegistryFilters.tsx` | Full-page detail, inline status/assignee/priority/due editing, filters and list/board layouts. Local refinements are uncommitted. Essential Task Detail paths emulated at 375/430/768/1440px. | Adapt record/detail and inline-action patterns, not task fields or permissions wholesale. |
| Forms and creation | `src/app/CreateTask.tsx`, `src/ui/components.tsx`, `Select.tsx` | Essential fields first, more-details disclosure, native form controls wrapped with custom options. Implemented. Phone create entry opened in prior emulation; full creation journey not proven there. | Adapt field/disclosure patterns; independently validate dialog focus, dirty-close handling and submit failures. |
| Dropdowns | `src/ui/Select.tsx`, `useDropdown.tsx`, `dropdown-controller.ts`, `dropdown.css` | Coordinated transient surfaces, outside dismissal, Escape, keyboard option navigation, portal positioning. Controller tested locally. | Strong first adaptation candidate; still imports local CSS/controller and needs target-screen-reader and keyboard testing. |
| References and mentions | `src/ui/ReferenceEditor.tsx`, `src/core/references.ts`, `reference-persistence.ts`, `reference-index.ts` | Structured references, draft rebasing and portal suggestion menu; composition-event handling. Mention selection emulated. | Adapt with a project-defined identity provider and scope; never import Quest people or tenant mappings. |
| Client state/actions | `src/ui/useQuest.ts`, `useFeedback.ts`, `src/adapter/store.ts` | React hooks around backend interface; action results settle feedback; distinct local/live authority. Implemented. | Reuse action/result contract approach; hooks and types currently depend on QuestState. |
| Business rules | `src/core/contract.ts`, `engine.ts`, `permissions.ts`, `selectors.ts` | Typed model/actions, validated state transitions and UI/server authority parity. Targeted engine/parity tests passed. | Reuse architecture and testing technique; retain Quest's rules and models in Quest. |
| Shared persistence | `src/adapter/live.ts`, `supabase/functions/dispatch/handler.ts`, `persistence.ts` | Session-authenticated requests, server membership resolution, expected revisions, conflict handling and Realtime subscription. Adapter tests passed; not live-service verification. | Adapt to target application's auth/schema. Re-evaluate conflict retries for each action; stale edits must not overwrite newer work. |
| Authentication/tenancy | `src/auth/client.ts`, `src/live/LiveRoot.tsx`, tenancy migrations and dispatch handler | PKCE client, browser secret-key refusal, server-authenticated actor and org membership, RLS-backed data boundary. Source inspected. | Architecture reference only; each application needs its own security model and provider validation. |
| Completion/reopening | `src/core/engine.ts`, `src/ui/Feedback.tsx`, `behavior.css`, `nexus.css`, `src/core/registry.ts` | Done state/time retained, dependency effects, authorized reopening, feedback and strikethrough rows, completed filter. Engine/feedback/registry tests passed. | Reuse lifecycle principles. Not a general checklist implementation or proof every detail surface meets the new completion standard. |
| History/undo | `src/core/engine.ts`, `contract.ts`, `src/app/Settings.tsx`, `TaskPage.tsx`; atomic commit migration | Actor/time/entity events, readable action messages, effect records, fingerprint-guarded undo; workspace events capped at 400. SQL audit infrastructure exists separately. | Adapt event semantics; do not advertise unbounded Living History or general archive/restore. |
| Continuity | `src/core/compose.ts`, `engine.ts`, `src/app/WorkSurface.tsx` | Existing dependency paths, unlock effects and handoff context; compose tests passed. | Adapt explicit related-record navigation; domain rules remain project-specific. A next-owner handoff message is not proof of a newly created follow-up task. |
| Notifications | `src/app/notifications.ts`, `src/core/inbox.ts`, `src/adapter/messaging.ts` | Notifications are projections; unread is local presentation state. Messaging adapter is demo-local. | Reuse read-model approach; not a verified email/push/durable messaging service. |
| Documents/estimating | `src/app/Tools.tsx`, `src/core/tools/estimating.ts`, `src/adapter/tools.ts` | Estimate/proposal rules and browser print; tools adapter is demo-local, no shared live backend there. | Keep pricing/approval/document rules Quest-specific; adapt print mechanics after authorization. |
| Captures/attachments | `src/adapter/media.ts`, `src/app/capture.ts`; separate `src/shifts/` subsystem | Review-media adapter uses IndexedDB device storage. Shift media is a separate domain and must be assessed separately. | No claim of universal shared attachment capability. Design private storage/retention per product. |
| Workbook | External review artifact `/private/tmp/quest-operations-workbook-review/` | Five-tab synthetic session-only prototype; visual direction accepted. Shared storage, conversion, sheet management and full mobile flow proposed. | Future pilot, not an implemented baseline capability. |
| Build/development | `package.json`, `vite.config.ts`, `vite.extension.config.ts`, `vercel.json`, `scripts/sync-functions.mjs` | Vite/TypeScript web and extension builds; Node test runner; generated server engine mirror. Existing Vercel config is a recipe, not deployment identity proof. | Adapt workflow only. Do not copy project linkage, environment values or extension permissions. |

## B. Reuse recommendations

**Use principles as-is:** source-first inspection; explicit local/live distinction; server-confirmed outcomes; action/result separation; retained completed records; native semantics; progressive disclosure; targeted parity tests; mobile interaction acceptance; no automatic work creation without an established rule or authorized action.

**Adapt existing modules after rights review:** dropdown controller and select wrapper; focus/dismissal behavior; fields and accessible validation; record rows; contextual headers; feedback phases; semantic theme tokens; structured reference adapter; backend interface. These are not drop-in company-wide components: imports, CSS, storage keys, labels, actor/tenant identity, and domain types require review.

**Keep Quest-specific:** engine rules, Critical Focus/Ultra policy, role mappings, lead-response logic, estimating rates and approvals, company inference, roster/seed data, branding/fonts/assets, workflow wording, production identifiers, badge/shift rules, provider configuration and deployment access.

**Do not copy as a foundation:** the complete App component, historical reference builds, browser-local operational stores as synchronized storage, generated dispatch mirror as a second editable source, or migration history into an unrelated database.

## C. Visual and interaction standards

### Continuous workspace and tokens

Use white open surfaces, content-led hierarchy, alignment, spacing and thin dividing lines. Use containers only for actual grouping, editing or overlay boundaries; avoid nested dashboard boxes. Use available width without sacrificing reading clarity. The latest task refinement is the current reference, not an instruction to reproduce every historical screen.

Map semantic roles (`--canvas`, `--card`, `--ink`, `--muted`, `--hair`, `--line-2`, `--accent`, focus/error/success tokens) to each project's brand. Keep spacing and field/control geometry consistent; do not inherit orange, logos or font choices by default. Existing 34–38px desktop defaults do not satisfy phone target sizing globally. Avoid reproducing the cascade's growing specificity; choose an explicit token/base/component/override order for new work.

### Mobile and accessibility

Apply `mobile-experience-standard.md`: 44×44px targets, equivalent essential functionality, one-handed common actions, visible context, focus visibility, no unintended overflow, keyboard-safe editors and useful full-screen editing/sheets when needed. Horizontal scrolling is appropriate for actual wide data only when complete content and actions remain accessible; it is not a substitute for phone row editing. Test 375/430px, tablet and desktop; exercise orientation, menus, typing, save/retry and reload. Report hardware versus emulation. Respect reduced motion and avoid repeated decorative animation.

### Interaction contract

For create/edit/status/assignment actions: expose authorized contextual controls; validate input; identify pending state; prevent accidental duplicate submission; confirm success from authoritative persistence; preserve draft and show recoverable failure; return focus deliberately on close/cancel. Hidden buttons do not enforce permissions. Inline editing must not sacrifice explicit cancel, failure recovery or safe conflict resolution. Search/filter/tab state is presentation unless operationally important; do not audit every transient interaction.

### Completion standard

On activation, immediately show pending feedback; display the completed check/control and final completed styling only when completion is confirmed, or explicitly mark an optimistic state pending and roll it back on failure. This reconciles immediate response with truthful persistence. Apply readable strikethrough, restrained tone and optional short check/highlight transition; reduced motion omits nonessential animation. Retain entity, context and history; offer Completed/History when removing from active view; allow authorized reopening and record it. Existing completion paths are references, not a mandate to retrofit this review's directive across production apps. No checklist system is assumed to exist.

### Living History and recovery

Record significant actions with stable event/entity IDs, authenticated actor, server timestamp, operation, readable summary, relevant previous/new values and related effects as appropriate. Define privacy, retention and access before retaining field values. Preserve event ordering and make partial coverage visible. Retained task state is not equivalent to retained full history.

For future archive/restore: retain identity and relations; check current permission; record restoration as a new event; refuse invalid relationships; never silently reverse dependent approvals/handoffs. Existing fingerprint-guarded undo is useful precedent, not a general restore capability. New audit or recovery tables require separate implementation approval.

### Follow the Path

Show authorized predecessor/current/next records with meaningful labels. Distinguish suggested next work, user-created work and rule-executed work. Suggest creation when no next step exists; do not invent tasks or recipients. Preserve executed/skipped effects so users can understand why a dependency did or did not advance.

## D. Minimal candidate shared foundation

Start with documentation and a project-local pattern manifest. No new repository, runtime, package or platform is created by this review.

Suggested structure for an authorized future project, adapted to its existing stack:

```text
engineering/reference.md       # selected patterns, source snapshot and evidence
ui/tokens                     # semantic roles with project-owned values
ui/primitives                 # only components actually required
ui/interactions               # focus, menus, feedback, motion policies
features/<domain>/            # project-specific model, views and rules
adapters/                     # auth/persistence boundary, if needed
verification/                 # workflow evidence, scope and known gaps
```

The smallest initial set is semantic tokens, a field, a contextual action, a coordinated dropdown, and an explicit async result pattern. Add a record shell or history view only when required. Keep auth/tenancy policy and business state machines project-owned. A later shared library needs actual second-use evidence, rights approval, a dependency boundary, versioning and a rollback path. Proposed common improvements require review before adoption; client experiments do not automatically update v1.0.

## E. Gaps, risks and validation boundaries

1. **Source/deployment parity:** local source and documentation can differ from the running server. No provider, live database or deployment inspected in this review. Verify exact environment/identity and approved schema before any release claim.
2. **History:** workspace stream is bounded at 400; UI further limits displayed items. SQL audit is separate and is not automatically a complete before/after journal or restoration system. Define retention and pagination before promising Living History.
3. **Recovery:** reopening exists; general soft archive/restore and checklist lifecycle are not established here. Avoid copying undo as a universal rollback; dependent work and authorization can change.
4. **Mobile:** prior local Chrome emulation covered essential task actions at 375/430/768/1440, with help and create-entry checks on phones. It did not prove real keyboard behavior, attachment camera/upload, screen-reader interaction, full create-submit flow, cross-user assignment authority or live persistence. New Task Detail touch CSS is scoped, not a global mobile guarantee.
5. **Storage:** tools/messaging/review media have local-only paths. Their UI must not imply shared persistence. Distinguish Realtime from durable notification delivery.
6. **Concurrency:** existing live adapter reloads/retries once on conflicts. Adopt only after examining semantic safety and idempotency for the new operation; no blind import or stale-value retries.
7. **Security:** service-role server paths require explicit membership and field/action enforcement. RLS, hidden navigation, UI authority and display-role labels have different responsibilities. Each new tenant model needs isolation and revocation tests.
8. **CSS/accessibility:** multiple theme files and high-specificity fixes create extraction risk. Custom select/mention portals need mobile viewport, assistive technology, focus and native-keyboard acceptance in their destination.
9. **Performance:** prior app build passed with a large-chunk warning and Vite native-config warning. No new performance benchmark run. Profile a real slow journey before splitting bundles, virtualizing or introducing state frameworks.
10. **Build side effects:** npm test and check:server invoke sync-functions, which replaces generated server-core files. Inspect and isolate before running these during a documentation-only review. Do not hand-edit generated mirrors.
11. **Compatibility:** no general XLSX/CSV engine present. Workbook compatibility, formula handling, safe export, import preservation and original-file retention remain proposed, not inherited capabilities.
12. **Ownership/privacy:** source availability does not establish cross-client licensing. No seeds, customer records, credentials or private configuration belong in a shared foundation.

### Evidence from this review

Read-only source inspection at the snapshot above. Ran Node tests directly (no generation script): engine, permission parity, sensory feedback, registry, composition, live adapter and dropdown controller suites. **44 passed, 0 failed.** Results: `/private/tmp/quest-foundation-checks.log`. Tests validate selected local logic, not RLS, external auth, Realtime or production behavior. The preceding mobile-refinement step passed `npm run build:app` and Chrome synthetic interaction checks; those were not repeated for this documentation-only review. Older repository verification reports remain historical and are not recertified here.

## F. Next concrete opportunity

Use Operations Workbook as the next project-local application of this baseline **after the current Task Detail release**. Its visual direction is accepted; future scope still needs concrete implementation approval. First bounded slice: reuse existing field/select/feedback patterns for one synthetic worksheet plus five-tab navigation and a focused phone row editor. Verify complete cell content, authorized row actions, keyboard behavior and 375/430/tablet interaction before shared storage or file conversion. Do not build a new workbook framework or shared component library.

This slice can demonstrate second use of menus, editors, tokens and feedback without moving proprietary code across companies. Its later shared persistence, RLS, history, import/export, printing and rollback require their own evidence and approval. Reference proposal remains an isolated review artifact, not production module code.

## Team execution and acceptance

Follow **Inspect → Reuse → Adapt → Implement → Experience → Improve → Deliver**. Before changes, identify repo/branch/status; preserve dirty work; inspect relevant components and their dependency/rights boundary; choose the smallest coherent adaptation. Use isolated prototypes for unapproved visual ideas. Keep approved implementations reversible. Run targeted checks; verify outcomes through real workflows; label unknowns.

Each developer's handoff should identify: existing component and maturity; reuse/adapt/new decision and reason; project-specific differences; permission/persistence/history boundaries; interaction/device evidence; remaining gaps; and any proposed shared improvement awaiting review. Do not repeat a full audit when an existing source-linked review suffices and the relevant files are unchanged.

Acceptance: faster starts through verified reuse; cohesive but independently branded products; functional mobile and desktop journeys; reliable state and appropriately retained history; modular reversible shared patterns; project-owned identity, rules and permissions; and no destabilization of approved applications. Baseline v1.0 is a starting point for deliberate evolution, not a claim of universal production readiness.
