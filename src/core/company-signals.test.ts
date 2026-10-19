import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from './seed.ts';
import { apply } from './engine.ts';
import { companySignals } from './company-signals.ts';
import { DEFAULT_QUERY, queryTasks } from './registry.ts';

const now = new Date('2026-10-19T10:00:00').getTime();

test('signals use actual deadlines and existing metrics without inventing events', () => {
  const state = seedState(now);
  state.events = [];
  const feed = companySignals(state, 'jordan', now);
  assert.ok(feed.summary.startsWith(`${queryTasks(state, 'jordan', now, DEFAULT_QUERY).length} open`));
  assert.ok(feed.summary.includes(`${queryTasks(state, 'jordan', now, { ...DEFAULT_QUERY, lens: 'today' }).length} due today`));
  assert.ok(feed.items.every(item => item.source === 'condition' && item.at === undefined));
  assert.equal(new Set(feed.items.map(item => item.taskId)).size, feed.items.length);
  const clean = companySignals({ ...state, tasks: [], events: [] }, 'jordan', now);
  assert.deepEqual(clean.items, []);
  assert.equal(clean.summary, '0 open · 0 due today · 0 overdue · 0 stalled');
});

test('recorded changes update the feed; duplicates, undone, old and missing-task events are excluded', () => {
  const state = seedState(now);
  const changed = apply(state, { type: 'task/update', id: 'maple-tarp', changes: { nextAction: 'Check the site' } }, { actor: 'alex', now });
  assert.ok(changed.ok && changed.event);
  const event = changed.event;
  const feedState = { ...changed.state, events: [event, event, { ...event, id: 'undone', undone: true }, { ...event, id: 'old', at: now - 86_400_001 }, { ...event, id: 'future', at: now + 60_000 }, { ...event, id: 'missing', taskId: 'not-loaded' }] };
  const recorded = companySignals(feedState, 'alex', now).items.filter(item => item.source === 'event');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.text, event.text);
  assert.equal(recorded[0]!.at, event.at);
  assert.equal(recorded[0]!.taskId, event.taskId);
});

test('reviewers and unknown actors receive no operational records', () => {
  const state = seedState(now);
  assert.deepEqual(companySignals(state, 'abraham', now).items, []);
  assert.deepEqual(companySignals(state, 'unknown', now).items, []);
});

test('Critical Focus scopes both summaries and event details to the focus task', () => {
  const state = seedState(now);
  const result = apply(state, { type: 'ultra/activate', taskId: 'maple-tarp' }, { actor: 'jordan', now });
  // Use the actual engine focus schema, with no granted company access.
  assert.ok(result.ok);
  const feed = companySignals(result.state, 'alex', now);
  assert.ok(feed.summary.endsWith('Focus task only'));
  assert.ok(feed.items.every(item => item.taskId === 'maple-tarp'));
  assert.deepEqual(companySignals(result.state, 'jordan', now).summary.includes('Focus task only'), false);
});
