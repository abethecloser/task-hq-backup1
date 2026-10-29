import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestState, Task } from './contract.ts';
import { atRisk } from './dashboard.ts';
import { HOME_PERIOD_KEY, inHomePeriod, loadHomePeriod, periodDueLimit, riskInPeriod, saveHomePeriod } from './home-period.ts';
import { seedState } from './seed.ts';
import { DAY, addDays, localDate } from './time.ts';

// Wednesday, October 21 2026, 10am local.
const NOW = new Date('2026-10-21T10:00:00').getTime();
const TEMPLATE = seedState(NOW).tasks[0]!;
const ME = TEMPLATE.owner || 'alex';

function make(state: QuestState, id: string, changes: Partial<Task>): Task {
  const made: Task = { ...TEMPLATE, watchers: [], owner: ME, approver: '', nextOwner: '', decisionOwner: '', id, title: id, dependsOn: [], blocker: null, ultra: false, priority: 'normal', due: '', status: 'ready', completedAt: null, createdAt: NOW - 30 * DAY, ...changes };
  state.tasks.push(made);
  return made;
}

test('Today and This week limits reuse the task list filters', () => {
  assert.equal(periodDueLimit(NOW, 'today'), localDate(NOW));
  assert.equal(periodDueLimit(NOW, 'week'), addDays(NOW, 7));
});

test('Up next keeps due, late and in-motion work in Today; This week adds the coming days and undated work', () => {
  const state = seedState(NOW); state.tasks = []; state.events = [];
  const t = {
    today: make(state, 'today', { due: localDate(NOW) }),
    late: make(state, 'late', { due: addDays(NOW, -2) }),
    tomorrow: make(state, 'tomorrow', { due: addDays(NOW, 1) }),
    nextWeek: make(state, 'next-week', { due: addDays(NOW, 6) }),
    farOff: make(state, 'far-off', { due: addDays(NOW, 20) }),
    undated: make(state, 'undated', {}),
    working: make(state, 'working', { status: 'working', due: addDays(NOW, 12) }),
    blocked: make(state, 'blocked', { status: 'blocked', due: addDays(NOW, 12) }),
    ultra: make(state, 'ultra', { ultra: true, due: addDays(NOW, 12) }),
  };
  const shown = (period: 'today' | 'week') => Object.values(t).filter(task => inHomePeriod(task, period, NOW)).map(task => task.id).sort();
  assert.deepEqual(shown('today'), ['blocked', 'late', 'today', 'ultra', 'working']);
  assert.deepEqual(shown('week'), ['blocked', 'late', 'next-week', 'today', 'tomorrow', 'ultra', 'undated', 'working']);
});

test('At risk always shows problems; a due-soon warning only inside the period', () => {
  const state = seedState(NOW); state.tasks = []; state.events = [];
  make(state, 'late', { due: addDays(NOW, -1) });
  make(state, 'blocked', { status: 'blocked', due: addDays(NOW, 9) });
  make(state, 'soon-high', { priority: 'high', due: addDays(NOW, 1) });
  make(state, 'today-high', { priority: 'high', due: localDate(NOW) });
  const risks = atRisk(state, ME, NOW, false);
  const ids = (period: 'today' | 'week') => risks.filter(item => riskInPeriod(item, period, NOW)).map(item => item.task.id).sort();
  assert.deepEqual(ids('today'), ['blocked', 'late', 'today-high']);
  assert.deepEqual(ids('week'), ['blocked', 'late', 'soon-high', 'today-high']);
});

test('the period preference defaults to Today and round-trips', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  assert.equal(loadHomePeriod(store), 'today');
  saveHomePeriod(store, 'week');
  assert.equal(data.get(HOME_PERIOD_KEY), 'week');
  assert.equal(loadHomePeriod(store), 'week');
});
