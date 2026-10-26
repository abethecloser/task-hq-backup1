// Action clarity: who acts now, creation by role, and dashboard counters that match their filtered lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { homeMetrics } from './dashboard.ts';
import { apply } from './engine.ts';
import { DEFAULT_QUERY, queryTasks } from './registry.ts';
import { responsibility } from './responsibility.ts';
import { seedState } from './seed.ts';

const NOW = new Date('2026-10-17T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action) => apply(state, action, { actor, now: NOW, newId: () => `r${++n}`, writer: 'test' });
const must = (state: QuestState, actor: string, action: Action) => { const r = run(state, actor, action); if (!r.ok) throw new Error(`${action.type}: ${r.error}`); return r.state; };
const get = (state: QuestState, id: string) => state.tasks.find(item => item.id === id)!;

test('responsibility follows the existing lifecycle fields', () => {
  const state = seedState(NOW);
  const base = { id: 'x', owner: 'riley', approver: 'maya', nextOwner: 'sam', nextAction: '', blocker: null, dependsOn: [] as string[] };
  const ready = responsibility(state, { ...base, status: 'ready' });
  assert.equal(ready.actor, 'riley');
  assert.equal(ready.handoff.id, 'sam');
  assert.equal(ready.approval?.id, 'maya');
  assert.equal(responsibility(state, { ...base, status: 'working', nextAction: 'Call the client' }).action, 'Call the client');
  const review = responsibility(state, { ...base, status: 'review' });
  assert.equal(review.actor, 'maya');
  assert.equal(review.tone, 'act');
  assert.equal(responsibility(state, { ...base, status: 'blocked', blocker: { note: 'Need keys', helper: 'sam', at: NOW } as never }).actor, 'sam');
  assert.equal(responsibility(state, { ...base, owner: '', status: 'ready' }).tone, 'stop');
  assert.equal(responsibility(state, { ...base, status: 'done' }).tone, 'done');
  assert.equal(responsibility(state, { ...base, approver: '', nextOwner: '', status: 'ready' }).approval, null);
});

test('a task waiting on a dependency points at the dependency owner', () => {
  const state = seedState(NOW);
  const first = must(state, 'maya', { type: 'task/create', task: { title: 'Measure roof', owner: 'sam' } });
  const firstId = first.events[0]!.taskId!;
  const second = must(first, 'maya', { type: 'task/create', task: { title: 'Order flashing', owner: 'riley', dependsOn: [firstId] } });
  const waiting = get(second, second.events[0]!.taskId!);
  const view = responsibility(second, waiting);
  assert.equal(view.tone, 'wait');
  assert.equal(view.actor, 'sam');
});

test('creation persists the composer fields and the dry run matches the real create', () => {
  const state = seedState(NOW);
  const input = { title: 'Inspect Elm St', owner: 'riley', priority: 'high' as const, due: '2026-10-23', nextOwner: 'sam', approver: 'maya' };
  for (const actor of ['maya', 'jordan']) {
    const dry = run(state, actor, { type: 'task/create', task: input });
    assert.equal(dry.ok, true, `${actor} dry run`);
    const made = must(state, actor, { type: 'task/create', task: input });
    const task = get(made, made.events[0]!.taskId!);
    assert.equal(task.title, 'Inspect Elm St');
    assert.equal(task.owner, 'riley');
    assert.equal(task.priority, 'high');
    assert.equal(task.due, '2026-10-23');
    assert.equal(task.nextOwner, 'sam');
    assert.equal(task.status, 'ready');
    assert.equal(made.tasks.length, state.tasks.length + 1, 'exactly one task is added');
  }
});

test('a dry run never changes the state it is given', () => {
  const state = seedState(NOW);
  const before = JSON.stringify(state);
  run(state, 'maya', { type: 'task/create', task: { title: 'Preview only' } });
  assert.equal(JSON.stringify(state), before);
});

test('an unknown actor is refused creation', () => {
  assert.equal(run(seedState(NOW), 'nobody', { type: 'task/create', task: { title: 'Nope' } }).ok, false);
});

test('Active, Overdue and Blocked cards equal the size of the lists they open', () => {
  const state = seedState(NOW);
  for (const person of state.people) {
    const metrics = homeMetrics(state, person.id, NOW);
    const size = (extra: Partial<typeof DEFAULT_QUERY>) => queryTasks(state, person.id, NOW, { ...DEFAULT_QUERY, scope: 'mine', ...extra }).length;
    assert.equal(metrics.blocked, size({ status: 'blocked' }), `${person.id} blocked`);
    assert.equal(metrics.overdue, size({ lens: 'overdue' } as never), `${person.id} overdue`);
  }
});
