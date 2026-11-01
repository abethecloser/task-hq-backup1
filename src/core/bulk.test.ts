import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { bulkPlan, bulkSummary } from './bulk.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-11-01T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action) => {
  const r = apply(state, action, { actor, now: T0, newId: () => `b${++n}`, writer: 'test' });
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`);
  return r.state;
};
/** Applies a plan the way the bulk bar does: one engine action per task. */
const runPlan = (state: QuestState, actor: string, actions: { action: Action }[]) => actions.reduce((s, item) => run(s, actor, item.action), state);

test('bulk archive: completed work archives normally, unfinished work as legacy with its status kept', () => {
  let s = seedState(T0);
  s = run(s, 'jordan', { type: 'task/advance', id: 'maple-estimate' }); // review → done
  const plan = bulkPlan(s, 'jordan', ['maple-estimate', 'staging-area'], { kind: 'archive' });
  assert.deepEqual(plan.actions.map(item => item.action), [
    { type: 'task/archive', id: 'maple-estimate' },
    { type: 'task/archive', id: 'staging-area', reason: 'legacy' },
  ]);
  const before = s.tasks.find(task => task.id === 'staging-area')!.status;
  const after = runPlan(s, 'jordan', plan.actions);
  assert.equal(after.tasks.find(task => task.id === 'staging-area')!.status, before, 'not marked done');
  assert.equal(after.tasks.find(task => task.id === 'maple-estimate')!.status, 'done');
  assert.ok(after.tasks.filter(task => ['maple-estimate', 'staging-area'].includes(task.id)).every(task => task.archivedAt));
  // Restore brings both back as they were.
  const restored = runPlan(after, 'jordan', bulkPlan(after, 'jordan', ['maple-estimate', 'staging-area'], { kind: 'restore' }).actions);
  assert.equal(restored.tasks.find(task => task.id === 'staging-area')!.status, before);
  assert.ok(restored.tasks.every(task => !task.archivedAt));
});

test('bulk actions skip what this person may not do, with a reason, and never send it', () => {
  const s = seedState(T0);
  // Alex is a field lead, not a coordinator, so archiving unfinished work is refused.
  const plan = bulkPlan(s, 'alex', ['staging-area', 'missing-id'], { kind: 'archive' });
  assert.equal(plan.actions.length, 0);
  assert.match(plan.skipped[0]!.reason, /supervisor, admin or owner/);
  assert.equal(bulkSummary('Archived', 0, plan.skipped), 'Nothing changed. 1 not changed: “Confirm the material staging area” (only a supervisor, admin or owner archives unfinished work).');
});

test('bulk assign, priority and project move become ordinary task updates the engine accepts', () => {
  let s = seedState(T0);
  const ids = s.tasks.filter(task => task.status !== 'done').slice(0, 3).map(task => task.id);
  for (const request of [{ kind: 'priority', priority: 'high' }, { kind: 'assign', owner: 'maya' }, { kind: 'project', projectId: '' }] as const) {
    const plan = bulkPlan(s, 'jordan', ids, request);
    s = runPlan(s, 'jordan', plan.actions);
  }
  for (const id of ids) {
    const task = s.tasks.find(item => item.id === id)!;
    assert.equal(task.priority, 'high'); assert.equal(task.owner, 'maya'); assert.equal(task.projectId, '');
  }
  assert.ok(bulkPlan(s, 'jordan', ids, { kind: 'priority', priority: 'high' }).skipped.every(item => item.reason === 'already that priority'));
});

test('bulk edits leave archived tasks alone and never move work into an archived project', () => {
  let s = seedState(T0);
  s = run(s, 'jordan', { type: 'project/create', name: 'Old job' });
  const old = s.projects.find(p => p.name === 'Old job')!;
  s = run(s, 'jordan', { type: 'project/archive', id: old.id });
  const plan = bulkPlan(s, 'jordan', ['staging-area'], { kind: 'project', projectId: old.id });
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.skipped[0]!.reason, 'that project is archived');
  s = run(s, 'jordan', { type: 'task/archive', id: 'staging-area', reason: 'legacy' });
  assert.equal(bulkPlan(s, 'jordan', ['staging-area'], { kind: 'priority', priority: 'high' }).skipped[0]!.reason, 'archived; restore it first');
});
