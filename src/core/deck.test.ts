import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { seedState } from './seed.ts';
import { actionFor } from './capabilities.ts';
import { DEFAULT_DECK_PREFS, composeDeck, resolveContext } from './deck.ts';
import { INSTRUMENTS, validateDeck } from './instruments.ts';
import { parseIntent } from './intent.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const ids = (state: QuestState, actor: string, leadId: string) => composeDeck(resolveContext(state, actor, { leadId }, T0), DEFAULT_DECK_PREFS).instruments.map(item => item.instrument);

test('registry: every instrument declares contexts, schema, states, authorization and a11y; validator rejects strays', () => {
  for (const def of Object.values(INSTRUMENTS)) assert.ok(def.contexts.length && def.states.length && def.authorization && def.a11y, def.id);
  assert.deepEqual(validateDeck({ context: 'lead', key: 'x', signature: 'x', instruments: [{ id: 'a', instrument: 'priority-dial', state: 'adjustable', value: 'P2' }] }), []);
  assert.equal(validateDeck({ context: 'lead', key: 'x', signature: 'x', instruments: [{ id: 'a', instrument: 'script-runner' as never, state: 'on' }] }).length, 1);
  assert.equal(validateDeck({ context: 'lead', key: 'x', signature: 'x', instruments: [{ id: 'a', instrument: 'duration-fader', state: 'idle', value: 27 }] }).length, 1);
  assert.equal(validateDeck({ context: 'lead', key: 'x', signature: 'x', instruments: [{ id: 'a', instrument: 'access-panel', state: 'none' }] }).length, 1, 'access panel only in focus');
});

test('lead context: initial P2 / 25 min / focus off, real owner, timing and next authorized action', () => {
  const state = seedState(T0);
  const ctx = resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0);
  assert.equal(ctx.kind, 'lead');
  assert.equal(ctx.owner, '');
  assert.equal(ctx.elapsedMs, 3 * 60_000);
  assert.ok(ctx.urgency.reasons.includes('Nobody owns this lead'));
  assert.deepEqual(ctx.actions.map(item => item.capability), ['lead.take', 'lead.assign', 'lead.attempt']);
  const deck = composeDeck(ctx, DEFAULT_DECK_PREFS);
  assert.equal(deck.instruments.find(item => item.instrument === 'priority-dial')?.value, 'P2');
  assert.equal(deck.instruments.find(item => item.instrument === 'duration-fader')?.value, 25);
  assert.equal(deck.instruments.find(item => item.instrument === 'duration-fader')?.state, 'idle');
  assert.equal(state.focus, null);
});

test('intent grammar: variations, settings, queries without mutation, ambiguity and refusals', () => {
  const state = seedState(T0);
  const before = JSON.stringify(state);
  const ctx = resolveContext(state, 'sam', { leadId: 'lead-brightline' }, T0);
  const p = (text: string) => parseIntent(text, ctx, state, T0, DEFAULT_DECK_PREFS);
  for (const text of ['Who owns this lead?', '  who OWNS this   lead ', 'whose lead is this']) {
    const result = p(text);
    assert.equal(result.kind, 'query', text);
    assert.match(result.kind === 'query' ? result.answer : '', /Sam Rivera owns Brightline Dental/);
  }
  assert.match((p('What should happen next?') as { answer: string }).answer, /Schedule follow-up/);
  assert.equal(p('Show my leads').kind, 'query');
  for (const text of ['Set 15 minutes', 'set duration to 15 min', '15 mins']) assert.deepEqual(p(text), { kind: 'setting', change: { durationMin: 15 }, summary: 'Interval set to 15 minutes. The 5-minute lead response target is unchanged.' }, text);
  for (const text of ['Set priority to P2', 'priority p2', 'set priority 2']) assert.deepEqual((p(text) as { change: unknown }).change, { priority: 2 }, text);
  assert.deepEqual((p('Focus off') as { change: unknown }).change, { focus: { on: false, startedAt: null } });
  assert.equal((p('focus for 25 minutes') as { change: { focus: { on: boolean } } }).change.focus.on, true);
  assert.equal(p('set priority').kind, 'unsupported');
  assert.equal((p('set priority') as { ambiguous?: boolean }).ambiguous, true);
  assert.match((p('set 90 minutes') as { message: string }).message, /5 to 60/);
  assert.match((p('order a pizza') as { message: string }).message, /only understands a few local commands/);
  assert.match((p('make this high priority') as { message: string }).message, /Leads have no priority/);
  assert.equal(JSON.stringify(state), before, 'parsing never mutates');
});

test('preview before commit, engine refusal, and recomposition after a real contact attempt', () => {
  let state = seedState(T0);
  // Alex (field lead) cannot record an attempt on Sam's lead: the engine refuses, so no proposal.
  const alexCtx = resolveContext(state, 'alex', { leadId: 'lead-brightline' }, T0);
  assert.match((parseIntent('Record a contact attempt', alexCtx, state, T0, DEFAULT_DECK_PREFS) as { message: string }).message, /Sam Rivera owns this lead/);

  state = apply(state, { type: 'lead/assign', id: 'lead-okafor', to: 'sam' }, { actor: 'sam', now: T0, newId: () => 'a1' }).state as QuestState;
  const before = ids(state, 'sam', 'lead-okafor');
  assert.equal(before[0], 'response-meter');
  const ctx = resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0);
  const intent = parseIntent('Record a contact attempt', ctx, state, T0, DEFAULT_DECK_PREFS);
  assert.equal(intent.kind, 'action');
  if (intent.kind !== 'action') return;
  assert.deepEqual(intent.offer.inputs.map(input => input.name), ['channel', 'outcome', 'note']);
  assert.match(intent.preview, /will not call, text or email/);
  assert.equal(state.leads.find(lead => lead.id === 'lead-okafor')?.firstResponseAt, null, 'nothing applied before confirm');

  const result = apply(state, actionFor(intent.offer, { channel: 'phone', outcome: 'reached', note: 'Booked a callback' }, 'sam')!, { actor: 'sam', now: T0 + 60_000, newId: () => 'a2' });
  assert.ok(result.ok);
  state = result.state;
  const after = composeDeck(resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0 + 60_000), DEFAULT_DECK_PREFS);
  assert.notDeepEqual(after.instruments.map(item => item.instrument), before, 'instruments are reassembled, not restyled');
  assert.ok(!after.instruments.some(item => item.instrument === 'response-meter'));
  assert.deepEqual(resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0 + 60_000).actions.map(item => item.capability), ['lead.follow-up', 'lead.qualify', 'lead.advance', 'lead.escalate']);
  assert.ok(resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0 + 60_000).events.some(event => /contact attempt/.test(event.text)));
});

test('dependency and Only Priority contexts compose from real state and respect authority', () => {
  let state = seedState(T0);
  const maya = composeDeck(resolveContext(state, 'maya', { taskId: 'staging-area' }, T0), DEFAULT_DECK_PREFS);
  assert.equal(maya.context, 'dependency');
  assert.equal(maya.instruments[0]?.instrument, 'dependency-map');
  state = apply(state, { type: 'ultra/activate', taskId: 'maple-tarp' }, { actor: 'jordan', now: T0, newId: () => 'f1' }).state as QuestState;
  const ctx = resolveContext(state, 'alex', { taskId: 'maple-tarp' }, T0);
  assert.equal(ctx.kind, 'focus');
  const deck = composeDeck(ctx, DEFAULT_DECK_PREFS);
  assert.equal(deck.instruments.find(item => item.instrument === 'priority-dial')?.state, 'locked');
  assert.equal(deck.instruments.find(item => item.instrument === 'access-panel')?.state, 'can-request');
  assert.match((parseIntent('set priority to p3', ctx, state, T0, DEFAULT_DECK_PREFS) as { message: string }).message, /fixed at P1/);
  // The manager's deck on a non-focused task never offers focus authority through the dial.
  assert.ok(!resolveContext(state, 'alex', { taskId: 'safety-brief' }, T0).actions.length, 'focus gate blocks other tasks');
});
