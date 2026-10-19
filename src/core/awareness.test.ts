import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityFor, attentionFor, awarenessCounts, SNOOZABLE } from './awareness.ts';
import { apply } from './engine.ts';
import { universalInbox } from './inbox.ts';
import { seedState } from './seed.ts';
import { notificationSource, notificationsFor } from '../app/notifications.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const workspace = { id: 'demo', name: 'Demo' };

function inboxFor(state: ReturnType<typeof seedState>, actor: string, read: Set<string>) {
  return universalInbox(actor, [notificationSource(notificationsFor(state, T0, actor), workspace)], read);
}

test('reading everything clears the inbox but never resolves attention', () => {
  const state = seedState(T0);
  for (const actor of ['jordan', 'maya', 'riley', 'sam', 'alex']) {
    const attention = attentionFor(state, T0, actor);
    const unread = inboxFor(state, actor, new Set());
    const allRead = inboxFor(state, actor, new Set(unread.items.map(item => item.id)));
    assert.equal(allRead.unread, 0, actor);
    assert.deepEqual(awarenessCounts(allRead.unread, attentionFor(state, T0, actor)).attention, awarenessCounts(unread.unread, attention).attention, `${actor}: attention is unchanged by reading`);
  }
  assert.ok(attentionFor(state, T0, 'jordan').items.length > 0, 'the demo has something to attend to');
});

test('attention leaves when its condition clears, not when it is read', () => {
  const state = seedState(T0);
  const item = attentionFor(state, T0, 'jordan').items.find(entry => entry.kind === 'missing-next-action' && entry.taskId);
  assert.ok(item, 'the demo has a task missing its next action');
  const task = state.tasks.find(entry => entry.id === item.taskId)!;
  const fixed = apply(state, { type: 'task/update', id: task.id, changes: { nextAction: 'Call the supplier' } }, { actor: 'jordan', now: T0 });
  assert.ok(fixed.ok);
  assert.equal(attentionFor(fixed.state, T0, 'jordan').items.some(entry => entry.id === item.id), false);
});

test('only deferrable kinds can be snoozed, and a snooze expires', () => {
  const state = seedState(T0);
  const all = attentionFor(state, T0, 'jordan').items;
  const snoozes = all.map(entry => ({ id: entry.id, until: T0 + 3_600_000 }));
  const after = attentionFor(state, T0, 'jordan', snoozes);
  assert.ok(after.items.every(entry => !SNOOZABLE.includes(entry.kind)), 'every remaining item is a kind that cannot be hidden');
  assert.equal(after.snoozed, all.filter(entry => SNOOZABLE.includes(entry.kind)).length);
  assert.equal(attentionFor(state, T0 + 7_200_000, 'jordan', snoozes).snoozed, 0, 'expired snoozes do nothing');
});

test('quick actions are offered only when the engine accepts them from this person', () => {
  const state = seedState(T0);
  for (const actor of ['jordan', 'maya', 'riley', 'sam', 'alex', 'abraham']) {
    for (const entry of attentionFor(state, T0, actor).items) {
      if (!entry.quick) continue;
      assert.ok(apply(state, entry.quick.do, { actor, now: T0, newId: () => 'x' }).ok, `${actor}: ${entry.quick.label}`);
    }
  }
  assert.ok(attentionFor(state, T0, 'abraham').items.every(entry => !entry.quick), 'the reviewer persona gets no quick actions');
});

test('activity is the event log, newest first, and is never an inbox item', () => {
  const state = seedState(T0);
  const moved = apply(state, { type: 'task/update', id: state.tasks[0]!.id, changes: { nextAction: 'Check the flashing' } }, { actor: 'maya', now: T0 + 1000 });
  assert.ok(moved.ok);
  const feed = activityFor(moved.state, 'jordan');
  assert.equal(feed[0]!.event.actor, 'maya');
  const inbox = inboxFor(moved.state, 'jordan', new Set());
  assert.equal(inbox.items.some(item => item.id === feed[0]!.event.id), false);
});
