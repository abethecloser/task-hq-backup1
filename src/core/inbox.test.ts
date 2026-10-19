import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InboxItem, InboxSource } from './inbox.ts';
import { FUTURE_SOURCES, channelSource, channelsFor, linkTasks, postMessage, seedMessaging, universalInbox, workspacesOf } from './inbox.ts';
import { DEMO_PEOPLE, REVIEWER_PERSONA } from './seed.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const people = [...DEMO_PEOPLE, REVIEWER_PERSONA];
const sourcesFor = (state: ReturnType<typeof seedMessaging>) => state.workspaces.map(workspace => channelSource(state, workspace));

test('one inbox per person across every workspace they belong to — and only those', () => {
  const state = seedMessaging(T0, people);
  assert.deepEqual(workspacesOf(state, 'jordan').map(item => item.name), ['Quest Roofing', 'Quest Construction', 'Quest Drafting & Design']);
  const jordan = universalInbox('jordan', sourcesFor(state), new Set());
  assert.deepEqual(jordan.byWorkspace.map(item => item.workspace.name).sort(), ['Quest Construction', 'Quest Drafting & Design', 'Quest Roofing']);
  assert.ok(jordan.items.every(item => item.from !== 'jordan'), 'your own messages are not inbox items');
  // Alex is in Roofing and Construction only, and only in the channels he belongs to.
  const alex = universalInbox('alex', sourcesFor(state), new Set());
  assert.ok(alex.items.every(item => item.workspace.id !== 'demo-drafting'));
  assert.ok(alex.items.every(item => channelsFor(state, 'alex').some(channel => channel.id === item.channelId)));
  // The reviewer persona is in no channel and gets nothing.
  assert.equal(universalInbox('abraham', sourcesFor(state), new Set()).items.length, 0);
});

test('mentions are flagged for the mentioned person only and rise to the top while unread', () => {
  const state = seedMessaging(T0, people);
  const jordan = universalInbox('jordan', sourcesFor(state), new Set());
  const mentions = jordan.items.filter(item => item.kind === 'mention');
  assert.deepEqual(mentions.map(item => item.messageId).sort(), ['m2', 'm8']);
  assert.equal(jordan.items[0]!.kind, 'mention');
  const read = new Set(mentions.map(item => item.id));
  const after = universalInbox('jordan', sourcesFor(state), read);
  assert.equal(after.unread, jordan.unread - 2);
  assert.notEqual(after.items[0]!.kind, 'mention', 'read mentions no longer jump the queue');
});

test('no duplicates: the same record reached through two sources appears once; a mention wins over a plain copy', () => {
  const state = seedMessaging(T0, people);
  const extra: InboxSource = { id: 'mirror', label: 'Mirror', status: 'connected', note: '', items: person => sourcesFor(state).flatMap(source => source.items(person)).map(item => ({ ...item, kind: 'message', urgent: false }) as InboxItem) };
  const merged = universalInbox('jordan', [extra, ...sourcesFor(state)], new Set());
  const ids = merged.items.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(merged.items.find(item => item.messageId === 'm2')!.kind, 'mention');
  assert.equal(merged.items.length, universalInbox('jordan', sourcesFor(state), new Set()).items.length);
});

test('posting: members only, mentions resolve within the channel, empty and oversized messages refused', () => {
  const state = seedMessaging(T0, people);
  const refused = postMessage(state, 'riley', 'ch-field', 'hello', T0, 'x1');
  assert.equal(refused.ok, false, 'Riley is not in #field-operations');
  assert.equal(postMessage(state, 'abraham', 'ch-office', 'hi', T0, 'x2').ok, false, 'the reviewer is in no channel');
  assert.equal(postMessage(state, 'maya', 'ch-field', '   ', T0, 'x3').ok, false);
  assert.equal(postMessage(state, 'maya', 'ch-field', 'x'.repeat(2001), T0, 'x4').ok, false);
  const posted = postMessage(state, 'maya', 'ch-field', 'Ask @Alex and @alex again, and @Riley (not here), and @Maya (me)', T0, 'x5');
  assert.ok(posted.ok);
  assert.deepEqual(posted.message.mentions, ['alex'], 'deduplicated; outsiders and the author are not mentioned');
  const alex = universalInbox('alex', sourcesFor(posted.state), new Set());
  assert.equal(alex.items.find(item => item.messageId === 'x5')!.kind, 'mention');
  assert.equal(universalInbox('riley', sourcesFor(posted.state), new Set()).items.some(item => item.messageId === 'x5'), false);
});

test('a message turned into tasks keeps references only and adds one system line; future sources are reported, never faked', () => {
  const state = seedMessaging(T0, people);
  const linked = linkTasks(state, 'm4', ['task-1'], 'maya', T0, 'sys1', 'Maya made a task: “Mark the drop zone”.');
  assert.deepEqual(linked.messages.find(item => item.id === 'm4')!.taskIds, ['task-1']);
  const system = linked.messages.find(item => item.id === 'sys1')!;
  assert.equal(system.kind, 'system');
  assert.equal(universalInbox('alex', sourcesFor(linked), new Set()).items.some(item => item.messageId === 'sys1'), false, 'system lines are history, not inbox items');
  const inbox = universalInbox('jordan', [...sourcesFor(linked), ...FUTURE_SOURCES], new Set());
  assert.deepEqual(inbox.sources.filter(item => item.status === 'not-connected').map(item => item.id), ['questbase', 'whatsapp', 'email']);
});
