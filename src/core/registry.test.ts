import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { DEFAULT_QUERY, boardColumns, lensCounts, queryTasks } from './registry.ts';
import type { RegistryQuery } from './registry.ts';
import { seedState } from './seed.ts';
import { blockingDeps, taskById } from './selectors.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const q = (changes: Partial<RegistryQuery>): RegistryQuery => ({ ...DEFAULT_QUERY, ...changes });
const ids = (state: QuestState, actor: string, query: RegistryQuery) => queryTasks(state, actor, T0, query).map(task => task.id);

function run(state: QuestState, actor: string, action: Action, n = { v: 0 }) {
  const result = apply(state, action, { actor, now: T0, newId: () => `t${++n.v}`, writer: 'test' });
  if (!result.ok) throw new Error(`${action.type} by ${actor}: ${result.error}`);
  return result.state;
}

test('lenses are views of the same records, never copies', () => {
  const state = seedState(T0);
  const all = ids(state, 'jordan', q({ lens: 'all' }));
  for (const lens of ['mine', 'team', 'attention'] as const) {
    for (const id of ids(state, 'jordan', q({ lens }))) assert.ok(all.includes(id), `${lens} returned ${id} that All Tasks doesn't have`);
  }
  assert.ok(!all.includes('site-plan'), 'All Tasks shows open work by default');
  assert.deepEqual(ids(state, 'jordan', q({ lens: 'completed' })), ['site-plan']);
  assert.ok(ids(state, 'jordan', q({ lens: 'all', status: 'any' })).includes('site-plan'), 'status "any" brings finished work back');
});

test('My Tasks includes approvals waiting on me; Team Tasks is work moving without me', () => {
  const state = seedState(T0);
  assert.deepEqual(ids(state, 'jordan', q({ lens: 'mine' })), ['maple-estimate']);
  const team = ids(state, 'jordan', q({ lens: 'team' }));
  assert.ok(team.includes('staging-area') && team.includes('maple-tarp'));
  assert.ok(!team.includes('shingle-order'), 'unowned work belongs to nobody, not the team');
});

test('Needs Attention lens uses the shared attention rules', () => {
  const attention = ids(seedState(T0), 'jordan', q({ lens: 'attention' }));
  for (const id of ['permit-update', 'maple-tarp', 'shingle-order']) assert.ok(attention.includes(id), `${id} should need attention`);
  assert.ok(!attention.includes('safety-brief'));
});

test('search, owner, project, due and priority filters compose', () => {
  const state = seedState(T0);
  assert.deepEqual(ids(state, 'alex', q({ search: 'permit office' })), ['permit-update'], 'searches waiting-on text');
  assert.deepEqual(ids(state, 'alex', q({ search: 'riley' })), ['maple-estimate'], 'searches owner names');
  assert.deepEqual(ids(state, 'alex', q({ owner: 'none' })), ['shingle-order']);
  assert.deepEqual(ids(state, 'alex', q({ due: 'overdue' })), ['maple-tarp']);
  assert.ok(ids(state, 'alex', q({ project: 'maple', priority: 'high' })).every(id => ['maple-tarp'].includes(id)));
  assert.deepEqual(ids(state, 'alex', q({ status: 'blocked' })), ['permit-update']);
});

test('sorting by name and urgency is deterministic; board groups without changing status', () => {
  const state = seedState(T0);
  const byName = queryTasks(state, 'alex', T0, q({ sort: 'title' })).map(task => task.title);
  assert.deepEqual(byName, [...byName].sort((a, b) => a.localeCompare(b)));
  const tasks = queryTasks(state, 'alex', T0, q({ status: 'any' }));
  const board = boardColumns(tasks);
  assert.equal(board.reduce((sum, column) => sum + column.tasks.length, 0), tasks.length);
  assert.ok(board.every(column => column.tasks.every(task => task.status === column.status)));
});

test('lens counts match the lens contents', () => {
  const state = seedState(T0);
  const counts = lensCounts(state, 'jordan', T0);
  assert.equal(counts.all, ids(state, 'jordan', q({ lens: 'all' })).length);
  assert.equal(counts.mine, 1);
  assert.equal(counts.completed, 1);
});

test('full execution flow: create → assign → start → help → resolve → review → complete → unlock → reopen', () => {
  const n = { v: 0 };
  let state = seedState(T0);
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Measure the garage roof', owner: '', approver: 'jordan' } }, n);
  const id = state.tasks[0]!.id;
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Price the garage roof', owner: 'riley', dependsOn: [id] } }, n);
  const next = state.tasks[0]!.id;
  assert.ok(ids(state, 'jordan', q({ owner: 'none' })).includes(id), 'new unowned work shows as unowned');
  assert.ok(!ids(state, 'jordan', q({ lens: 'mine' })).includes(id), 'creating work does not make the manager its owner');

  state = run(state, 'jordan', { type: 'task/update', id, changes: { owner: 'alex' } }, n);
  assert.ok(ids(state, 'alex', q({ lens: 'mine' })).includes(id), 'assigned work reaches the owner');
  state = run(state, 'alex', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'working');
  state = run(state, 'alex', { type: 'task/request-help', id, note: 'Need the ladder key', helper: 'maya' }, n);
  assert.ok(ids(state, 'jordan', q({ lens: 'attention' })).includes(id), 'blocked work needs attention');
  state = run(state, 'maya', { type: 'task/resolve', id, note: 'Key is in the truck' }, n);
  state = run(state, 'alex', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'review');
  assert.ok(ids(state, 'jordan', q({ lens: 'mine' })).includes(id), 'the approver sees the review in My Tasks');
  assert.equal(blockingDeps(state, taskById(state, next)!).length, 1);
  state = run(state, 'jordan', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'done');
  assert.equal(blockingDeps(state, taskById(state, next)!).length, 0, 'completion unlocks dependent work');
  assert.ok(ids(state, 'alex', q({ lens: 'completed' })).includes(id));

  const refused = apply(state, { type: 'task/reopen', id, note: 'Wrong roof' }, { actor: 'sam', now: T0, writer: 'test' });
  assert.equal(refused.ok, false, 'an uninvolved teammate cannot reopen');
  assert.equal(apply(state, { type: 'task/reopen', id, note: ' ' }, { actor: 'alex', now: T0, writer: 'test' }).ok, false, 'reopening needs a reason');
  state = run(state, 'alex', { type: 'task/reopen', id, note: 'Measured the wrong slope' }, n);
  const reopened = taskById(state, id)!;
  assert.equal(reopened.status, 'ready');
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.nextAction, 'Measured the wrong slope');
  assert.ok(ids(state, 'alex', q({ lens: 'mine' })).includes(id));
});

test('reviewers cannot reopen work', () => {
  let state = seedState(T0);
  const result = apply(state, { type: 'task/reopen', id: 'site-plan', note: 'x' }, { actor: 'abraham', now: T0, writer: 'test' });
  assert.equal(result.ok, false);
  state = run(state, 'jordan', { type: 'task/reopen', id: 'site-plan', note: 'Layout changed' });
  assert.equal(taskById(state, 'site-plan')!.status, 'ready');
});
