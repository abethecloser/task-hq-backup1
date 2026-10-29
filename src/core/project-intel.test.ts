import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankTask, seedState } from './seed.ts';
import { NO_PROJECT, percentOf, projectIntel } from './project-intel.ts';
import type { QuestState, TaskStatus } from './contract.ts';

const NOW = Date.parse('2026-10-27T15:00:00Z');
function world(): QuestState {
  const state = seedState(NOW);
  state.projects = [{ id: 'roof', name: 'Roof' }, { id: 'yard', name: 'Yard' }];
  const make = (id: string, owner: string, projectId: string, status: TaskStatus, due = '') => {
    const task = blankTask(id, { title: id, owner, projectId, due }, 'jordan', NOW);
    task.status = status;
    return task;
  };
  state.tasks = [
    make('r1', 'alex', 'roof', 'done'),
    make('r2', 'alex', 'roof', 'working', '2026-10-20'),
    make('r3', 'maya', 'roof', 'blocked'),
    make('y1', 'maya', 'yard', 'done'),
    make('n1', 'alex', '', 'ready', '2026-10-30'),
  ];
  return state;
}

test('task completion and project completion are separate measures', () => {
  const intel = projectIntel(world(), 'jordan', NOW, true);
  assert.deepEqual(intel.tasks, { done: 2, total: 5, percent: 40 });
  // Yard has every task done; Roof doesn't; tasks with no project don't count as a project.
  assert.deepEqual(intel.projectsComplete, { complete: 1, total: 2 });
  const roof = intel.projects.find(item => item.id === 'roof')!;
  assert.deepEqual([roof.done, roof.total, roof.percent, roof.overdue, roof.blocked, roof.complete], [1, 3, 33, 1, 1, false]);
  assert.equal(intel.projects.find(item => item.id === NO_PROJECT)?.name, 'No project');
  assert.deepEqual(intel.stages, { ready: 1, working: 1, review: 0, blocked: 1, done: 2 });
});

test('selecting a project narrows tasks, people and attention; the project list stays whole', () => {
  const intel = projectIntel(world(), 'jordan', NOW, true, { projectId: 'roof' });
  assert.deepEqual(intel.tasks, { done: 1, total: 3, percent: 33 });
  assert.equal(intel.projects.length, 3);
  assert.deepEqual(intel.people.map(item => [item.person, item.open]), [['alex', 1], ['maya', 1]]);
  assert.deepEqual(intel.attention.map(item => [item.task.id, item.reason]), [['r2', 'Overdue'], ['r3', 'Blocked']]);
  assert.deepEqual(intel.next.map(item => item.id), ['r2']);
});

test('selecting a person narrows projects and tasks; the people list stays whole', () => {
  const intel = projectIntel(world(), 'jordan', NOW, true, { person: 'maya' });
  assert.deepEqual(intel.tasks, { done: 1, total: 2, percent: 50 });
  assert.deepEqual(intel.projects.map(item => [item.id, item.done, item.total]), [['roof', 0, 1], ['yard', 1, 1]]);
  assert.equal(intel.people.length, 2);
});

test('without company access only the viewer’s own work counts, and no team rows are shown', () => {
  const intel = projectIntel(world(), 'alex', NOW, false);
  assert.deepEqual(intel.tasks, { done: 1, total: 3, percent: 33 });
  assert.deepEqual(intel.people, []);
  assert.equal(intel.projects.some(item => item.id === 'yard'), false);
});

test('percentages never round up to 100 before everything is done', () => {
  assert.equal(percentOf(199, 200), 99);
  assert.equal(percentOf(200, 200), 100);
  assert.equal(percentOf(0, 0), 0);
});

test('blocked and waiting are counted apart, so labels match their numbers', () => {
  const state = world();
  const waiter = blankTask('r4', { title: 'r4', owner: 'maya', projectId: 'roof' }, 'jordan', NOW);
  waiter.status = 'ready';
  waiter.dependsOn = ['r2'];
  state.tasks.push(waiter);
  const intel = projectIntel(state, 'jordan', NOW, true);
  const roof = intel.projects.find(item => item.id === 'roof')!;
  assert.deepEqual([roof.blocked, roof.waiting], [1, 1]);
  const maya = intel.people.find(item => item.person === 'maya')!;
  assert.deepEqual([maya.blocked, maya.waiting, maya.byStatus.blocked], [1, 1, 1]);
});
