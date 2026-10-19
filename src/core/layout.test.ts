import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAIL, panelLayout } from './layout.ts';
import type { PanelInput } from './layout.ts';

const DECK = 288;
const TASK = 420;
const base: PanelInput = { viewport: 1440, mobile: false, leftOpen: false, leftWidth: 288, leftMin: 232, rightOpen: false, rightWidth: DECK, minCanvas: 600, minCanvasBoth: 480 };
const canvas = (input: PanelInput) => { const out = panelLayout(input); return input.viewport - RAIL - out.left - (out.right === 'docked' ? input.rightWidth : 0); };

test('desktop: all four combinations of the left and right panels', () => {
  assert.deepEqual(panelLayout({ ...base, leftOpen: true, rightOpen: true }), { left: 288, right: 'docked' });
  assert.deepEqual(panelLayout({ ...base, leftOpen: true }), { left: 288, right: 'closed' });
  assert.deepEqual(panelLayout({ ...base, rightOpen: true }), { left: 0, right: 'docked' });
  assert.deepEqual(panelLayout({ ...base }), { left: 0, right: 'closed' });
});

test('opening one panel never closes the other on desktop', () => {
  for (const viewport of [761, 900, 1024, 1180, 1280, 1366, 1440, 1920]) {
    for (const rightWidth of [DECK, TASK]) for (const leftWidth of [232, 288, 420]) {
      const right = panelLayout({ ...base, viewport, rightWidth, leftWidth, rightOpen: true });
      const both = panelLayout({ ...base, viewport, rightWidth, leftWidth, rightOpen: true, leftOpen: true });
      assert.notEqual(both.right, 'closed', `${viewport}px: the right panel stays open when the left opens`);
      assert.ok(both.left > 0, `${viewport}px: the left panel stays open when the right opens`);
      // Opening the left panel may move the right panel from docked to a drawer only when even the narrowest left panel leaves no room.
      if (right.right === 'docked' && both.right !== 'docked') assert.ok(viewport - RAIL - Math.min(232, leftWidth) - rightWidth < 480);
      if (both.right === 'docked') assert.ok(canvas({ ...base, viewport, rightWidth, leftWidth, rightOpen: true, leftOpen: true }) >= 480, 'the canvas keeps its minimum');
    }
  }
});

test('when room is short the left panel gives up width first, then the right panel overlays', () => {
  // A typical laptop window: both stay docked, and the left panel narrows before anything else gives way.
  assert.deepEqual(panelLayout({ ...base, viewport: 1143, leftOpen: true, rightOpen: true }), { left: 288, right: 'docked' });
  assert.deepEqual(panelLayout({ ...base, viewport: 1143, leftWidth: 420, leftOpen: true, rightOpen: true }), { left: 319, right: 'docked' });
  // A task (wider) beside an open left panel on the same window: the task overlays as a drawer, the left panel stays.
  assert.deepEqual(panelLayout({ ...base, viewport: 1143, leftOpen: true, rightOpen: true, rightWidth: TASK }), { left: 288, right: 'drawer' });
  assert.deepEqual(panelLayout({ ...base, viewport: 900, leftOpen: true, rightOpen: true }), { left: 288, right: 'drawer' });
  // Left closed keeps the original single-panel rule (600px canvas).
  assert.deepEqual(panelLayout({ ...base, viewport: 900, rightOpen: true }), { left: 0, right: 'drawer' });
});

test('mobile: both panels are drawers and nothing is reserved', () => {
  assert.deepEqual(panelLayout({ ...base, viewport: 390, mobile: true, leftOpen: true, rightOpen: true }), { left: 0, right: 'drawer' });
  assert.deepEqual(panelLayout({ ...base, viewport: 390, mobile: true, leftOpen: true }), { left: 0, right: 'closed' });
});
