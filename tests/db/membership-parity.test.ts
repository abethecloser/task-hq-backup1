// Authority parity for People & Roles: for every organization role, every action the
// screen can offer is asked of the real SQL function. The UI predicates are the same
// functions People.tsx imports (src/app/authority.ts). A UI offer the server refuses
// fails the test; UI-stricter cases must match the documented list exactly.
// PGlite + stubbed Supabase auth, this project's real (non-broad) default grants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageMember, grantableRoles, inviteEligible, isOrgAdmin, plannedRolesFor } from '../../src/app/authority.ts';
import type { OrgRole } from '../../src/app/LiveContext.tsx';
import { PRODUCTION_BASELINE, addMember, addOrg, addUser, createDb, rpcAs } from './pg.ts';
import type { Db } from './pg.ts';

const ROLES: OrgRole[] = ['owner', 'admin', 'supervisor', 'member', 'reviewer'];
const work = (role: OrgRole) => (role === 'reviewer' ? 'reviewer' : role === 'owner' || role === 'admin' ? 'manager' : 'field');
let n = 0;

/** A fresh organization: the caller with `role`, a second owner (so "last owner" never decides), and optionally a target member. */
async function org(db: Db, role: OrgRole, targetRole?: OrgRole) {
  const id = await addOrg(db, `parity-${++n}`, `Parity ${n}`);
  const caller = await addUser(db, `caller-${n}@example.test`);
  const owner = await addUser(db, `owner-${n}@example.test`);
  await addMember(db, id, owner, 'owner', 'manager');
  await addMember(db, id, caller, role, work(role));
  let target = '';
  if (targetRole) { target = await addUser(db, `target-${n}@example.test`); await addMember(db, id, target, targetRole, work(targetRole)); }
  return { id, caller, target };
}

test('People & Roles: the UI never offers an action the server refuses', async () => {
  const db = await createDb([...PRODUCTION_BASELINE, '20261018030000_team_staging.sql']);
  const serverStricter: string[] = []; const uiStricter: string[] = [];
  const compare = (label: string, ui: boolean, server: { error: unknown }) => {
    const ok = !server.error;
    if (ui && !ok) serverStricter.push(`${label}: ${(server.error as { message: string }).message}`);
    if (!ui && ok) uiStricter.push(label);
  };

  for (const caller of ROLES) {
    { const o = await org(db, caller); compare(`${caller} reads member admin overview`, isOrgAdmin(caller), await rpcAs(db, o.caller, 'org_admin_overview', { p_org: o.id })); }
    for (const role of ROLES) {
      const o = await org(db, caller);
      compare(`${caller} invites ${role}`, grantableRoles(caller).includes(role), await rpcAs(db, o.caller, 'create_invitation', { p_org: o.id, p_email: `invitee-${n}@example.test`, p_role: role, p_work_role: work(role), p_days: 14 }));
    }
    for (const role of ROLES) {
      const o = await org(db, caller);
      const requester = await addUser(db, `requester-${n}@example.test`);
      const request = (await db.pg.query<{ id: string }>(`insert into public.access_requests (org_id, user_id) values ($1, $2) returning id`, [o.id, requester])).rows[0]!.id;
      compare(`${caller} approves a request as ${role}`, grantableRoles(caller).includes(role), await rpcAs(db, o.caller, 'decide_access_request', { p_request: request, p_approve: true, p_role: role, p_work_role: work(role) }));
    }
    for (const target of ROLES) {
      { const o = await org(db, caller, target); compare(`${caller} removes a ${target}`, canManageMember(caller, target, false), await rpcAs(db, o.caller, 'remove_member', { p_org: o.id, p_user: o.target })); }
      for (const next of ROLES) {
        const o = await org(db, caller, target);
        compare(`${caller} changes a ${target} to ${next}`, canManageMember(caller, target, false) && grantableRoles(caller).includes(next),
          await rpcAs(db, o.caller, 'set_member_role', { p_org: o.id, p_user: o.target, p_role: next, p_work_role: work(next) }));
      }
    }
    // Your own row is never editable on the screen.
    { const o = await org(db, caller); compare(`${caller} changes own role to member`, canManageMember(caller, caller, true), await rpcAs(db, o.caller, 'set_member_role', { p_org: o.id, p_user: o.caller, p_role: 'member', p_work_role: 'field' })); }
    { const o = await org(db, caller); compare(`${caller} removes self`, canManageMember(caller, caller, true), await rpcAs(db, o.caller, 'remove_member', { p_org: o.id, p_user: o.caller })); }
    // Staged directory.
    for (const planned of ['admin', 'supervisor', 'member', 'reviewer'] as OrgRole[]) {
      const o = await org(db, caller);
      const saved = await rpcAs(db, o.caller, 'save_staged_contact', { p_org: o.id, p_contact: null, p_full_name: `Planned ${planned}`, p_email: `staged-${n}@example.test`, p_phone: null, p_title: null, p_role: planned, p_work_role: work(planned), p_reports_to_contact: null, p_reports_to_user: null, p_notes: '' });
      compare(`${caller} stages a planned ${planned}`, plannedRolesFor(caller).includes(planned), saved);
    }
    for (const planned of ['admin', 'supervisor', 'member', 'reviewer'] as OrgRole[]) {
      const o = await org(db, caller);
      // Staged and confirmed by the owner, so only the invitation itself is under test.
      const contact = (await db.pg.query<{ id: string }>(`insert into public.staged_contacts (org_id, staging_key, full_name, email, provisional_role, provisional_work_role, affiliation_confirmed) values ($1, $2, 'Ready Person', $3, $4, $5, true) returning id`,
        [o.id, `ready-${n}`, `ready-${n}@example.test`, planned, work(planned)])).rows[0]!.id;
      compare(`${caller} prepares an invitation for a planned ${planned}`, inviteEligible({ affiliation_confirmed: true, email: 'x@example.test', state: 'not-invited', provisional_role: planned }, caller),
        await rpcAs(db, o.caller, 'invite_staged_contacts', { p_contacts: [contact], p_days: 14 }));
    }
  }
  await db.close();

  assert.deepEqual(serverStricter, [], `UI offers what the server refuses:\n${serverStricter.join('\n')}`);
  // Deliberately narrower UI. Each is harmless (it hides an action the server would allow).
  assert.deepEqual(uiStricter.sort(), [
    'admin removes self', 'admin stages a planned admin', 'member removes self', 'owner changes own role to member', 'owner removes self',
    'reviewer removes self', 'supervisor removes self',
  ].sort());
});

test('the bug this test was written to catch: an admin selecting a planned Admin for invitation', () => {
  // Before the fix, eligibility ignored the caller's role; the server refuses because only
  // an owner can invite an admin, and the all-or-nothing batch then failed for everyone.
  const plannedAdmin = { affiliation_confirmed: true, email: 'x@example.test', state: 'not-invited', provisional_role: 'admin' as OrgRole };
  assert.equal(inviteEligible(plannedAdmin, 'admin'), false);
  assert.equal(inviteEligible(plannedAdmin, 'owner'), true);
});
