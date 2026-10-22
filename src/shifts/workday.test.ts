import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entryPhase } from './workday.ts';

test('signed in and off-shift: viewing work is allowed and never needs a check-in', () => {
  assert.equal(entryPhase({ open: false, lateEodDue: false, viewingOffShift: false }), 'gate', 'first visit offers SOD and check-in');
  assert.equal(entryPhase({ open: false, lateEodDue: false, viewingOffShift: true }), 'work', 'choosing to view work opens it, off-shift');
  assert.equal(entryPhase({ open: true, lateEodDue: false, viewingOffShift: false }), 'work', 'an open shift goes straight to work');
  assert.equal(entryPhase({ open: false, lateEodDue: true, viewingOffShift: false }), 'gate', 'a missed EOD is offered first');
  assert.equal(entryPhase({ open: false, lateEodDue: true, viewingOffShift: true }), 'work', 'but never blocks viewing work');
});

test('only the explicit Clock in button starts a shift; entering, reading or opening tasks never does', () => {
  const sources = ['Workday.tsx', 'ShiftBridge.tsx', '../live/LiveRoot.tsx', '../app/App.tsx', '../app/TaskPage.tsx', '../app/TopBar.tsx']
    .map(file => readFileSync(new URL(file, import.meta.url), 'utf8'));
  for (const source of sources) assert.doesNotMatch(source, /check_in/, 'no check-in outside the shift module button');
  const module = readFileSync(new URL('ShiftModule.tsx', import.meta.url), 'utf8');
  assert.equal(module.match(/run\('check_in'/g)?.length, 1, 'exactly one check-in call, on the Clock in button');
});
