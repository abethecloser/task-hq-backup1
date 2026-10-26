import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFilters } from './task-filters.ts';
import type { FilterTab } from './task-filters.ts';

const tab = (id: string, active = false): FilterTab => ({ id, label: id, hot: false, active });
// The order the app builds them in: All, Completed, Urgent, Today, Overdue, Watching.
const built = (active: string) => ['all', 'completed', 'urgent', 'today', 'overdue', 'watching'].map(id => tab(id, id === active));

test('All, Today, Overdue and Urgent stay visible in that order; Watching and Completed go under More', () => {
  const { primary, more } = splitFilters(built('all'));
  assert.deepEqual(primary.map(item => item.id), ['all', 'today', 'overdue', 'urgent']);
  assert.deepEqual(more.map(item => item.id), ['completed', 'watching']);
});

test('every view is reachable exactly once', () => {
  const { primary, more } = splitFilters(built('all'));
  assert.deepEqual([...primary, ...more].map(item => item.id).sort(), ['all', 'completed', 'overdue', 'today', 'urgent', 'watching']);
});

test('the active view stays visible: a primary one is on the bar, an overflow one is reported for the More button', () => {
  assert.equal(splitFilters(built('today')).activeInMore, null);
  assert.ok(splitFilters(built('today')).primary.find(item => item.id === 'today')!.active);
  assert.equal(splitFilters(built('watching')).activeInMore?.id, 'watching');
  assert.equal(splitFilters(built('completed')).activeInMore?.id, 'completed');
});

test('a view the app adds later still has a place: it lands under More', () => {
  const { more } = splitFilters([...built('all'), tab('mine')]);
  assert.deepEqual(more.map(item => item.id), ['completed', 'watching', 'mine']);
});
