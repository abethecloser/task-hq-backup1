import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionTotals, groupAttention } from './attention-groups.ts';
import { insights } from './rules.ts';
import type { Insight } from './rules.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const condition = (over: Partial<Insight> & Pick<Insight, 'id'>): Insight => ({
  kind: 'blocked', severity: 'normal', what: 'x', why: 'y', next: 'z', who: '', ...over,
});

test('conditions on one task share a group; nothing is dropped or duplicated', () => {
  const state = seedState(T0);
  const [a, b] = state.tasks;
  const items = [
    condition({ id: '1', taskId: a!.id, severity: 'normal' }),
    condition({ id: '2', taskId: b!.id, severity: 'high' }),
    condition({ id: '3', taskId: a!.id, severity: 'critical' }),
  ];
  const groups = groupAttention(state, items);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flatMap(group => group.conditions.map(item => item.id)).sort(), ['1', '2', '3']);
  const first = groups[0]!;
  assert.equal(first.taskId, a!.id, 'the task with a critical condition leads');
  assert.equal(first.severity, 'critical');
  assert.deepEqual(first.conditions.map(item => item.id), ['1', '3'], 'conditions keep their original order');
  assert.equal(first.title, a!.title);
});

test('leads and conditions without a task are their own groups and are counted separately from tasks', () => {
  const state = seedState(T0);
  const task = state.tasks[0]!;
  const items = [
    condition({ id: 't1', taskId: task.id }),
    condition({ id: 't2', taskId: task.id }),
    condition({ id: 'l1', kind: 'lead-response', leadId: 'lead-a' }),
    condition({ id: 'l2', kind: 'lead-unassigned', leadId: 'lead-a' }),
    condition({ id: 'g1', kind: 'ultra-request', what: 'Access request' }),
  ];
  const totals = attentionTotals(groupAttention(state, items));
  assert.deepEqual(totals, { tasks: 1, leads: 1, other: 1, conditions: 5 });
});

test('the real demo workspace keeps every condition when grouped', () => {
  const state = seedState(T0);
  for (const now of [T0, T0 + 3 * 3600_000, T0 + 26 * 3600_000]) {
    const all = insights(state, now);
    const groups = groupAttention(state, all);
    assert.equal(attentionTotals(groups).conditions, all.length);
    assert.deepEqual(groups.flatMap(group => group.conditions.map(item => item.id)).sort(), all.map(item => item.id).sort());
    assert.ok(groups.length <= all.length);
  }
});
