import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCK_RAIL, DOCK_STORAGE_KEY, clampDock, loadDockPreference, nearestSnap, saveDockPreference, snapHeights, stepSnap, withSnap } from './dock-size.ts';

const memory = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); }, data };
};

test('snap heights ascend and leave the center its minimum', () => {
  for (const avail of [420, 600, 784, 1200]) {
    const h = snapHeights(avail);
    assert.equal(h.collapsed, DOCK_RAIL);
    assert.ok(h.collapsed < h.default && h.default < h.half && h.half < h.expanded && h.expanded < h.full, `${avail}: ${JSON.stringify(h)}`);
    assert.ok(h.expanded <= avail - 88);
    assert.equal(h.full, avail);
  }
  const h = snapHeights(784);
  assert.ok(h.default / 784 > 0.3 && h.default / 784 < 0.36);
  assert.equal(h.half, 392);
});

test('release snaps to the nearest position; clamp keeps a drag in range', () => {
  assert.equal(nearestSnap(60, 784), 'collapsed');
  assert.equal(nearestSnap(270, 784), 'default');
  assert.equal(nearestSnap(400, 784), 'half');
  assert.equal(nearestSnap(560, 784), 'expanded');
  assert.equal(nearestSnap(770, 784), 'full');
  assert.equal(clampDock(10, 784), DOCK_RAIL);
  assert.equal(clampDock(5000, 784), 784);
});

test('keyboard steps stop at the ends', () => {
  assert.equal(stepSnap('collapsed', -1), 'collapsed');
  assert.equal(stepSnap('default', 1), 'half');
  assert.equal(stepSnap('expanded', 1), 'full');
  assert.equal(stepSnap('full', 1), 'full');
});

test('preference round-trips under quest-dock-height and remembers the last open position', () => {
  const store = memory();
  assert.deepEqual(loadDockPreference(store), { snap: 'collapsed', last: 'default' });
  const half = withSnap({ snap: 'collapsed', last: 'default' }, 'half');
  const closed = withSnap(half, 'collapsed');
  assert.deepEqual(closed, { snap: 'collapsed', last: 'half' });
  saveDockPreference(store, closed);
  assert.ok(store.data.has(DOCK_STORAGE_KEY));
  assert.deepEqual(loadDockPreference(store), closed);
});

test('the earlier open flag migrates once; bad data falls back', () => {
  const store = memory({ 'taskhq.collab-dock': 'open' });
  assert.deepEqual(loadDockPreference(store), { snap: 'default', last: 'default' });
  assert.equal(store.data.has('taskhq.collab-dock'), false);
  assert.deepEqual(loadDockPreference(memory({ [DOCK_STORAGE_KEY]: '{"snap":"huge"}' })), { snap: 'collapsed', last: 'default' });
  assert.deepEqual(loadDockPreference(memory({ [DOCK_STORAGE_KEY]: 'not json' })), { snap: 'collapsed', last: 'default' });
});
