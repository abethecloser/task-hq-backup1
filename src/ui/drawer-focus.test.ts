import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawerFocusController } from './drawer-focus.ts';

function fixture() {
  let active = 'launcher', visible = true, closed = 0, restored = 0;
  const pending = new Map<number, () => void>();
  let sequence = 0;
  const controller = drawerFocusController({
    active: () => active,
    contains: item => ['panel', 'close', 'input', 'send'].includes(item ?? ''),
    items: () => visible ? ['close', 'input', 'send'] : [],
    initial: () => visible ? 'input' : undefined,
    panel: 'panel', focus: item => { if (visible) active = item; },
    close: () => closed++, restore: () => { active = 'launcher'; restored++; },
  }, { request: fn => { pending.set(++sequence, fn); return sequence; }, cancel: id => { pending.delete(id); } });
  return { controller, pending,
    set active(value: string) { active = value; }, get active() { return active; },
    set visible(value: boolean) { visible = value; }, get closed() { return closed; }, get restored() { return restored; },
    tick() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); },
  };
}
function key(key: string, shiftKey = false) {
  return { key, shiftKey, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
}

test('initial focus retries after a hidden opening frame and reaches the preferred input', () => {
  const f = fixture(); f.visible = false; f.controller.enter();
  assert.equal(f.active, 'launcher'); assert.equal(f.pending.size, 1);
  f.visible = true; f.tick(); assert.equal(f.active, 'input');
});
test('the panel fallback gives way to a real control after opening', () => {
  const f = fixture(); f.active = 'panel'; f.controller.enter(); assert.equal(f.active, 'input');
});
test('Tab and reverse Tab cannot leave the first or last drawer control', () => {
  const f = fixture(); f.active = 'send';
  const tab = key('Tab'); f.controller.key(tab);
  assert.equal(f.active, 'close'); assert.ok(tab.prevented && tab.stopped);
  const reverse = key('Tab', true); f.controller.key(reverse);
  assert.equal(f.active, 'send'); assert.ok(reverse.prevented && reverse.stopped);
});
test('focus that escaped or a removed detail control is recovered inside the panel', () => {
  const f = fixture(); f.active = 'overview'; f.controller.enter(); assert.equal(f.active, 'input');
  f.active = 'removed-detail'; f.controller.key(key('Tab', true)); assert.equal(f.active, 'send');
});
test('Escape closes even from the launcher and stops the underlying page handler', () => {
  const f = fixture(), escape = key('Escape'); f.controller.key(escape);
  assert.equal(f.closed, 1); assert.ok(escape.prevented && escape.stopped);
});
test('closure cancels delayed focus, restores the launcher once and releases keyboard handling', () => {
  const f = fixture(); f.visible = false; f.controller.enter(); f.controller.dispose(); f.controller.dispose();
  assert.equal(f.pending.size, 0); assert.equal(f.restored, 1);
  f.visible = true; f.tick(); f.controller.key(key('Tab')); f.controller.key(key('Escape'));
  assert.equal(f.active, 'launcher'); assert.equal(f.closed, 0);
  const reopened = fixture(); reopened.controller.enter(); assert.equal(reopened.active, 'input');
});
