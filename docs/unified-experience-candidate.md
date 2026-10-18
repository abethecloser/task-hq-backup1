# Unified experience — release candidate (2026-10-17)

Status: **local candidate**. Production (https://task-hq-three.vercel.app, dispatch v3, 4 applied migrations) is unchanged. Nothing was deployed, no invitations were created or sent, and no production data was written. Checkpoint before this work: `checkpoints/task-hq-before-unified-experience-2026-10-17.tar.gz`.

## What changed

- **All Tasks** (`src/core/registry.ts`, `src/app/AllTasks.tsx`): one permission-scoped registry with five lenses over the same records: All, My Tasks, Team Tasks, Needs Attention and Completed. It has search, status/owner/project/due/priority filters, sorting, a dense list, and a board that groups by status (work still moves through Move Work Forward, never by drag). Each row shows the next step and a Move Work Forward control. Critical Focus gates it like Company Work.
- **Three-zone shell** (`src/app/App.tsx`, `src/app/ContextPanel.tsx`, `src/ui/nexus.css`):
  - **Left:** the existing rail and resizable panel, plus a seam toggle.
  - **Center:** the adaptive canvas.
  - **Right:** task context (identity, ownership, urgency, dependencies, history, authorized actions, reopen) or operational signals.
  - **Reflow:** the right zone docks and reflows the canvas only while the canvas keeps at least 600px. Below that it is a drawer, and on a phone a full-screen dialog.
  - **Signals visibility:** with nothing selected, signals show automatically only when something needs attention, and the person can pin them open or closed.
- **Executive Desk** (`src/app/ExecutiveDesk.tsx`):
  - Answers *What needs me? / What is moving without me? / Who is waiting on a decision?*
  - Shows the Decision Desk, Executive Brief and Daily Signal from the existing shared core, run on the workspace the member already loaded.
  - Options need an explicit confirmation or their inputs, then go through the normal engine dispatch.
  - "Since last briefing" is remembered on the device.
- **People & Roles** (`src/app/People.tsx`):
  - **Live:** directory with separate organization-role and work-role columns, an assignment-eligibility column, and open work per person.
  - **Requests:** approve with a chosen role.
  - **Invitations:** prepared invitations are recorded but never sent, with a copyable message. Invitations can be revoked; removing access needs confirmation.
  - **Self-service display name.**
  - **Work role preserved:** changing someone's organization role no longer resets their work role.
  - **Demo:** a clearly labeled synthetic roster with "Work as".
- **Looks:** Studio is the default: the Nexus-derived design with heavy Hanken Grotesk display type and no serif or italics. Brutalist is opt-in from Policy & data → Appearance or the sidebar footer. It uses heavy uppercase type, monospace labels, hard rules and square corners (`src/ui/brutalist.css`, scoped to `html[data-look="brutalist"]`). The choice is saved per browser. Rail icons show their name and summary instantly on hover or focus.
- **Delegation:** managers create tasks unassigned by default. The engine gains `task/reopen` (owner, approver or coordinator/manager, reason required). It is synced into the dispatch source, so it reaches live only with the next dispatch deploy. Until then, live reopen is "Undo my completion".
- **Platform admin routing:**
  - A platform admin who is also a member lands in the workspace, with a **Platform console** switch.
  - The console has **Request operational access**, which creates a pending request for the organization's owners/admins and grants nothing by itself.
- **Security candidate** `supabase/migrations/20261018020000_harden_platform_owner_invite.sql`, with the unexecuted test `supabase/tests/platform_owner_invite.sql`. It closes a gap where a platform admin could invite an additional owner into an organization that already has one.

## Verified here

- `npm test` 109/109, `npm run check:server`, `npm run test:intake:runner` 5/5, `npm run test:intake:ui` 4/4, and `npm run build` (web + extension).
- **New registry tests:**
  - lenses are views of the same records;
  - filters and search;
  - board grouping;
  - the full flow: create → assign → start → help → resolve → review → complete → unlock → reopen;
  - reopen authority.
- **In Chrome, demo mode, on localhost:**
  - three zones at 1440px with no overlap with the sidebar closed or open (measured edges);
  - the task panel docked;
  - signals column;
  - the Executive Desk approval through confirm → engine (it unlocked the dependent task);
  - reopen from the context panel;
  - the People demo roster;
  - phone layout at 390px (stacked rows, full-screen task dialog, tab bar with Tasks);
  - a notification opens its real lead;
  - no console errors.
- **Production, read-only SQL:** `admin@questroofing.com` is an active **Owner** of Quest Roofing with work role **Manager**, email confirmed, signed in 2026-10-18 01:45 UTC; the workspace is at revision 8 with 2 tasks. `team@enternovum.com` is a platform admin and **not** a member.

## Not verified (needs real sessions; I have no passwords and must not use them)

Live sign-in, People & Roles RPCs, invitation acceptance, cross-account Realtime, server refusals for non-members, and the new SQL test.

### Getting your operational access with no deploy

Production already has this flow: Policy & data → Members & access → Invite (`create_invitation`).

1. **Abraham** signs in at https://task-hq-three.vercel.app, then goes to Policy & data → Members & access.
2. He invites `team@enternovum.com` (or another address you approve) with the role he chooses, for example Member or Supervisor.
3. **You** sign in to production with that address and click **Join Quest Roofing**. Nothing is granted until you accept, and only after he invites.
4. Then run the candidate locally (`npm run dev`) and sign in as yourself.

The candidate's own path (console → *Request operational access* → Abraham approves in People & Roles) works the same way once the web app is deployed.

**Caution:** the local build signs in to the **production** Supabase project. Anything done in live mode writes real Quest Roofing records through the deployed dispatch v3. Demo mode stays on the device.

### Live check script (about 10 minutes, after you are a member)

1. You land in Quest Roofing.
   - The account chip shows **Platform console**.
   - People & Roles shows your org role and work role, plus "platform administrator (separate)".
2. Abraham creates a task assigned to you. You see it in All Tasks → My Tasks without reloading.
3. You start the task and request help. Abraham resolves it, and you complete it. Each of you sees the other's changes live.
4. Abraham's Executive Desk resolves a waiting approval through Confirm.
5. You can't change roles. The People & Roles directory is read-only for a Member.

### Rendered with a stubbed client (no network)

The live admin and non-admin People & Roles views and the console's Operational access section were mounted in the browser with synthetic fixtures. Checks:
- an org-role change keeps the work role;
- approval sends the chosen roles;
- invitations are lowercased and only recorded;
- non-admins make no admin RPC calls;
- *Request operational access* calls only `request_access`.

## Release gates (in order)

1. The steps above pass locally against production auth. This changes no schema: the UI uses only dispatch v3 operations and existing RPCs.
2. Apply `20261018020000_harden_platform_owner_invite.sql` and run `supabase/tests/platform_owner_invite.sql` on an authorized staging database. Then apply it to production with approval.
3. The existing Quest OS gates still apply before deploying the newer dispatch function. Those are the operational-attention migration plus the atomic commit RPCs, which the local dispatch source now requires (see `quest-os-backend-contract.md`). Live `task/reopen` arrives with that deploy.
4. Approval to deploy the web app (`vercel deploy --prod`).

## Known limits

- Reporting lines and temporary deactivation have no schema yet. The UI says "not configured"; removing access deletes the membership, history stays, and the person can be re-invited.
- There is no archived state. Completed is the finished-work lens.
- Live Speed to Lead receives no leads until an approved source exists.
- Calendar, calls and email remain not connected.
- Counts differ by design: the sidebar's Needs Attention counts every rule (leads included), while the All Tasks lens counts tasks only.
