import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNavMode, splitNavigation } from './nav-mode.ts';

const NAV = ['home', 'calendar', 'all-tasks', 'inbox', 'reports', 'needs-attention', 'company-work', 'people', 'executive', 'activity', 'archive', 'settings', 'workbook'].map(id => ({ id }));

test('dock mode is opt-in, remembered, and reversible from the URL', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(readNavMode('', storage), 'classic');
  assert.equal(readNavMode('?demo&nav=dock', storage), 'dock');
  assert.equal(readNavMode('?demo', storage), 'dock', 'remembered');
  assert.equal(readNavMode('?nav=classic', storage), 'classic');
  assert.equal(readNavMode('', storage), 'classic');
  assert.equal(readNavMode('', null), 'classic');
});

test('every destination is reachable, and no surface repeats another', () => {
  for (const mobile of [false, true]) {
    const { dock, more, rail } = splitNavigation(NAV, mobile);
    assert.deepEqual(dock, ['all-tasks', 'company-work', 'home', 'calendar', 'inbox'], 'Home is the centre anchor');
    const all = [...dock, ...more.map(item => item.id), ...rail.map(item => item.id)];
    assert.deepEqual([...all].sort(), NAV.map(item => item.id).sort(), mobile ? 'phone' : 'wide');
    assert.equal(new Set(all).size, all.length, 'no duplicates');
    assert.ok(more.some(item => item.id === 'reports'), 'Reports lives in More');
  }
  assert.deepEqual(splitNavigation(NAV, false).rail.map(item => item.id), ['people', 'settings']);
  assert.deepEqual(splitNavigation(NAV, true).rail, [], 'phones have no rail');
  // A destination this person can't use is simply absent, not an empty slot.
  assert.deepEqual(splitNavigation(NAV.filter(item => item.id !== 'calendar'), false).dock, ['all-tasks', 'company-work', 'home', 'inbox']);
});
