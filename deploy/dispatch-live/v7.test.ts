// dispatch v7: adds `project/create` for supervisors, admins and owners. v6 (the rollback
// target) refuses it without touching stored work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v6 from './v6/logic.ts';
import * as v7 from './v7/logic.ts';
import type { Action } from './v7/core/contract.ts';

const T0 = new Date('2026-10-29T09:00:00').getTime();
const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const id = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const OWNER = id('a'), ADMIN = id('b'), SUPERVISOR = id('c'), MEMBER = id('e'), REVIEWER = id('f');
const members: v7.MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: ADMIN, role: 'admin', work_role: 'coordinator', name: 'Admin Person' },
  { user_id: SUPERVISOR, role: 'supervisor', work_role: 'field', name: 'Supervisor Person' },
  { user_id: MEMBER, role: 'member', work_role: 'manager', name: 'Member Titled Manager' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];
const create = (name: string): Action => ({ type: 'project/create', name });

test('v7 lets supervisors, admins and owners create projects; members and reviewers cannot', () => {
  const s = v7.emptyState(ORG, members, T0);
  for (const who of [OWNER, ADMIN, SUPERVISOR]) {
    const r = v7.runAction(s, ORG, members, who, create('Smith Residence'), T0 + 1);
    assert.equal(r.ok, true, who);
    if (r.ok) assert.ok(r.state.projects.some(p => p.name === 'Smith Residence'));
  }
  for (const who of [MEMBER, REVIEWER]) assert.equal(v7.runAction(s, ORG, members, who, create('Smith Residence'), T0 + 1).ok, false, who);
});

test('v7 refuses blank and duplicate project names, and new projects take tasks', () => {
  let s = v7.emptyState(ORG, members, T0);
  assert.equal(v7.runAction(s, ORG, members, OWNER, create('   '), T0).ok, false);
  const r = v7.runAction(s, ORG, members, OWNER, create('Smith Residence'), T0);
  assert.ok(r.ok);
  s = r.state;
  assert.equal(v7.runAction(s, ORG, members, OWNER, create('smith residence'), T0 + 1).ok, false);
  const project = s.projects.find(p => p.name === 'Smith Residence')!;
  const t = v7.runAction(s, ORG, members, MEMBER, { type: 'task/create', task: { title: 'Measure the roof', projectId: project.id, owner: MEMBER } } as Action, T0 + 2);
  assert.ok(t.ok);
  if (t.ok) assert.equal(t.state.tasks.find(task => task.title === 'Measure the roof')?.projectId, project.id);
});

test('the v6 rollback refuses project/create and leaves projects untouched', () => {
  const s = v6.emptyState(ORG, members, T0);
  const r = v6.runAction(s, ORG, members, OWNER, create('Smith Residence') as never, T0);
  assert.equal(r.ok, false);
  assert.deepEqual(s.projects.map(p => p.name), ['General']);
});

test('v7 core is the current engine, byte for byte', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('./v7/core/', import.meta.url);
  for (const file of readdirSync(dir)) assert.equal(readFileSync(new URL(file, dir), 'utf8'), readFileSync(new URL(`../../src/core/${file}`, import.meta.url), 'utf8'), `${file} drifted; copy src/core/${file} into deploy/dispatch-live/v7/core`);
});
