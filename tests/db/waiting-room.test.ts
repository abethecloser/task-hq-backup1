import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_BASELINE, addMember, addOrg, addUser, createDb, read, rpcAs } from './pg.ts';

// The navigation migration allow-lists a real production account, so that account exists first.
const ALLOWLISTED = 'f1cd1413-e5ee-424f-91b0-3fb109247e99';
const AFTER = ['20261019140000_temporary_restricted_navigation.sql', '20261019160000_owner_people_access.sql', '20261019230000_waiting_room.sql'];

async function setup() {
  const db = await createDb([...PRODUCTION_BASELINE, '20261018030000_team_staging.sql']);
  await db.pg.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'allowlisted@test.invalid', now())`, [ALLOWLISTED]);
  for (const file of AFTER) await db.pg.exec(read(`supabase/migrations/${file}`));
  const org = await addOrg(db, 'quest-test', 'Quest Test');
  const owner = await addUser(db, 'owner@test.invalid', 'Owner');
  const admin = await addUser(db, 'admin@test.invalid', 'Admin');
  const member = await addUser(db, 'member@test.invalid', 'Member');
  const newcomer = await addUser(db, 'new@test.invalid', 'Newcomer');
  const second = await addUser(db, 'second@test.invalid', 'Second');
  await addMember(db, org, owner, 'owner', 'manager');
  await addMember(db, org, admin, 'admin', 'manager');
  await addMember(db, org, member, 'member', 'field');
  // The admin works with full navigation (People & Access open), as Alexia does.
  await db.pg.query('insert into private.full_navigation_users (user_id) values ($1)', [admin]);
  return { db, org, owner, admin, member, newcomer, second };
}

test('anyone without a workspace waits in one queue; an admin places them in one step', async () => {
  const { db, org, admin, newcomer, second } = await setup();
  const joined = await rpcAs(db, newcomer, 'join_waiting_room', { p_message: '' });
  assert.equal(joined.error, null, joined.error?.message);
  assert.equal((joined.data as { position: number }).position, 1);
  // Joining again doesn't duplicate; a note updates the same entry.
  await rpcAs(db, newcomer, 'join_waiting_room', { p_message: 'Developer for Quest' });
  const ctx = (await rpcAs(db, newcomer, 'my_context', {})).data as { waiting: { position: number; message: string } };
  assert.deepEqual([ctx.waiting.position, ctx.waiting.message], [1, 'Developer for Quest']);
  // An unknown workspace name lands in the waiting room with a clear answer.
  const asked = await rpcAs(db, second, 'request_access', { p_workspace: 'Nope Inc', p_message: 'Hi' });
  assert.match(String(asked.data), /waiting room/);
  assert.equal(((await rpcAs(db, second, 'my_context', {})).data as { waiting: { position: number } }).waiting.position, 2);

  const overview = (await rpcAs(db, admin, 'org_admin_overview', { p_org: org })).data as { requests: { id: string; email: string; waiting: boolean }[] };
  const entry = overview.requests.find(item => item.email === 'new@test.invalid')!;
  assert.equal(entry.waiting, true);
  const placed = await rpcAs(db, admin, 'decide_access_request', { p_request: entry.id, p_approve: true, p_role: 'reviewer', p_work_role: 'field', p_org: org });
  assert.equal(placed.error, null, placed.error?.message);
  const membership = (await db.pg.query<{ role: string; work_role: string }>('select role, work_role from public.memberships where org_id = $1 and user_id = $2', [org, newcomer])).rows[0];
  assert.deepEqual(membership, { role: 'reviewer', work_role: 'reviewer' });
  const after = (await rpcAs(db, newcomer, 'my_context', {})).data as { waiting: unknown; memberships: unknown[] };
  assert.equal(after.waiting, null);
  assert.equal(after.memberships.length, 1);
});

test('the guardrails still hold: owner-only elevation, admins only, declines are respected', async () => {
  const { db, org, owner, admin, member, newcomer } = await setup();
  const joined = (await rpcAs(db, newcomer, 'join_waiting_room', { p_message: '' })).data as { id: string };
  // An Admin can't grant Admin; a Member can't place anyone; the Owner can.
  assert.match((await rpcAs(db, admin, 'decide_access_request', { p_request: joined.id, p_approve: true, p_role: 'admin', p_work_role: 'manager', p_org: org })).error?.message ?? '', /Only an owner/);
  assert.ok((await rpcAs(db, member, 'decide_access_request', { p_request: joined.id, p_approve: true, p_role: 'member', p_work_role: 'field', p_org: org })).error);
  // A waiting-room entry needs a workspace to land in.
  assert.match((await rpcAs(db, owner, 'decide_access_request', { p_request: joined.id, p_approve: true, p_role: 'member', p_work_role: 'field' })).error?.message ?? '', /Choose the workspace/);
  // Declined: the person isn't silently re-added; asking again with a note works.
  assert.equal((await rpcAs(db, admin, 'decide_access_request', { p_request: joined.id, p_approve: false, p_role: 'member', p_work_role: 'field', p_org: org })).error, null);
  assert.deepEqual((await rpcAs(db, newcomer, 'join_waiting_room', { p_message: '' })).data, { declined: true });
  assert.equal(((await rpcAs(db, newcomer, 'my_context', {})).data as { waiting_declined: boolean }).waiting_declined, true);
  assert.equal(((await rpcAs(db, newcomer, 'join_waiting_room', { p_message: 'Sorry, I’m Shan, the developer' })).data as { position: number }).position, 1);
  // Nobody signed out can join, and the waiting room can't be read without being an admin.
  assert.ok((await rpcAs(db, member, 'org_admin_overview', { p_org: org })).error);
});

test('a named request to a real workspace still works and says where it went', async () => {
  const { db, org, admin, newcomer } = await setup();
  assert.equal((await rpcAs(db, newcomer, 'request_access', { p_workspace: 'quest-test', p_message: '' })).data, 'Request sent to Quest Test’s owners and admins.');
  const overview = (await rpcAs(db, admin, 'org_admin_overview', { p_org: org })).data as { requests: { id: string; waiting: boolean }[] };
  assert.equal(overview.requests.length, 1);
  assert.equal(overview.requests[0]!.waiting, false);
  assert.equal((await rpcAs(db, admin, 'decide_access_request', { p_request: overview.requests[0]!.id, p_approve: true, p_role: 'member', p_work_role: 'field' })).error, null);
});
