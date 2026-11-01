import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ITEMS, PRESETS, addItem, layoutOf, moveItem, normalizeLayout, removeItem, resizeItem, withSavedLayout } from './dashboard-layout.ts';
import type { ModuleSpec } from './dashboard-layout.ts';

const SPECS: ModuleSpec[] = [
  { id: 'welcome', sizes: ['xl'], defaultSize: 'xl' }, { id: 'performance', sizes: ['l', 'xl'], defaultSize: 'xl' },
  { id: 'up-next', sizes: ['s', 'm', 'l'], defaultSize: 'm' }, { id: 'at-risk', sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { id: 'projects', sizes: ['l', 'xl'], defaultSize: 'l' }, { id: 'culture', sizes: ['s', 'm'], defaultSize: 's' },
  { id: 'video', sizes: ['s', 'm'], defaultSize: 's' }, { id: 'moments', sizes: ['s', 'm'], defaultSize: 's' },
  { id: 'people', sizes: ['s', 'm'], defaultSize: 'm' }, { id: 'needs-hand', sizes: ['s', 'm'], defaultSize: 's' },
  { id: 'next-actions', sizes: ['s', 'm'], defaultSize: 's' }, { id: 'activity', sizes: ['s', 'm'], defaultSize: 's' },
];

test('no saved preference: everyone sees today’s dashboard', () => {
  for (const raw of [undefined, null, 'nonsense', 42, {}, { version: 2, items: [] }, { version: 1, items: 'x' }, { version: 1, items: [] }]) {
    assert.deepEqual(normalizeLayout(raw, SPECS).items, DEFAULT_ITEMS, JSON.stringify(raw));
  }
});

test('saved layouts are cleaned: unknown, duplicate and unavailable modules dropped, bad sizes fixed', () => {
  const layout = normalizeLayout({ version: 1, items: [{ id: 'at-risk', size: 'l' }, { id: 'gone' }, { id: 'at-risk', size: 's' }, { id: 'welcome', size: 's' }, null, { id: 'culture', size: 'xl' }] }, SPECS);
  assert.deepEqual(layout.items, [{ id: 'at-risk', size: 'l' }, { id: 'welcome', size: 'xl' }, { id: 'culture', size: 's' }]);
  // A module this person can't use (not in their available specs) is left out.
  assert.deepEqual(normalizeLayout({ version: 1, items: [{ id: 'people', size: 'm' }, { id: 'up-next', size: 'm' }] }, SPECS.filter(s => s.id !== 'people')).items, [{ id: 'up-next', size: 'm' }]);
});

test('move, resize, remove and add', () => {
  let layout = normalizeLayout(null, SPECS);
  layout = moveItem(layout, 'culture', 0);
  assert.equal(layout.items[0]!.id, 'culture');
  layout = moveItem(layout, 'culture', 99);
  assert.equal(layout.items.at(-1)!.id, 'culture');
  const projects = SPECS.find(s => s.id === 'projects')!;
  assert.equal(resizeItem(layout, 'projects', 'xl', projects).items.find(i => i.id === 'projects')!.size, 'xl');
  assert.equal(resizeItem(layout, 'projects', 's', projects).items.find(i => i.id === 'projects')!.size, 'l', 'unsupported size refused');
  layout = removeItem(layout, 'at-risk');
  assert.ok(!layout.items.some(i => i.id === 'at-risk'));
  layout = addItem(layout, SPECS.find(s => s.id === 'at-risk')!);
  assert.deepEqual(layout.items.at(-1), { id: 'at-risk', size: 'm' });
  assert.equal(addItem(layout, SPECS.find(s => s.id === 'at-risk')!).items.length, layout.items.length, 'never twice');
});

test('every preset is a valid starting point', () => {
  for (const [id, items] of Object.entries(PRESETS)) assert.deepEqual(normalizeLayout({ version: 1, items }, SPECS).items, items, id);
});

test('saving one page in one workspace never touches any other saved layout', () => {
  const mine = layoutOf([{ id: 'at-risk', size: 'm' }]);
  const before = { orgA: { home: { version: 1, items: [] }, reports: { x: 1 } }, orgB: { home: { y: 2 } } };
  const after = withSavedLayout(before, 'orgA', 'home', mine);
  assert.deepEqual(after.orgA!.home, mine);
  assert.deepEqual(after.orgA!.reports, { x: 1 });
  assert.deepEqual(after.orgB, { home: { y: 2 } });
  assert.deepEqual(before.orgA.home, { version: 1, items: [] }, 'input not mutated');
  const cleared = withSavedLayout(after, 'orgA', 'home', null);
  assert.ok(!('home' in cleared.orgA!)); assert.deepEqual(cleared.orgB, { home: { y: 2 } });
  for (const junk of [null, 'x', [1], 5]) assert.deepEqual(withSavedLayout(junk, 'o', 'home', mine), { o: { home: mine } });
});
