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
