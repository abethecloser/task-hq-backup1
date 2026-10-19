import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackEngine, FEEDBACK, coalesceFeedback, feedbackSignature } from './feedback.ts';
import { apply } from './engine.ts';
import { blankLead, blankTask, seedState } from './seed.ts';
const now = Date.parse('2026-10-18T12:00:00Z');
test('acknowledgment and processing never fabricate success; accepted and denied results follow the engine', () => {
  const state = seedState(now), engine = createFeedbackEngine();
  const action = { type: 'task/create' as const, task: { title: 'Synthetic task' } };
  const c = engine.begin(action, now); assert.equal(c.phase, 'acknowledged');
  assert.equal(engine.processing(c).phase, 'processing');
  const r = apply(state, action, { actor: 'jordan', now, newId: () => 'created' }); assert.ok(r.ok);
  const cue = engine.settle(c, action, state, { ok: true, state: r.state, eventId: r.event?.id }, now + 100);
  assert.equal(cue.signature, 'task-created'); assert.equal(cue.phase, 'confirmed');
  const denial = engine.settle(c, action, state, { ok: false, error: 'Only a manager may do this.' }, now);
  assert.equal(denial.phase, 'denied'); assert.equal(denial.signature, 'denied');
  assert.equal(engine.settle(c, action, state, { ok: false, error: 'Server response could not be confirmed.' }, now).phase, 'failed');
});
test('new cross-user deliveries are distinct; baseline, duplicates, reconnect and old replay are silent', () => {
  let stored: string[] = [], state = seedState(now);
  const storage = { load: () => stored, save: (s: string[]) => { stored = s; } };
  const engine = createFeedbackEngine(storage); assert.deepEqual(engine.observe(state, 'jordan', now), []);
  const next = { ...state, events: [{ id: 'remote', kind: 'handoff' as const, actor: 'maya', at: now + 10, text: 'Synthetic handoff', feedback: 'handoff' as const }, ...state.events] };
  const incoming = engine.observe(next, 'jordan', now + 20); assert.equal(incoming.length, 1); assert.equal(incoming[0]!.passive, true);
  assert.deepEqual(engine.observe(next, 'jordan', now + 30), []);
  assert.deepEqual(createFeedbackEngine(storage).observe(next, 'jordan', now + 40), []);
  const stale = { ...next, events: [{ id: 'stale', kind: 'task' as const, actor: 'maya', at: now - 60000, text: 'Old replay' }, ...next.events] };
  assert.deepEqual(engine.observe(stale, 'jordan', now + 50), []);
});
test('overdue is a one-time clock transition, rapid deliveries coalesce, and state markers remain authoritative', () => {
  const state = seedState(now); state.leads = [blankLead('clock', { name: 'Synthetic clock', source: 'fixture', phone: '', address: '', need: 'Synthetic' }, now)];
  const engine = createFeedbackEngine(); engine.observe(state, 'jordan', now);
  const overdue = engine.observe(state, 'jordan', now + 6 * 60000);
  assert.equal(overdue[0]!.signature, 'lead-overdue'); assert.deepEqual(engine.observe(state, 'jordan', now + 7 * 60000), []);
  assert.equal(coalesceFeedback([overdue[0]!, { ...overdue[0]!, id: 'another' }])!.count, 2);
  assert.equal(state.leads[0]!.assignee, '');
  assert.equal(FEEDBACK['lead-claimed'].motion, 'transfer'); assert.equal(FEEDBACK['ultra-on'].urgent, true);
});
test('the six demonstration signatures derive from actual state transitions', () => {
  let state = seedState(now), n = 0;
  state.tasks = [blankTask('t', { title: 'Synthetic', owner: 'jordan' }, 'jordan', now)]; state.tasks[0]!.status = 'working';
  const complete = apply(state, { type: 'task/advance', id: 't' }, { actor: 'jordan', now, newId: () => `s${++n}` }); assert.ok(complete.ok);
  assert.equal(complete.event?.feedback, 'task-completed'); assert.equal(complete.state.tasks[0]!.status, 'done');
  assert.equal(feedbackSignature({ type: 'task/update', id: 't', changes: { priority: 'high' } }, state), 'priority');
  assert.equal(feedbackSignature({ type: 'ultra/activate', taskId: 't' }, state), 'ultra-on');
  assert.equal(feedbackSignature({ type: 'lead/claim', id: 'l' }, state), 'lead-claimed');
  assert.equal(feedbackSignature({ type: 'task/handoff', id: 't', to: 'maya' }, state), 'handoff');
  assert.equal(apply(state, { type: 'task/update', id: 't', changes: { owner: 'outsider' } }, { actor: 'jordan', now }).ok, false);
});

test('muted mode, reduced motion, unarmed audio and denied membership retain text without sensory storms', async () => {
  const { feedbackPolicy } = await import('./feedback.ts');
  const cue = { id: 'fixture', signature: 'ultra-on' as const, phase: 'confirmed' as const, text: 'Ultra active', at: now, passive: false, count: 1 };
  assert.deepEqual(feedbackPolicy(cue, { reducedMotion: true, muted: true, audioArmed: false, haptics: false }), { motion: 'none', audio: false, haptic: false });
  assert.equal(feedbackPolicy(cue, { reducedMotion: false, muted: false, audioArmed: false, haptics: false }).audio, false);
  assert.equal(feedbackPolicy(cue, { reducedMotion: false, muted: false, audioArmed: true, haptics: true }).audio, true);
  assert.equal(feedbackPolicy({ ...cue, phase: 'processing' }, { reducedMotion: false, muted: false, audioArmed: true, haptics: true }).audio, false);
  assert.deepEqual(createFeedbackEngine().observe(seedState(now), 'not-a-member', now), []);
});
