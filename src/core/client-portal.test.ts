import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from './engine.ts';
import { seedState } from './seed.ts';
import { channelSource, seedMessaging, universalInbox } from './inbox.ts';
import { CLIENT_INPUT_TAG, CLIENT_SHARE_TAG, DEMO_CLIENT, DEMO_CLIENT_TEAM, authorize, clientWorkspace, ensureClientSpace, submitQuest } from './client-portal.ts';
import type { QuestState } from './contract.ts';

const NOW = Date.parse('2026-10-27T15:00:00Z');

function world() {
  const state: QuestState = seedState(NOW);
  const tag = (id: string, tags: string[]) => { const task = state.tasks.find(item => item.id === id)!; task.tags = tags; };
  tag('site-plan', [CLIENT_SHARE_TAG]);
  tag('staging-area', [CLIENT_SHARE_TAG, CLIENT_INPUT_TAG]);
  tag('permit-update', [CLIENT_SHARE_TAG]);
  // Same tag on another project's task must not cross over.
  tag('maple-tarp', [CLIENT_SHARE_TAG]);
  const messaging = ensureClientSpace(seedMessaging(NOW, state.people), DEMO_CLIENT, DEMO_CLIENT_TEAM, NOW);
  return { state, messaging };
}

test('a client enters only a project they hold a grant for', () => {
  assert.equal(authorize([DEMO_CLIENT], DEMO_CLIENT.person, 'northside').ok, true);
  assert.equal(authorize([DEMO_CLIENT], DEMO_CLIENT.person, 'maple').ok, false);
  assert.equal(authorize([DEMO_CLIENT], 'someone-else', 'northside').ok, false);
});

test('only tasks the team tagged for the client, in the client’s project, are shared', () => {
  const { state, messaging } = world();
  const view = clientWorkspace(state, messaging, DEMO_CLIENT);
  assert.equal(view.project.name, 'Northside re-roof');
  assert.deepEqual(view.tasks.map(task => task.id).sort(), ['permit-update', 'site-plan', 'staging-area']);
  assert.deepEqual(view.progress, { done: 1, total: 3, percent: 33 });
  assert.deepEqual(view.next.map(task => task.id).sort(), ['permit-update', 'staging-area']);
  assert.ok(view.input.some(item => item.taskId === 'staging-area'));
});

test('internal notes, descriptions, other channels and internal tasks never reach the client', () => {
  let { state, messaging } = world();
  const result = apply(state, { type: 'task/comment', id: 'staging-area', note: 'INTERNAL margin is thin on this one' }, { actor: 'jordan', now: NOW + 1000, newId: () => 'c1' });
  assert.ok(result.ok);
  state = result.state;
  const view = clientWorkspace(state, messaging, DEMO_CLIENT);
  const text = JSON.stringify(view);
  for (const secret of ['INTERNAL', 'revised site address', 'Walk the driveway', 'crew handoff', 'Tarp the Maple', 'drop zone marked', 'Logged 14 calls'])
    assert.equal(text.includes(secret), false, secret);
  // A message in a channel the client isn't in stays out even if it names the project.
  assert.equal(view.conversation.every(item => item.id.startsWith(DEMO_CLIENT.channelId)), true);
  // Losing channel membership removes the conversation.
  messaging = { ...messaging, channels: messaging.channels.map(item => item.id === DEMO_CLIENT.channelId ? { ...item, members: item.members.filter(id => id !== DEMO_CLIENT.person) } : item) };
  assert.deepEqual(clientWorkspace(state, messaging, DEMO_CLIENT).conversation, []);
});

test('progress updates come from actions, not from event text', () => {
  const { state, messaging } = world();
  const result = apply(state, { type: 'task/advance', id: 'staging-area' }, { actor: 'maya', now: NOW + 5000, newId: () => 'e1' });
  assert.ok(result.ok);
  const updates = clientWorkspace(result.state, messaging, DEMO_CLIENT).updates.filter(item => item.taskId === 'staging-area');
  assert.ok(updates.length > 0);
  assert.ok(updates.every(item => ['planned', 'started', 'review', 'completed', 'reopened'].includes(item.kind)));
});

test('New Quest posts to the project channel and reaches the team inbox, not the task list', () => {
  const { state, messaging } = world();
  const attachment = { id: 'a1', name: 'gutter.jpg', mime: 'image/jpeg', bytes: 1200, mediaId: 'm1' };
  const sent = submitQuest(messaging, DEMO_CLIENT, { kind: 'issue', text: 'Water near the back gutter.', attachments: [attachment] }, NOW + 60_000, 'q1');
  assert.ok(sent.ok);
  assert.equal(sent.message.quest, 'issue');
  assert.equal(sent.message.author, DEMO_CLIENT.person);
  assert.equal(sent.message.channelId, DEMO_CLIENT.channelId);
  const workspace = sent.state.workspaces.find(item => item.id === DEMO_CLIENT.workspaceId)!;
  const inbox = universalInbox('maya', [channelSource(sent.state, workspace)], new Set());
  const item = inbox.items.find(entry => entry.messageId === 'q1');
  assert.ok(item && item.urgent && /New Quest · Issue/.test(item.title));
  // Riley isn't in the client channel, so nothing reaches them.
  assert.equal(universalInbox('riley', [channelSource(sent.state, workspace)], new Set()).items.some(entry => entry.messageId === 'q1'), false);
  assert.equal(state.tasks.length, seedState(NOW).tasks.length);
  const view = clientWorkspace(state, sent.state, DEMO_CLIENT);
  assert.deepEqual(view.files.map(file => file.attachment.name), ['gutter.jpg']);
  assert.equal(view.conversation.at(-1)?.mine, true);
});

test('New Quest refuses empty sends and other projects’ channels', () => {
  const { messaging } = world();
  assert.equal(submitQuest(messaging, DEMO_CLIENT, { kind: 'question', text: '  ' }, NOW, 'q2').ok, false);
  assert.equal(submitQuest(messaging, { ...DEMO_CLIENT, channelId: 'ch-office' }, { kind: 'question', text: 'Hello' }, NOW, 'q3').ok, false);
});

test('ensureClientSpace is idempotent', () => {
  const { messaging } = world();
  const again = ensureClientSpace(messaging, DEMO_CLIENT, DEMO_CLIENT_TEAM, NOW + 1);
  assert.equal(again, messaging);
});
