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

test('lenses and scopes are views of the same records, never copies', () => {
  const state = seedState(T0);
  const all = ids(state, 'jordan', q({ lens: 'all' }));
  for (const lens of ['urgent', 'today', 'overdue', 'watching'] as const) {
    for (const scope of ['mine', 'company'] as const) {
      for (const id of ids(state, 'jordan', q({ scope, lens }))) assert.ok(all.includes(id), `${scope}/${lens} returned ${id} that All Tasks doesn't have`);
    }
  }
  assert.ok(!all.includes('site-plan'), 'All Tasks shows open work by default');
  assert.deepEqual(ids(state, 'jordan', q({ status: 'done' })), ['site-plan'], 'finished work is the Done status');
  assert.ok(ids(state, 'jordan', q({ lens: 'all', status: 'any' })).includes('site-plan'), 'status "any" brings finished work back');
});

test('My work includes approvals waiting on me; Company is everything', () => {
  const state = seedState(T0);
  assert.deepEqual(ids(state, 'jordan', q({ scope: 'mine' })), ['maple-estimate']);
  const company = ids(state, 'jordan', q({ scope: 'company' }));
  assert.ok(company.includes('staging-area') && company.includes('shingle-order'), 'company includes other people’s and unowned work');
});

test('Urgent, Today, Overdue and Watching select by priority, due date and watchers', () => {
  const state = seedState(T0);
  assert.deepEqual(new Set(ids(state, 'jordan', q({ lens: 'urgent' }))), new Set(['staging-area', 'permit-update', 'maple-tarp']));
  assert.deepEqual(new Set(ids(state, 'jordan', q({ lens: 'today' }))), new Set(['staging-area', 'permit-update', 'maple-estimate']));
  assert.deepEqual(ids(state, 'jordan', q({ lens: 'overdue' })), ['maple-tarp']);
  assert.deepEqual(ids(state, 'alex', q({ scope: 'mine', lens: 'overdue' })), ['maple-tarp']);
  assert.deepEqual(ids(state, 'maya', q({ scope: 'mine', lens: 'overdue' })), []);
  assert.deepEqual(ids(state, 'jordan', q({ scope: 'mine', lens: 'watching' })), ['staging-area'], 'watching ignores the scope');
  assert.deepEqual(ids(state, 'maya', q({ lens: 'watching' })), [], 'owners are not watchers of their own work');
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

test('status, priority and due take several values: any match within a group, groups combine', () => {
  const state = seedState(T0);
  assert.deepEqual(new Set(ids(state, 'alex', q({ status: ['blocked', 'review'] }))), new Set(['permit-update', 'maple-estimate']));
  assert.deepEqual(new Set(ids(state, 'alex', q({ status: ['blocked', 'done'] }))), new Set(['permit-update', 'site-plan']));
  assert.deepEqual(ids(state, 'alex', q({ status: [] })).length, ids(state, 'alex', q({ status: 'any' })).length, 'no status picked means any');
  assert.deepEqual(new Set(ids(state, 'alex', q({ due: ['overdue', 'none'] }))), new Set([...ids(state, 'alex', q({ due: 'overdue' })), ...ids(state, 'alex', q({ due: 'none' }))]));
  assert.deepEqual(ids(state, 'alex', q({ status: ['blocked', 'review'], priority: ['high'] })), ['permit-update'], 'groups still narrow each other');
  assert.deepEqual(ids(state, 'alex', q({ priority: [] })), ids(state, 'alex', q({ priority: 'any' })));
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

test('lens counts match the lens contents in each scope', () => {
  const state = seedState(T0);
  for (const scope of ['mine', 'company'] as const) {
    const counts = lensCounts(state, 'jordan', T0, scope);
    for (const lens of ['all', 'urgent', 'today', 'overdue', 'watching'] as const) assert.equal(counts[lens], ids(state, 'jordan', q({ scope, lens })).length, `${scope}/${lens}`);
  }
  assert.equal(lensCounts(state, 'jordan', T0, 'mine').all, 1);
});

test('full execution flow: create → assign → start → help → resolve → review → complete → unlock → reopen', () => {
  const n = { v: 0 };
  let state = seedState(T0);
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Measure the garage roof', owner: '', approver: 'jordan' } }, n);
  const id = state.tasks[0]!.id;
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Price the garage roof', owner: 'riley', dependsOn: [id] } }, n);
  const next = state.tasks[0]!.id;
  assert.ok(ids(state, 'jordan', q({ owner: 'none' })).includes(id), 'new unowned work shows as unowned');
  assert.ok(!ids(state, 'jordan', q({ scope: 'mine' })).includes(id), 'creating work does not make the manager its owner');

  state = run(state, 'jordan', { type: 'task/update', id, changes: { owner: 'alex' } }, n);
  assert.ok(ids(state, 'alex', q({ scope: 'mine' })).includes(id), 'assigned work reaches the owner');
  state = run(state, 'alex', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'working');
  state = run(state, 'alex', { type: 'task/request-help', id, note: 'Need the ladder key', helper: 'maya' }, n);
  assert.ok(ids(state, 'jordan', q({ status: 'blocked' })).includes(id), 'blocked work shows under the Blocked status');
  state = run(state, 'maya', { type: 'task/resolve', id, note: 'Key is in the truck' }, n);
  state = run(state, 'alex', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'review');
  assert.ok(ids(state, 'jordan', q({ scope: 'mine' })).includes(id), 'the approver sees the review in My work');
  assert.equal(blockingDeps(state, taskById(state, next)!).length, 1);
  state = run(state, 'jordan', { type: 'task/advance', id }, n);
  assert.equal(taskById(state, id)!.status, 'done');
  assert.equal(blockingDeps(state, taskById(state, next)!).length, 0, 'completion unlocks dependent work');
  assert.ok(ids(state, 'alex', q({ scope: 'mine', status: 'done' })).includes(id));

  const refused = apply(state, { type: 'task/reopen', id, note: 'Wrong roof' }, { actor: 'sam', now: T0, writer: 'test' });
  assert.equal(refused.ok, false, 'an uninvolved teammate cannot reopen');
  assert.equal(apply(state, { type: 'task/reopen', id, note: ' ' }, { actor: 'alex', now: T0, writer: 'test' }).ok, false, 'reopening needs a reason');
  state = run(state, 'alex', { type: 'task/reopen', id, note: 'Measured the wrong slope' }, n);
  const reopened = taskById(state, id)!;
  assert.equal(reopened.status, 'ready');
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.nextAction, 'Measured the wrong slope');
  assert.ok(ids(state, 'alex', q({ scope: 'mine' })).includes(id));
});

test('completion records its automatic effects: executed unlock with owner, skipped with reason, handoff', () => {
  const n = { v: 0 };
  let state = seedState(T0);
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Gate', owner: 'alex', nextOwner: 'maya' } }, n);
  const gate = state.tasks[0]!.id;
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Unlocks', owner: '', dependsOn: [gate] } }, n);
  const unlocks = state.tasks[0]!.id;
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Still blocked', owner: 'riley', dependsOn: [gate, 'crew-handoff'] } }, n);
  const blocked = state.tasks[0]!.id;
  state = run(state, 'alex', { type: 'task/advance', id: gate }, n);
  state = run(state, 'alex', { type: 'task/advance', id: gate }, n);
  const event = state.events[0]!;
  assert.equal(event.taskId, gate);
  assert.deepEqual(event.effects?.find(item => item.taskId === unlocks), { rule: 'dependency-unlock', outcome: 'executed', taskId: unlocks, owner: 'maya' });
  assert.deepEqual(event.effects?.find(item => item.taskId === blocked), { rule: 'dependency-unlock', outcome: 'skipped', taskId: blocked, reason: 'still waiting on “Prepare tomorrow’s crew handoff”' });
  assert.equal(taskById(state, unlocks)!.owner, 'maya', 'the effect matches the domain change');
  assert.equal(taskById(state, blocked)!.owner, 'riley');
  // Undo still works and restores the unlocked task's owner.
  state = run(state, 'alex', { type: 'undo', eventId: event.id }, n);
  assert.equal(taskById(state, unlocks)!.owner, '');
  // A plain handoff (nothing depends on it) is recorded too.
  state = run(state, 'jordan', { type: 'task/create', task: { title: 'Solo', owner: 'alex', nextOwner: 'sam' } }, n);
  const solo = state.tasks[0]!.id;
  state = run(state, 'alex', { type: 'task/advance', id: solo }, n);
  state = run(state, 'alex', { type: 'task/advance', id: solo }, n);
  assert.deepEqual(state.events[0]!.effects, [{ rule: 'handoff', outcome: 'executed', taskId: solo, owner: 'sam' }]);
  assert.equal(state.events.find(item => item.text.includes('created “Solo”'))?.effects, undefined, 'only automatic consequences are recorded');
});

test('reviewers cannot reopen work', () => {
  let state = seedState(T0);
  const result = apply(state, { type: 'task/reopen', id: 'site-plan', note: 'x' }, { actor: 'abraham', now: T0, writer: 'test' });
  assert.equal(result.ok, false);
  state = run(state, 'jordan', { type: 'task/reopen', id: 'site-plan', note: 'Layout changed' });
  assert.equal(taskById(state, 'site-plan')!.status, 'ready');
});
