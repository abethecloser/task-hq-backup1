import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, reconcileStored, runAction, withAuthority } from './logic.ts';
import type { MemberRow, OrgRow } from './logic.ts';

const T0 = new Date('2026-10-18T09:00:00').getTime();
const ORG: OrgRow = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REVIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const members: MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: MEMBER, role: 'member', work_role: 'field', name: 'Crew Person' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];

test('a live workspace starts empty with people from real memberships only', () => {
  const state = emptyState(ORG, members, T0);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.leads.length, 0);
  assert.deepEqual(state.people.map(p => [p.id, p.role]), [[OWNER, 'manager'], [MEMBER, 'field'], [REVIEWER, 'reviewer']]);
  assert.equal(state.workspace.tenantId, ORG.id);
  assert.ok(!state.people.some(p => p.id === 'abraham' || p.id === 'jordan'), 'no synthetic personas');
});

test('real task flow: owner creates and assigns, member starts and completes', () => {
  let state = emptyState(ORG, members, T0);
  const created = runAction(state, ORG, members, OWNER, { type: 'task/create', task: { title: 'Inspect the Harlan St roof', owner: MEMBER } }, T0);
  assert.ok(created.ok);
  state = created.ok ? created.state : state;
  const id = state.tasks[0]!.id;
  const started = runAction(state, ORG, members, MEMBER, { type: 'task/advance', id }, T0 + 1000);
  assert.ok(started.ok); state = started.ok ? started.state : state;
  const done = runAction(state, ORG, members, MEMBER, { type: 'task/advance', id }, T0 + 2000);
  assert.ok(done.ok); state = done.ok ? done.state : state;
  assert.equal(state.tasks[0]!.status, 'done');
});

test('authority: outsiders, reviewers, demo actions and self-promotion are refused', () => {
  const state = emptyState(ORG, members, T0);
  const outsider = runAction(state, ORG, members, OUTSIDER, { type: 'task/create', task: { title: 'x' } }, T0);
  assert.equal(outsider.ok, false);
  const reviewer = runAction(state, ORG, members, REVIEWER, { type: 'task/create', task: { title: 'x' } }, T0);
  assert.equal(reviewer.ok, false);
  const reset = runAction(state, ORG, members, OWNER, { type: 'demo/reset' }, T0);
  assert.ok(!reset.ok && reset.status === 403);
  const fakeLead = runAction(state, ORG, members, OWNER, { type: 'lead/receive', lead: { name: 'x', source: 'x', phone: 'x', address: 'x', need: 'x' } }, T0);
  assert.equal(fakeLead.ok, false);
  // A tampered stored state that lists the outsider as a manager is overridden by memberships.
  const tampered = { ...state, people: [...state.people, { id: OUTSIDER, name: 'Intruder', role: 'manager' as const, title: 'Owner' }] };
  assert.ok(!withAuthority(tampered, ORG, members).people.some(p => p.id === OUTSIDER));
  assert.equal(runAction(tampered, ORG, members, OUTSIDER, { type: 'task/create', task: { title: 'x' } }, T0).ok, false);
  // Member (field role) cannot activate Ultra Priority; the owner (manager) can.
  const withTask = runAction(state, ORG, members, OWNER, { type: 'task/create', task: { title: 'Critical', owner: MEMBER } }, T0);
  assert.ok(withTask.ok);
  const s2 = withTask.ok ? withTask.state : state;
  assert.equal(runAction(s2, ORG, members, MEMBER, { type: 'ultra/activate', taskId: s2.tasks[0]!.id }, T0).ok, false);
  assert.equal(runAction(s2, ORG, members, OWNER, { type: 'ultra/activate', taskId: s2.tasks[0]!.id }, T0).ok, true);
});

test('server tick expires temporary access and leaves untouched state alone', () => {
  const base = emptyState(ORG, members, T0);
  assert.equal(reconcileStored(base, ORG, members, T0 + 60_000), null);
  const withGrant = { ...base, grants: [{ id: 'g1', requester: MEMBER, section: 'company' as const, reason: 'check schedule', status: 'approved' as const, requestedAt: T0, expiresAt: T0 + 30_000 }] };
  const next = reconcileStored(withGrant as typeof base, ORG, members, T0 + 31_000);
  assert.ok(next);
  assert.equal(next!.grants[0]!.status, 'expired');
  assert.ok(next!.events[0]!.id.startsWith('expire-'));
});

test('authority comes from organization role, never from the work role title', () => {
  const MGR_TITLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const ADMIN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const SUPERVISOR = '99999999-9999-4999-8999-999999999999';
  const team: MemberRow[] = [...members,
    { user_id: MGR_TITLE, role: 'member', work_role: 'manager', name: 'Member With Manager Title' },
    { user_id: ADMIN, role: 'admin', work_role: 'field', name: 'Field Admin' },
    { user_id: SUPERVISOR, role: 'supervisor', work_role: 'field', name: 'Field Supervisor' }];
  const run = (state: ReturnType<typeof emptyState>, actor: string, action: Parameters<typeof runAction>[4]) => runAction(state, ORG, team, actor, action, T0);
  const created = run(emptyState(ORG, team, T0), OWNER, { type: 'task/create', task: { title: 'Owner work', owner: OWNER } });
  assert.ok(created.ok);
  const state = created.ok ? created.state : emptyState(ORG, team, T0);
  const ownerTask = state.tasks[0]!.id;

  // A Manager work title on a Member grants nothing.
  assert.equal(run(state, MGR_TITLE, { type: 'policy/update', changes: { stalledHours: 12 } }).ok, false);
  assert.equal(run(state, MGR_TITLE, { type: 'task/update', id: ownerTask, changes: { owner: MGR_TITLE } }).ok, false);
  assert.equal(run(state, MGR_TITLE, { type: 'task/create', task: { title: 'For someone else', owner: MEMBER } }).ok, false);
  assert.equal(run(state, MGR_TITLE, { type: 'ultra/activate', taskId: ownerTask }).ok, false);
  // Members still create and run their own work, and comment anywhere.
  assert.equal(run(state, MEMBER, { type: 'task/create', task: { title: 'Mine', owner: MEMBER } }).ok, true);
  const comment = run(state, MEMBER, { type: 'task/comment', id: ownerTask, note: ' @Owner can you check? ' });
  assert.ok(comment.ok);
  assert.equal(comment.ok && comment.state.events[0]!.actionType, 'task/comment');
  assert.equal(run(state, REVIEWER, { type: 'task/comment', id: ownerTask, note: 'hi' }).ok, false);

  // Supervisor coordinates (assign, reassign) but does not set policy.
  assert.equal(run(state, SUPERVISOR, { type: 'task/create', task: { title: 'Crew task', owner: MEMBER } }).ok, true);
  assert.equal(run(state, SUPERVISOR, { type: 'task/update', id: ownerTask, changes: { owner: MEMBER } }).ok, true);
  assert.equal(run(state, SUPERVISOR, { type: 'policy/update', changes: { stalledHours: 12 } }).ok, false);

  // Admin runs routine operations; Ultra authority and workspace identity stay with the Owner.
  assert.equal(run(state, ADMIN, { type: 'policy/update', changes: { ...state.policy, stalledHours: 12 } }).ok, true);
  assert.equal(run(state, ADMIN, { type: 'policy/update', changes: { ...state.policy, ultraActivators: ['manager', 'coordinator'] } }).ok, false);
  assert.equal(run(state, ADMIN, { type: 'workspace/update', changes: { name: 'Renamed' } }).ok, false);
  assert.equal(run(state, OWNER, { type: 'workspace/update', changes: { name: 'Renamed' } }).ok, true);

  // Stored state can't forge authority.
  const forged = { ...state, people: state.people.map(p => (p.id === MEMBER ? { ...p, authority: 'owner' as const } : p)) };
  assert.equal(withAuthority(forged, ORG, team).people.find(p => p.id === MEMBER)!.authority, 'member');
});
