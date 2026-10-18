import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { seedState } from './seed.ts';
import { compose } from './compose.ts';
import { resolveContext } from './deck.ts';
import { normalize } from './migrate.ts';
import { memoryMediaStore } from '../adapter/media.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action, now = T0) => apply(state, action, { actor, now, newId: () => `f${++n}` });
const ok = (state: QuestState, actor: string, action: Action, now = T0) => { const r = run(state, actor, action, now); assert.ok(r.ok, r.ok ? '' : r.error); return r.state; };

const consent = (by: string) => ({ consentBy: by, consentAt: T0 - 1000 });

test('reviewer can only use feedback actions — every operational action and reset is refused', () => {
  const state = seedState(T0);
  const refused: Action[] = [
    { type: 'demo/reset' },
    { type: 'task/create', task: { title: 'x' } },
    { type: 'task/advance', id: 'shingle-order' },
    { type: 'task/request-help', id: 'safety-brief', note: 'x' },
    { type: 'task/update', id: 'safety-brief', changes: { nextAction: 'x' } },
    { type: 'lead/receive', lead: { name: 'x', source: 'x', phone: 'x', address: 'x', need: 'x' } },
    { type: 'lead/assign', id: 'lead-okafor', to: 'abraham' },
    { type: 'lead/attempt', id: 'lead-okafor', channel: 'phone', outcome: 'reached' },
    { type: 'ultra/activate', taskId: 'safety-brief' },
    { type: 'policy/update', changes: { grantSeconds: 30 } },
    { type: 'invite/draft', email: 'someone@example.com', days: 7 },
    { type: 'feedback/convert', id: 'none' },
  ];
  for (const action of refused) {
    const result = run(state, 'abraham', action);
    assert.equal(result.ok, false, action.type);
    if (action.type !== 'feedback/convert') assert.match(result.ok ? '' : result.error, /Reviewers can view Task-HQ and leave feedback/, action.type);
  }
  // Composed surfaces and deck offer the reviewer nothing operational.
  assert.equal(compose(state, 'abraham', T0).primary.kind, 'clear');
  assert.equal(resolveContext(state, 'abraham', { leadId: 'lead-okafor' }, T0).actions.length, 0);
  assert.equal(resolveContext(state, 'abraham', { taskId: 'staging-area' }, T0).actions.length, 0);
});

test('reviewers can never be given operational work', () => {
  const state = seedState(T0);
  assert.equal(run(state, 'jordan', { type: 'task/update', id: 'shingle-order', changes: { owner: 'abraham' } }).ok, false);
  assert.equal(run(state, 'sam', { type: 'lead/assign', id: 'lead-okafor', to: 'abraham' }).ok, false);
  assert.equal(run(state, 'maya', { type: 'task/handoff', id: 'warranty-docs', to: 'abraham' }).ok, false);
  assert.equal(run(state, 'jordan', { type: 'policy/update', changes: { ultraApprovers: ['reviewer'] } }).ok, false);
});

test('feedback: attribution, context, replies keep the original intact, status rules, attachments need consent', async () => {
  let state = seedState(T0);
  state = ok(state, 'abraham', { type: 'feedback/create', item: { category: 'issue', title: 'Handoff animation too fast', body: 'I missed who it went to.', context: { view: 'My Work', route: '#/my-work', taskId: 'staging-area', version: '0.3.0', viewport: '1280x800', secret: 'nope' } as never } });
  const item = state.feedback[0]!;
  assert.equal(item.author, 'abraham');
  assert.equal(item.status, 'open');
  assert.equal(item.context.taskId, 'staging-area');
  assert.deepEqual(Object.keys(item.context).sort(), ['deck', 'leadId', 'route', 'taskId', 'version', 'view', 'viewport']);

  state = ok(state, 'jordan', { type: 'feedback/reply', id: item.id, body: 'Good catch — slowing it down.' });
  state = ok(state, 'abraham', { type: 'feedback/reply', id: item.id, body: 'Thanks.' });
  assert.equal(state.feedback[0]!.body, 'I missed who it went to.', 'original body unchanged');
  assert.deepEqual(state.feedback[0]!.replies.map(reply => reply.by), ['jordan', 'abraham']);

  assert.equal(run(state, 'abraham', { type: 'feedback/status', id: item.id, status: 'reviewing' }).ok, false, 'reviewer cannot triage');
  state = ok(state, 'maya', { type: 'feedback/status', id: item.id, status: 'reviewing' });

  const media = memoryMediaStore();
  const mediaId = await media.put(new Blob(['png-bytes'], { type: 'image/png' }));
  const shot = { kind: 'screenshot' as const, mediaId, mime: 'image/png', bytes: 9, durationMs: 0, annotated: true };
  assert.equal(run(state, 'abraham', { type: 'feedback/attach', id: item.id, attachment: { ...shot, consentBy: '', consentAt: 0 } }).ok, false, 'no consent, no attachment');
  assert.equal(run(state, 'jordan', { type: 'feedback/attach', id: item.id, attachment: { ...shot, ...consent('jordan') } }).ok, false, 'only the author attaches');
  state = ok(state, 'abraham', { type: 'feedback/attach', id: item.id, attachment: { ...shot, ...consent('abraham') } });
  const recording = { kind: 'recording' as const, mediaId: await media.put(new Blob(['webm'], { type: 'video/webm' })), mime: 'video/webm', bytes: 4, durationMs: 12_000, annotated: false, ...consent('abraham') };
  state = ok(state, 'abraham', { type: 'feedback/attach', id: item.id, attachment: recording });
  const attached = state.feedback[0]!.attachments;
  assert.deepEqual(attached.map(a => a.kind), ['screenshot', 'recording']);
  assert.ok(await media.get(attached[0]!.mediaId), 'media retrievable by id');
  assert.ok(!JSON.stringify(state).includes('png-bytes'), 'media bytes never stored in Task-HQ state');

  state = ok(state, 'abraham', { type: 'feedback/status', id: item.id, status: 'resolved' });
  assert.equal(state.feedback[0]!.status, 'resolved');
});

test('convert: manager only, creates a linked development task in the product project, original kept', () => {
  let state = seedState(T0);
  state = ok(state, 'abraham', { type: 'feedback/create', item: { category: 'idea', title: 'Show the lead source as an icon', body: 'Faster to scan.', context: { view: 'Speed to Lead' } } });
  const id = state.feedback[0]!.id;
  assert.equal(run(state, 'abraham', { type: 'feedback/convert', id }).ok, false);
  assert.equal(run(state, 'maya', { type: 'feedback/convert', id }).ok, false);
  state = ok(state, 'jordan', { type: 'feedback/convert', id });
  const item = state.feedback[0]!;
  const task = state.tasks.find(entry => entry.id === item.linkedTaskId)!;
  assert.equal(task.projectId, 'quest-product');
  assert.match(task.title, /Idea: Show the lead source/);
  assert.equal(item.body, 'Faster to scan.');
  assert.equal(run(state, 'jordan', { type: 'feedback/convert', id }).ok, false, 'no duplicate tasks');
});

test('invitation drafts: manager only, verified-looking email, expiry, revocable, never sent', () => {
  let state = seedState(T0);
  assert.equal(run(state, 'maya', { type: 'invite/draft', email: 'reviewer@example.com', days: 7 }).ok, false);
  assert.equal(run(state, 'jordan', { type: 'invite/draft', email: 'not-an-email', days: 7 }).ok, false);
  assert.equal(run(state, 'jordan', { type: 'invite/draft', email: 'reviewer@example.com', days: 90 }).ok, false);
  const drafted = run(state, 'jordan', { type: 'invite/draft', email: 'Reviewer@Example.com', days: 7 });
  assert.ok(drafted.ok && /Nothing was sent/.test(drafted.message));
  state = drafted.state;
  assert.equal(state.invites[0]!.email, 'reviewer@example.com');
  assert.equal(state.invites[0]!.expiresAt, T0 + 7 * 86_400_000);
  state = ok(state, 'jordan', { type: 'invite/revoke', id: state.invites[0]!.id });
  assert.equal(state.invites[0]!.status, 'revoked');
});

test('older saved data gains feedback fields and the reviewer persona without losing anything', () => {
  const old = seedState(T0) as Partial<QuestState>;
  delete old.feedback; delete old.invites;
  old.people = old.people!.filter(item => item.role !== 'reviewer');
  old.tasks = [...old.tasks!];
  const normalized = normalize(old as QuestState);
  assert.deepEqual(normalized.feedback, []);
  assert.deepEqual(normalized.invites, []);
  assert.ok(normalized.people.some(item => item.id === 'abraham' && item.role === 'reviewer'));
  assert.equal(normalized.tasks.length, old.tasks.length);
});

test('feedback is allowed during Critical Focus', () => {
  let state = ok(seedState(T0), 'jordan', { type: 'ultra/activate', taskId: 'maple-tarp' });
  state = ok(state, 'alex', { type: 'feedback/create', item: { category: 'question', title: 'Can I see the estimate from here?', body: '', context: { view: 'Critical Focus' } } });
  assert.equal(state.feedback[0]!.author, 'alex');
});
