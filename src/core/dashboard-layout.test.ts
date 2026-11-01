import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ITEMS, PRESETS, addItem, layoutOf, moveItem, normalizeLayout, removeItem, resizeItem, withSavedLayout } from './dashboard-layout.ts';
import type { ModuleSpec } from './dashboard-layout.ts';

const SPECS: ModuleSpec[] = [
  { id: 'welcome', sizes: ['xl'], defaultSize: 'xl' }, { id: 'performance', sizes: ['l', 'xl'], defaultSize: 'xl' },
  { id: 'up-next', sizes: ['s', 'm', 'l'], defaultSize: 'm' }, { id: 'at-risk', sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { id: 'reports', sizes: ['s', 'm', 'l'], defaultSize: 'm' },
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

test('height is separate from width: Auto by default, stored only when chosen, kept through moves and resizes', async () => {
  const { setHeight, setArrangement, heightOf } = await import('./dashboard-layout.ts');
  let layout = normalizeLayout(null, SPECS);
  assert.ok(layout.items.every(item => heightOf(item) === 'auto' && !('height' in item)), 'old and default layouts read as Auto');
  assert.equal(layout.arrangement, 'packed');
  layout = setHeight(layout, 'at-risk', 'compact');
  layout = resizeItem(layout, 'at-risk', 'l', SPECS.find(s => s.id === 'at-risk')!);
  layout = moveItem(layout, 'at-risk', 0);
  assert.deepEqual(layout.items[0], { id: 'at-risk', size: 'l', height: 'compact' });
  assert.deepEqual(setHeight(layout, 'at-risk', 'auto').items[0], { id: 'at-risk', size: 'l' });
  layout = setArrangement(layout, 'aligned');
  // Round-trips through saving; junk heights and arrangements fall back.
  assert.deepEqual(normalizeLayout(JSON.parse(JSON.stringify(layout)), SPECS), layout);
  const junk = normalizeLayout({ version: 1, arrangement: 'diagonal', items: [{ id: 'up-next', size: 'm', height: 'huge' }] }, SPECS);
  assert.deepEqual(junk, { version: 1, arrangement: 'packed', items: [{ id: 'up-next', size: 'm' }] });
});

test('rows fill edge to edge in the person’s order; widths only grow to close a gap', async () => {
  const { fillRows } = await import('./dashboard-layout.ts');
  // Default desktop: already full rows, unchanged.
  assert.deepEqual(fillRows([{ id: 'welcome', span: 12 }, { id: 'up', span: 6 }, { id: 'risk', span: 6 }, { id: 'projects', span: 8 }, { id: 'culture', span: 4 }]),
    { welcome: 12, up: 6, risk: 6, projects: 8, culture: 4 });
  // Up next expanded (8) no longer fits beside At risk (6): each row closes its own gap; order kept.
  assert.deepEqual(fillRows([{ id: 'up', span: 8 }, { id: 'risk', span: 6 }, { id: 'projects', span: 8 }, { id: 'culture', span: 4 }]),
    { up: 12, risk: 12, projects: 8, culture: 4 });
  // Three smalls share a row; a lone small at the end takes the whole row.
  assert.deepEqual(fillRows([{ id: 'a', span: 4 }, { id: 'b', span: 4 }, { id: 'c', span: 4 }, { id: 'd', span: 4 }]), { a: 4, b: 4, c: 4, d: 12 });
  // Proportional sharing: 4 + 6 → 5 + 7 (12 columns, rounded, the last takes the remainder).
  assert.deepEqual(fillRows([{ id: 'a', span: 4 }, { id: 'b', span: 6 }]), { a: 5, b: 7 });
  // Every row sums to the grid width.
  const spans = fillRows([{ id: 'a', span: 4 }, { id: 'b', span: 8 }, { id: 'c', span: 6 }, { id: 'd', span: 4 }, { id: 'e', span: 12 }]);
  assert.deepEqual(spans, { a: 4, b: 8, c: 7, d: 5, e: 12 });
});

 test('default action sections are independent modules and saved choices remain intact', () => {
  const layout = normalizeLayout(null, SPECS);
  assert.equal(layout.items.filter(item => item.id === 'needs-hand').length, 1);
  assert.equal(layout.items.filter(item => item.id === 'next-actions').length, 1);
  assert.equal(layout.items.filter(item => item.id === 'reports').length, 1);
  const saved = layoutOf([{ id: 'projects', size: 'l' }]);
  assert.deepEqual(normalizeLayout(saved, SPECS).items, saved.items);
});

test('Open work by person is retired: no default or preset brings it back, and saved layouts drop it cleanly', () => {
  assert.ok(!DEFAULT_ITEMS.some(item => item.id === 'people'));
  for (const items of Object.values(PRESETS)) assert.ok(!items.some(item => item.id === 'people'));
  const available = SPECS.filter(spec => spec.id !== 'people'); // Home no longer registers the module
  const saved = { version: 1, items: [{ id: 'people', size: 'm' }, { id: 'up-next', size: 'm' }, { id: 'projects', size: 'l' }] };
  assert.deepEqual(normalizeLayout(saved, available).items, [{ id: 'up-next', size: 'm' }, { id: 'projects', size: 'l' }]);
});
