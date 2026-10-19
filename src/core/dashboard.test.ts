import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestState, Task } from './contract.ts';
import { answer } from './ask.ts';
import { ago, atRisk, collaboration, commentsFor, digest, dueOn, heatGrid, homeMetrics, monthGrid, performance, periodEnd, periodStart, recentActivity, statusMix, systemInsights, teamActivity, teamWorkload, todayProgress } from './dashboard.ts';
import type { QuestEvent } from './contract.ts';
import { apply } from './engine.ts';
import { seedState } from './seed.ts';
import { DAY, localDate } from './time.ts';

// Sunday, October 18 2026, 6pm local.
const NOW = new Date('2026-10-18T18:00:00').getTime();

const TEMPLATE = seedState(NOW).tasks[0]!;

function task(state: QuestState, changes: Partial<Task>): Task {
  const made: Task = { ...TEMPLATE, watchers: [], owner: '', approver: '', nextOwner: '', decisionOwner: '', id: `t-${state.tasks.length}`, dependsOn: [], blocker: null, ultra: false, priority: 'normal', due: '', status: 'ready', completedAt: null, createdAt: NOW - 30 * DAY, ...changes };
  state.tasks.push(made);
  return made;
}

function empty() {
  const state = seedState(NOW);
  state.tasks = [];
  state.events = [];
  return state;
}

test('periods start on local midnight, Monday and the 1st', () => {
  assert.equal(localDate(periodStart(NOW, 'today')), '2026-10-18');
  assert.equal(localDate(periodStart(NOW, 'week')), '2026-10-12');
  assert.equal(localDate(periodStart(NOW, 'month')), '2026-10-01');
  assert.equal(localDate(periodEnd(NOW, 'week')), '2026-10-19');
  assert.equal(localDate(periodEnd(NOW, 'month')), '2026-11-01');
});

test('performance counts only the viewer’s own work for the period', () => {
  const state = empty();
  task(state, { owner: 'maya', status: 'done', completedAt: NOW - DAY });
  task(state, { owner: 'maya', status: 'done', completedAt: NOW - 8 * DAY });
  task(state, { owner: 'maya', status: 'working', due: '2026-10-16' });
  task(state, { owner: 'maya', status: 'blocked' });
  task(state, { owner: 'jordan', status: 'done', completedAt: NOW - DAY });
  const week = performance(state, 'maya', NOW, 'week');
  assert.equal(week.completed, 1);
  assert.equal(week.completedDelta, 0, 'one this week, one the week before');
  assert.equal(week.open, 2);
  assert.equal(week.due, 1);
  assert.equal(week.blocked, 1);
  assert.equal(performance(state, 'maya', NOW, 'month').completed, 2);
});

test('at risk: overdue, blocked, or urgent and due within two days; company gate narrows it', () => {
  const state = empty();
  const late = task(state, { owner: 'maya', due: '2026-10-10', priority: 'high' });
  task(state, { owner: 'jordan', status: 'blocked' });
  task(state, { owner: 'jordan', priority: 'high', due: '2026-10-19' });
  task(state, { owner: 'jordan', due: '2026-10-19' });
  const all = atRisk(state, 'maya', NOW, true);
  assert.equal(all.length, 3);
  assert.deepEqual(all.find(item => item.task.id === late.id)?.reasons, ['Overdue', 'high priority']);
  assert.deepEqual(atRisk(state, 'maya', NOW, false).map(item => item.task.id), [late.id]);
});

test('at risk also covers work waiting on a dependency and started work that has stalled', () => {
  const state = empty();
  const first = task(state, { owner: 'jordan', lastActivityAt: NOW });
  const waits = task(state, { owner: 'maya', dependsOn: [first.id], lastActivityAt: NOW });
  const stalled = task(state, { owner: 'maya', status: 'working', lastActivityAt: NOW - 30 * DAY });
  task(state, { owner: 'maya', status: 'ready', lastActivityAt: NOW - 30 * DAY });
  const items = atRisk(state, 'maya', NOW, false);
  assert.deepEqual(items.map(item => item.task.id).sort(), [waits.id, stalled.id].sort(), 'an untouched backlog item is not at risk by itself');
  assert.deepEqual(items.find(item => item.task.id === waits.id)?.reasons, ['Waiting on a dependency']);
  assert.deepEqual(items.find(item => item.task.id === stalled.id)?.reasons, ['Stalled']);
});

test('status mix and team workload', () => {
  const state = empty();
  task(state, { owner: 'maya', status: 'done', completedAt: NOW });
  task(state, { owner: 'maya', status: 'working' });
  task(state, { owner: 'maya', status: 'ready' });
  task(state, { owner: 'maya', status: 'ready', due: '2026-10-01' });
  task(state, { owner: 'jordan', status: 'review' });
  assert.deepEqual(statusMix(state, 'maya'), { total: 4, done: 1, working: 1, notStarted: 2, percent: 25 });
  assert.deepEqual(teamWorkload(state, NOW).map(item => [item.name, item.open, item.late]), [['Maya', 3, 1], ['Jordan', 1, 0]]);
});

test('calendar is Monday-first with October 2026 starting on Thursday', () => {
  const state = empty();
  task(state, { owner: 'maya', due: '2026-10-21' });
  const cells = monthGrid(state, 'maya', NOW);
  assert.deepEqual(cells.slice(0, 4).map(cell => cell?.day ?? null), [null, null, null, 1]);
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(cells.find(cell => cell?.today)?.day, 18);
  assert.equal(cells.find(cell => cell?.day === 21)?.due, 1);
});

test('comments come from others on tasks the viewer is part of', () => {
  let state = seedState(NOW);
  const mine = state.tasks.find(item => item.owner === 'maya' && item.status !== 'done')!;
  const result = apply(state, { type: 'task/comment', id: mine.id, note: 'Gutters are in.' }, { actor: 'jordan', now: NOW, newId: () => 'c1' });
  assert.ok(result.ok);
  state = result.state;
  assert.deepEqual(commentsFor(state, 'maya').map(item => item.task.id), [mine.id]);
  assert.equal(commentsFor(state, 'jordan').length, 0, 'your own comments are not news to you');
  assert.ok(recentActivity(state, 'maya', true).some(event => event.actionType === 'task/comment'));
});

test('digest states counts from records, and stays on the viewer’s work without company access', () => {
  const state = empty();
  task(state, { owner: 'jordan', due: '2026-10-01' });
  task(state, { owner: 'maya', status: 'done', completedAt: NOW - DAY, createdAt: NOW - 2 * DAY });
  const team = digest(state, 'maya', NOW, 'week', true);
  assert.match(team[0]!, /^This week: 1 task completed, 1 created\.$/);
  assert.match(team.join(' '), /1 task is overdue across the team/);
  assert.match(team.join(' '), /Jordan carries the most open work: 1 open, 1 late/);
  assert.doesNotMatch(digest(state, 'maya', NOW, 'week', false).join(' '), /Jordan|overdue/);
});

test('ask answers from records and declines other people without company access', () => {
  const state = empty();
  task(state, { owner: 'jordan', title: 'Order shingles', due: '2026-10-10', priority: 'high' });
  task(state, { owner: 'maya', title: 'Call adjuster', status: 'done', completedAt: NOW - DAY });
  assert.match(answer(state, 'maya', NOW, "What's overdue?", true), /1 task is overdue across the team: “Order shingles” \(Jordan\)/);
  assert.equal(answer(state, 'maya', NOW, "What's overdue?", false), 'Nothing is overdue on your work.');
  assert.equal(answer(state, 'maya', NOW, 'What did I finish this week?', true), 'You completed 1 task this week.');
  assert.match(answer(state, 'maya', NOW, "Who's busiest right now?", true), /^Jordan has the most open work: 1 open, 1 late\./);
  assert.equal(answer(state, 'maya', NOW, "Who's busiest right now?", false), 'I can only answer about your own work right now.');
  assert.match(answer(state, 'maya', NOW, 'What is Jordan working on?', true), /Jordan has 1 open task, 1 late/);
  assert.match(answer(state, 'maya', NOW, 'Is it the same as before?', true), /^I can answer about/, '"same" is not Sam');
});

test('ago reads like the activity feed', () => {
  assert.equal(ago(NOW - 30_000, NOW), 'just now');
  assert.equal(ago(NOW - 21 * 3_600_000, NOW), '21h ago');
  assert.equal(ago(NOW - 2 * DAY, NOW), '2d ago');
});

test('today’s progress counts work due today plus anything finished today', () => {
  const state = empty();
  assert.deepEqual(todayProgress(state, 'maya', NOW), { total: 0, done: 0, pending: 0, percent: 0 });
  task(state, { owner: 'maya', due: '2026-10-18' });
  task(state, { owner: 'maya', due: '2026-10-18', status: 'done', completedAt: NOW - 3_600_000 });
  task(state, { owner: 'maya', due: '2026-10-25', status: 'done', completedAt: NOW - 60_000 });
  task(state, { owner: 'maya', due: '2026-10-19' });
  task(state, { owner: 'jordan', due: '2026-10-18' });
  assert.deepEqual(todayProgress(state, 'maya', NOW), { total: 3, done: 2, pending: 1, percent: 67 });
});

const event = (id: string, changes: Partial<QuestEvent>): QuestEvent => ({ id, at: NOW, actor: 'jordan', kind: 'task', text: '', ...changes });

test('home metrics: active, completed today, overdue and blocked on the viewer’s plate', () => {
  const state = empty();
  task(state, { owner: 'maya', due: '2026-10-10' });
  task(state, { owner: 'maya', status: 'blocked' });
  task(state, { owner: 'maya', status: 'done', completedAt: NOW - 3_600_000 });
  task(state, { owner: 'maya', status: 'done', completedAt: NOW - 2 * DAY });
  task(state, { owner: 'jordan', due: '2026-10-10' });
  assert.deepEqual(homeMetrics(state, 'maya', NOW), { active: 2, completedToday: 1, overdue: 1, blocked: 1 });
});

test('collaboration: comments on your work, @mentions, replies after your comment, channel mentions with read state', () => {
  const state = empty();
  const mine = task(state, { owner: 'maya', title: 'Roof repair' });
  const other = task(state, { owner: 'alex', title: 'Permit docs' });
  const thread = task(state, { owner: 'sam', title: 'Estimate review' });
  state.events = [
    event('e1', { taskId: mine.id, actionType: 'task/comment', text: 'Jordan Lee commented: Gutters are in.', at: NOW - 5000 }),
    event('e2', { taskId: other.id, actionType: 'task/comment', text: 'Jordan Lee commented: @Maya can you check this?', at: NOW - 4000 }),
    event('e3', { taskId: thread.id, actionType: 'task/comment', actor: 'maya', text: 'Maya Chen commented: Numbers look off.', at: NOW - 3000 }),
    event('e4', { taskId: thread.id, actionType: 'task/comment', actor: 'sam', text: 'Sam Rivera commented: Fixed.', at: NOW - 2000 }),
    event('e5', { taskId: other.id, actionType: 'task/comment', text: 'Jordan Lee commented: @Mayan not you.', at: NOW - 1000 }),
  ];
  const channel = [{ id: 'msg:m1', from: 'riley', title: 'Mentioned you in #ops', detail: 'See the takeoff', at: NOW - 500, channelId: 'ops', messageId: 'm1' }];
  const items = collaboration(state, 'maya', true, channel, new Set());
  assert.deepEqual(items.map(item => [item.id, item.kind]), [['msg:m1', 'mention'], ['e4', 'reply'], ['e2', 'mention'], ['e1', 'comment']]);
  assert.equal(items[0]!.unread, true);
  assert.equal(collaboration(state, 'maya', true, channel, new Set(['msg:m1']))[0]!.unread, false);
  assert.equal(items.find(item => item.id === 'e2')!.text, '@Maya can you check this?');
  assert.ok(!collaboration(state, 'maya', false, [], new Set()).some(item => item.id === 'e2'), 'a mention on work outside your access stays hidden');
});

test('team activity drops noise and collapses repeats on the same record', () => {
  const state = empty();
  const one = task(state, { owner: 'maya' });
  state.events = [
    event('a1', { taskId: one.id, at: NOW - 60_000 }),
    event('a2', { taskId: one.id, at: NOW - 120_000 }),
    event('a3', { taskId: one.id, at: NOW - 60 * 60_000 }),
    event('a4', { kind: 'policy', at: NOW - 30_000 }),
    event('a5', { kind: 'feedback', at: NOW - 20_000 }),
  ];
  assert.deepEqual(teamActivity(state, 'maya', true).map(item => item.id), ['a1', 'a3']);
});

test('team workload splits open work by stage and flags items needing attention', () => {
  const state = empty();
  task(state, { owner: 'maya', status: 'working' });
  task(state, { owner: 'maya', status: 'blocked' });
  task(state, { owner: 'maya', status: 'ready', due: '2026-10-01' });
  const [maya] = teamWorkload(state, NOW);
  assert.deepEqual(maya!.byStatus, { ready: 1, working: 1, blocked: 1, review: 0 });
  assert.equal(maya!.attention, 2);
});

test('calendar heat comes from due dates and blocked work, and months can be paged', () => {
  const state = empty();
  task(state, { owner: 'maya', due: '2026-10-21' });
  task(state, { owner: 'jordan', due: '2026-10-21', status: 'blocked' });
  task(state, { owner: 'jordan', due: '2026-11-03' });
  const mine = heatGrid(state, 'maya', NOW, false);
  assert.equal(mine.label, 'October 2026');
  assert.equal(mine.cells.find(cell => cell?.day === 21)?.heat, 1);
  const team = heatGrid(state, 'maya', NOW, true);
  assert.deepEqual(['due', 'blocked', 'heat'].map(key => team.cells.find(cell => cell?.day === 21)![key as 'due']), [2, 1, 2]);
  const next = heatGrid(state, 'maya', NOW, true, 1);
  assert.equal(next.label, 'November 2026');
  assert.equal(next.cells.find(cell => cell?.day === 3)?.due, 1);
  assert.equal(dueOn(state, 'maya', NOW, true, '2026-10-21').length, 2);
  assert.equal(dueOn(state, 'maya', NOW, false, '2026-10-21').length, 1);
});

test('system insights are grounded in records', () => {
  const state = empty();
  for (let i = 0; i < 4; i++) task(state, { owner: 'maya', due: '2026-10-14' });
  task(state, { owner: 'jordan', due: '2026-10-20', waitingOn: 'City permit office' });
  task(state, { owner: 'alex', due: '2026-10-20', waitingOn: 'city permit office ' });
  task(state, { owner: '', due: '2026-10-20' });
  const blocked = task(state, { owner: 'sam', title: 'Tear-off' });
  state.events = [
    event('h1', { taskId: blocked.id, actionType: 'task/request-help', kind: 'help', at: NOW - 2 * DAY }),
    event('h2', { taskId: blocked.id, actionType: 'task/request-help', kind: 'help', at: NOW - DAY }),
  ];
  const ids = systemInsights(state, 'maya', NOW, true).map(item => item.id);
  assert.ok(ids.includes('overdue-rising'));
  assert.ok(ids.includes('concentrated'));
  assert.ok(ids.includes(`reblocked-${blocked.id}`));
  assert.ok(ids.some(id => id.startsWith('waiting-')));
  assert.ok(ids.includes('unassigned'));
  assert.ok(ids.includes('cluster-2026-10-20'));
  const own = systemInsights(state, 'maya', NOW, false).map(item => item.id);
  assert.ok(!own.includes('concentrated') && !own.includes('unassigned'), 'team-wide observations need company access');
  assert.deepEqual(systemInsights(empty(), 'maya', NOW, true), []);
});
