import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PULLOUTS_CLOSED, bothFit, closeTemporaryRight, openTemporaryRight, openPullout, pulloutMode, togglePullout } from './layout.ts';
import type { PulloutRoom } from './layout.ts';

const room = (over: Partial<PulloutRoom> = {}): PulloutRoom => ({ viewport: 1600, mobile: false, calendarWidth: 288, notificationsWidth: 360, minCanvasBoth: 480, minCanvas: 600, ...over });

test('both pullouts start closed', () => {
  assert.deepEqual(PULLOUTS_CLOSED, { calendar: false, notifications: false });
  assert.equal(pulloutMode('calendar', PULLOUTS_CLOSED, room()), 'closed');
  assert.equal(pulloutMode('notifications', PULLOUTS_CLOSED, room()), 'closed');
});

test('on a wide desktop both can be open while the center stays usable', () => {
  const wide = room({ viewport: 1600 });
  assert.ok(bothFit(wide));
  const both = openPullout({ calendar: true, notifications: false }, 'notifications', wide);
  assert.deepEqual(both, { calendar: true, notifications: true });
  assert.equal(pulloutMode('calendar', both, wide), 'docked');
  assert.equal(pulloutMode('notifications', both, wide), 'docked');
});

test('when the center would get too narrow, opening one closes the other', () => {
  const tight = room({ viewport: 1100 });
  assert.ok(!bothFit(tight));
  assert.deepEqual(openPullout({ calendar: true, notifications: false }, 'notifications', tight), { calendar: false, notifications: true });
  assert.deepEqual(openPullout({ calendar: false, notifications: true }, 'calendar', tight), { calendar: true, notifications: false });
});

test('the boundary is exact: one pixel short closes the other', () => {
  const edge = 56 + 288 + 360 + 480;
  assert.ok(bothFit(room({ viewport: edge })));
  assert.ok(!bothFit(room({ viewport: edge - 1 })));
});

test('on a phone only one panel is open at a time, always as a full-screen drawer', () => {
  const phone = room({ viewport: 390, mobile: true });
  assert.ok(!bothFit(phone));
  const afterBell = openPullout({ calendar: true, notifications: false }, 'notifications', phone);
  assert.deepEqual(afterBell, { calendar: false, notifications: true });
  assert.equal(pulloutMode('notifications', afterBell, phone), 'drawer');
});

test('a single pullout that cannot dock beside a usable center shows over it instead', () => {
  const narrow = room({ viewport: 900 });
  assert.equal(pulloutMode('notifications', { calendar: false, notifications: true }, narrow), 'drawer');
  const medium = room({ viewport: 1100 });
  assert.equal(pulloutMode('notifications', { calendar: false, notifications: true }, medium), 'docked');
});

test('toggling closes an open pullout without touching the other', () => {
  const wide = room();
  const both = { calendar: true, notifications: true };
  assert.deepEqual(togglePullout(both, 'calendar', wide), { calendar: false, notifications: true });
  assert.deepEqual(togglePullout({ calendar: false, notifications: false }, 'calendar', wide), { calendar: true, notifications: false });
});

test('1024px temporary Notifications restores Calendar after mutual exclusion', () => {
  const desktop = room({ viewport: 1024, notificationsWidth: 288 });
  const opened = openTemporaryRight({ calendar: true, notifications: false }, desktop);
  assert.deepEqual(opened.next, { calendar: false, notifications: true });
  assert.equal(opened.restoreCalendar, true);
  assert.deepEqual(closeTemporaryRight(opened.next, opened.restoreCalendar, desktop), { calendar: true, notifications: false });
});
test('Calendar initially closed is never opened by closing Notifications', () => {
  const desktop = room({ viewport: 1024 });
  const opened = openTemporaryRight(PULLOUTS_CLOSED, desktop);
  assert.equal(opened.restoreCalendar, false);
  assert.deepEqual(closeTemporaryRight(opened.next, opened.restoreCalendar, desktop), PULLOUTS_CLOSED);
});
test('switching right panels retains the pending Calendar restoration', () => {
  const desktop = room({ viewport: 1024 });
  const first = openTemporaryRight({ calendar: true, notifications: false }, desktop);
  const second = openTemporaryRight(first.next, desktop);
  assert.deepEqual(closeTemporaryRight(second.next, first.restoreCalendar || second.restoreCalendar, desktop), { calendar: true, notifications: false });
});
test('wide desktop keeps Calendar open; mobile never restores a desktop split panel', () => {
  const wide = room();
  const opened = openTemporaryRight({ calendar: true, notifications: false }, wide);
  assert.equal(opened.restoreCalendar, false);
  assert.deepEqual(closeTemporaryRight(opened.next, false, wide), { calendar: true, notifications: false });
  assert.deepEqual(closeTemporaryRight({ calendar: false, notifications: true }, true, room({ viewport: 375, mobile: true })), PULLOUTS_CLOSED);
});
