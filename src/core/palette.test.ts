import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteItems, rankPalette } from './palette.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-11-08T09:00:00').getTime();

test('palette offers New task, pages and open tasks, and never done or archived tasks', () => {
  const state = seedState(T0);
  const actor = state.people[0]!.id;
  const items = paletteItems(state, actor, T0);
  assert.ok(items.some(item => item.target.kind === 'page' && item.label === 'Tasks'));
  const ids = new Set(items.filter(item => item.target.kind === 'task').map(item => (item.target as { id: string }).id));
  for (const task of state.tasks) assert.equal(ids.has(task.id), !task.archivedAt && task.status !== 'done', task.title);
});

test('New task is offered to people who may create tasks and withheld from reviewers', () => {
  const state = seedState(T0);
  const id = state.people[0]!.id;
  assert.equal(paletteItems(state, id, T0).some(item => item.target.kind === 'create'), true);
  const reviewer = { ...state, people: state.people.map(p => p.id === id ? { ...p, authority: 'reviewer' as const } : p) };
  assert.equal(paletteItems(reviewer, id, T0).some(item => item.target.kind === 'create'), false);
});

test('pages the caller cannot open are left out', () => {
  const state = seedState(T0);
  const items = paletteItems(state, state.people[0]!.id, T0, { canOpenPage: page => page !== 'team' });
  assert.equal(items.some(item => item.target.kind === 'page' && item.target.page === 'team'), false);
});

test('ranking: prefix beats word-start beats subsequence; no match returns nothing', () => {
  const mk = (id: string, label: string) => ({ id, group: 'Tasks' as const, label, hint: '', target: { kind: 'task' as const, id } });
  const items = [mk('c', 'Re-call Klarna'), mk('b', 'Dispute klarna'), mk('a', 'Klarna refund'), mk('d', 'Unrelated')];
  assert.deepEqual(rankPalette(items, 'klarna').map(i => i.id), ['a', 'c', 'b'], 'prefix first, then word-start matches in list order');
  assert.deepEqual(rankPalette(items, 'zzzq'), []);
  assert.ok(rankPalette(items, 'dsp').some(i => i.id === 'b'), 'subsequence match');
});

test('empty query shows actions and pages first, with only a few tasks', () => {
  const state = seedState(T0);
  const shown = rankPalette(paletteItems(state, state.people[0]!.id, T0), '');
  assert.ok(shown.length <= 30);
  assert.ok(shown.filter(item => item.group === 'Tasks').length <= 8);
});
