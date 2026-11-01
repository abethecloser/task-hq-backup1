import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNavMode, splitNavigation } from './nav-mode.ts';

const NAV = ['home', 'calendar', 'all-tasks', 'inbox', 'reports', 'needs-attention', 'company-work', 'people', 'executive', 'activity', 'archive', 'settings', 'workbook'].map(id => ({ id }));

test('the dock is the default; ?nav=classic is a remembered rollback path, ?nav=dock returns to the default', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  assert.equal(readNavMode('', storage), 'dock');
  assert.equal(readNavMode('?demo', storage), 'dock');
  assert.equal(readNavMode('?demo&nav=classic', storage), 'classic');
  assert.equal(readNavMode('', storage), 'classic', 'rollback remembered on this device');
  assert.equal(readNavMode('?nav=dock', storage), 'dock');
  assert.equal(readNavMode('', storage), 'dock', 'back to the default');
  assert.equal(readNavMode('', null), 'dock');
  const old = new Map([['taskhq.nav', 'dock']]);
  assert.equal(readNavMode('', { getItem: k => old.get(k) ?? null, setItem: () => {}, removeItem: () => {} }), 'dock', 'earlier preview opt-in still reads as the dock');
});

test('exactly five primary destinations, Home in the centre; everything else reachable once, never repeated', () => {
  const { dock, rail } = splitNavigation(NAV);
  assert.deepEqual(dock, ['all-tasks', 'company-work', 'home', 'calendar', 'inbox']);
  const all = [...dock, ...rail.map(item => item.id)];
  assert.deepEqual([...all].sort(), NAV.map(item => item.id).sort());
  assert.equal(new Set(all).size, all.length, 'no duplicates');
  assert.ok(rail.some(item => item.id === 'reports'), 'Reports is a rail shortcut');
  // A destination this person can't use is simply absent, not an empty slot.
  assert.deepEqual(splitNavigation(NAV.filter(item => item.id !== 'calendar')).dock, ['all-tasks', 'company-work', 'home', 'inbox']);
});
