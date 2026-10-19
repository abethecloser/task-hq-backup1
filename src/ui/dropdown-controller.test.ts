import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropdownController } from './dropdown-controller.ts';

function fixture() {
  let callback: (() => void) | undefined, closed = 0, protectedFocus = false, scheduled = 0;
  const menu = dropdownController(() => closed++, () => protectedFocus, {
    set: fn => { callback = fn; scheduled++; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clear: () => { callback = undefined; },
  });
  return { menu, tick: () => { const fn = callback; callback = undefined; fn?.(); }, protect: (value: boolean) => { protectedFocus = value; menu.focusChanged(); }, get closed() { return closed; }, get scheduled() { return scheduled; } };
}
test('leaving schedules one delayed close; re-entry cancels it without flicker', () => {
  const f = fixture();
  f.menu.leave(); f.menu.leave(); assert.equal(f.scheduled, 1); assert.equal(f.closed, 0);
  f.menu.enter(); f.tick(); assert.equal(f.closed, 0);
  f.menu.leave(); f.tick(); assert.equal(f.closed, 1);
});
test('typing and keyboard focus protect the dropdown; leaving focus resumes dismissal', () => {
  const f = fixture(); f.protect(true); f.menu.leave(); f.tick(); assert.equal(f.closed, 0);
  f.protect(false); f.tick(); assert.equal(f.closed, 1);
});
test('focus acquired during the grace period cancels closing', () => {
  const f = fixture(); f.menu.leave(); f.protect(true); f.tick(); assert.equal(f.closed, 0);
});
test('outside tap and Escape dismiss immediately even when focus is protected; disposal cancels timers', () => {
  const f = fixture(); f.protect(true); f.menu.dismiss(); assert.equal(f.closed, 1);
  f.protect(false); f.menu.leave(); f.menu.dispose(); f.tick(); assert.equal(f.closed, 1);
});
test('touch and pen movement never schedule hover dismissal; outside taps still close', () => {
  const f = fixture();
  f.menu.pointerMove(false, 'touch'); f.menu.pointerMove(false, 'pen'); f.tick();
  assert.equal(f.scheduled, 0); assert.equal(f.closed, 0);
  f.menu.dismiss(); assert.equal(f.closed, 1);
});
