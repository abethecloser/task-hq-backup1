import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankTask, seedState } from './seed.ts';
import { companyReport } from './reports.ts';
import type { QuestState, TaskStatus } from './contract.ts';
import { DAY } from './time.ts';

const NOW = new Date('2026-10-29T15:00:00').getTime();
function world(): QuestState {
  const state = seedState(NOW);
  const make = (id: string, owner: string, status: TaskStatus, opts: { due?: string; priority?: 'high'; completedAt?: number; createdAt?: number; ultra?: boolean; archived?: boolean } = {}) => {
    const task = blankTask(id, { title: id, owner, due: opts.due ?? '', priority: opts.priority ?? 'normal' }, 'jordan', opts.createdAt ?? NOW - 20 * DAY);
    task.status = status;
    task.ultra = !!opts.ultra;
    if (opts.completedAt) { task.completedAt = opts.completedAt; task.completedBy = owner; }
    if (opts.archived) task.archivedAt = NOW;
    return task;
  };
  state.tasks = [
    make('a', 'alex', 'done', { due: '2026-10-28', completedAt: NOW - 2 * DAY, createdAt: NOW - 6 * DAY }), // on time, 4d cycle
    make('b', 'alex', 'done', { due: '2026-10-20', completedAt: NOW - 3 * DAY, createdAt: NOW - 10 * DAY }), // late, 7d
    make('c', 'maya', 'done', { completedAt: NOW - 20 * DAY, createdAt: NOW - 21 * DAY }), // outside the week
    make('d', 'maya', 'working', { priority: 'high', due: '2026-10-01' }), // critical + overdue
    make('e', 'sam', 'ready', { ultra: true }),
    make('f', 'sam', 'blocked'),
    make('g', 'sam', 'done', { completedAt: NOW - DAY, archived: true }), // archived: excluded
  ];
  return state;
}

test('week report counts completions, on-time rate and cycle time from records', () => {
  const r = companyReport(world(), 'jordan', NOW, 'week', true);
  assert.equal(r.total, 6);
  assert.equal(r.completed, 2);
  assert.equal(r.onTimeRate, 50);
  assert.equal(r.onTimeBasis, 2);
  assert.equal(r.avgCycleDays, 5.5);
  assert.equal(r.criticalOpen, 2);
  assert.equal(r.overdue, 1);
  assert.deepEqual(r.byPerson, [{ person: 'alex', count: 2 }]);
  assert.deepEqual(r.byStatus, { ready: 1, working: 1, review: 0, blocked: 1, done: 3 });
  assert.deepEqual(r.critical.map(task => task.id).sort(), ['d', 'e']);
});

test('a longer range includes older completions; throughput covers 8 weeks', () => {
  const r = companyReport(world(), 'jordan', NOW, 'month', true);
  assert.equal(r.completed, 3);
  assert.equal(r.throughput.length, 8);
  assert.equal(r.throughput.reduce((sum, week) => sum + week.count, 0), 3);
  assert.equal(r.throughput.at(-1)!.count, 2);
});

test('without company access, only the viewer’s own work is reported', () => {
  const r = companyReport(world(), 'maya', NOW, 'quarter', false);
  assert.equal(r.total, 2);
  assert.equal(r.onTimeRate, null);
});
