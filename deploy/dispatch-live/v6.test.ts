// dispatch v6 (completion state): completion records who finished, archive is allowed only
// to the people who may reopen, and v5 (the rollback target) refuses the new actions
// without touching stored work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v5 from './v5/logic.ts';
import * as v6 from './v6/logic.ts';
import type { Action } from './v6/core/contract.ts';

const T0 = new Date('2026-10-20T09:00:00').getTime();
const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const id = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const OWNER = id('a'), MEMBER = id('e'), OTHER = id('d'), REVIEWER = id('f');
const members: v6.MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: OTHER, role: 'member', work_role: 'field', name: 'Other Member' },
  { user_id: MEMBER, role: 'member', work_role: 'field', name: 'Crew Member' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];
const ok = (r: v6.RunResult) => { if (!r.ok) throw new Error(r.error); return r.state; };

function completed() {
  let s = v6.emptyState(ORG, members, T0);
  s = ok(v6.runAction(s, ORG, members, OWNER, { type: 'task/create', task: { title: 'Finish flashing', owner: MEMBER } } as Action, T0));
  const taskId = s.tasks.find(t => t.title === 'Finish flashing')!.id;
  for (let i = 0; i < 4 && s.tasks.find(t => t.id === taskId)!.status !== 'done'; i++) s = ok(v6.runAction(s, ORG, members, MEMBER, { type: 'task/advance', id: taskId }, T0 + 1000 + i));
  return { s, taskId };
}

test('v6 records who completed, and archive/restore persist through the stored state', () => {
  const { s, taskId } = completed();
  const done = s.tasks.find(t => t.id === taskId)!;
  assert.equal(done.status, 'done');
  assert.equal(done.completedBy, MEMBER);
  const archived = ok(v6.runAction(s, ORG, members, MEMBER, { type: 'task/archive', id: taskId }, T0 + 5000));
  assert.equal(archived.tasks.find(t => t.id === taskId)!.archivedBy, MEMBER);
  const reloaded = JSON.parse(JSON.stringify(archived)) as typeof archived;
  assert.equal(reloaded.tasks.find(t => t.id === taskId)!.archivedAt, T0 + 5000);
  const restored = ok(v6.runAction(archived, ORG, members, OWNER, { type: 'task/unarchive', id: taskId }, T0 + 7000));
  assert.equal(restored.tasks.find(t => t.id === taskId)!.archivedAt, null);
});

test('v6 refuses archive from unrelated members and reviewers', () => {
  const { s, taskId } = completed();
  for (const who of [OTHER, REVIEWER]) assert.equal(v6.runAction(s, ORG, members, who, { type: 'task/archive', id: taskId }, T0 + 5000).ok, false, who);
});

test('the v5 rollback refuses archive and leaves the work untouched', () => {
  const { s, taskId } = completed();
  const refused = v5.runAction(s, ORG, members, MEMBER, { type: 'task/archive', id: taskId } as Action, T0 + 5000);
  assert.equal(refused.ok, false);
  assert.equal(s.tasks.find(t => t.id === taskId)!.archivedAt ?? null, null);
});

// v6 is frozen as the rollback target for v7; v7.test.ts checks the current engine.
test('v6 clears due fields across JSON reload without leaving an orphaned time', () => {
  let s = v6.emptyState(ORG, members, T0);
  s = ok(v6.runAction(s, ORG, members, OWNER, { type: 'task/create', task: { title: 'Inspect flashing', owner: MEMBER, due: '2026-10-28', dueTime: '09:00' } }, T0));
  const taskId = s.tasks.find(t => t.title === 'Inspect flashing')!.id;
  const clearTime = JSON.parse(JSON.stringify({ type: 'task/update', id: taskId, changes: { dueTime: '' } })) as Action;
  s = ok(v6.runAction(s, ORG, members, MEMBER, clearTime, T0 + 1000));
  s = JSON.parse(JSON.stringify(s));
  assert.equal(s.tasks.find(t => t.id === taskId)?.dueTime, undefined);
  assert.equal(s.tasks.find(t => t.id === taskId)?.due, '2026-10-28');
  s = ok(v6.runAction(s, ORG, members, MEMBER, { type: 'task/update', id: taskId, changes: { dueTime: '10:30' } }, T0 + 2000));
  s = ok(v6.runAction(s, ORG, members, MEMBER, { type: 'task/update', id: taskId, changes: { due: '' } }, T0 + 3000));
  s = JSON.parse(JSON.stringify(s));
  assert.equal(s.tasks.find(t => t.id === taskId)?.due, '');
  assert.equal(s.tasks.find(t => t.id === taskId)?.dueTime, undefined);
});

test('JSON-safe clearing payloads work against frozen v5 without widening its capabilities', () => {
  let s = v5.emptyState(ORG, members, T0);
  s = ok(v5.runAction(s, ORG, members, OWNER, { type: 'task/create', task: { title: 'Inspect flashing', owner: MEMBER, due: '2026-10-28', dueTime: '09:00' } }, T0));
  const taskId = s.tasks.find(t => t.title === 'Inspect flashing')!.id;
  for (const changes of [{ dueTime: '' }, { due: '', dueTime: '' }]) {
    const action = JSON.parse(JSON.stringify({ type: 'task/update', id: taskId, changes })) as Action;
    s = ok(v5.runAction(s, ORG, members, MEMBER, action, T0 + 1000));
    assert.equal(s.tasks.find(t => t.id === taskId)?.dueTime, undefined);
  }
  assert.equal(s.tasks.find(t => t.id === taskId)?.due, '');
});
