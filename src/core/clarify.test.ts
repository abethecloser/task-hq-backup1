import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { checkGenerated, clarify, clarifyWith, diagnose, isAmbiguous, plan, refine, revise, ruleGenerator } from './clarify.ts';
import type { ClarifyProvider } from './clarify.ts';
import { blankTask, seedState } from './seed.ts';
import { taskById } from './selectors.ts';

// Mirrors the real production task "Dispute klarna": owner Alkeith, high priority, overdue,
// next action left as an unfinished conversational note. Wording is verbatim.
const KLARNA_TEXT = 'Okay. Oh, Keith means the call or something..';
const T0 = new Date('2026-11-08T09:00:00').getTime();

function klarna(): QuestState {
  const base = seedState(T0);
  const task = blankTask('klarna', { title: 'Dispute klarna', owner: 'alkeith', priority: 'high', due: '2026-11-01', nextAction: KLARNA_TEXT, projectId: base.projects[0]!.id }, 'alkeith', T0 - 9 * 86_400_000);
  return {
    ...base,
    people: [...base.people, { id: 'alkeith', name: 'Alkeith', role: 'field', title: 'Partner', authority: 'member' }, { id: 'riley2', name: 'Pat Doe', role: 'field', title: 'Member', authority: 'member' }],
    tasks: [...base.tasks, task],
  };
}

const run = (state: QuestState, actor: string, actions: Action[]) => actions.reduce((current, action) => {
  const result = apply(current, action, { actor, now: T0, newId: (() => { let n = 0; return () => `e${++n}`; })(), writer: 'test' });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}, state);

test('the real Klarna instruction is diagnosed as unclear, with reasons a person can read', () => {
  const reasons = diagnose(KLARNA_TEXT);
  assert.ok(reasons.length >= 3, reasons.join(' | '));
  assert.ok(reasons.some(reason => /mid-conversation/.test(reason)));
  assert.ok(reasons.some(reason => /Hedged/.test(reason)));
  assert.ok(reasons.some(reason => /Trails off/.test(reason)));
});

test('a clear instruction is left alone', () => {
  assert.deepEqual(diagnose('Call Klarna support and dispute the March charge'), []);
});

test('generate: proposes a concrete step, flags it as inferred, and asks instead of guessing who Keith is', () => {
  const c = clarify(klarna(), 'klarna')!;
  assert.equal(c.original, KLARNA_TEXT);
  assert.equal(c.verdict, 'needs-work');
  assert.equal(c.proposal.nextAction, 'Call Klarna to dispute');
  assert.equal(c.proposal.source, 'inferred');
  const who = c.questions.find(question => question.id === 'who')!;
  assert.match(who.ask, /Keith/);
  assert.match(who.ask, /Alkeith/, 'offers the likely match but does not assume it');
  assert.ok(c.questions.some(question => question.id === 'detail'));
});

test('approval is blocked while questions are open, and nothing has changed on the task', () => {
  const state = klarna();
  const c = clarify(state, 'klarna')!;
  const result = plan(state, c, 'alkeith', T0);
  assert.equal(result.ok, false);
  assert.equal(taskById(state, 'klarna')!.nextAction, KLARNA_TEXT);
});

test('refine → approve → commit: answers close the questions and the engine applies it with the original preserved', () => {
  const state = klarna();
  let c = clarify(state, 'klarna')!;
  c = refine(c, { who: 'Alkeith makes the call', detail: 'the duplicate charge, order number from the Klarna email' });
  assert.equal(c.questions.length, 0);
  assert.equal(c.verdict, 'clear');
  assert.equal(c.proposal.source, 'answer');
  assert.equal(c.proposal.nextAction, 'Call Klarna to dispute — the duplicate charge, order number from the Klarna email');

  const approved = plan(state, c, 'alkeith', T0);
  assert.ok(approved.ok);
  if (!approved.ok) return;
  assert.deepEqual(approved.changes, [{ field: 'nextAction', from: KLARNA_TEXT, to: c.proposal.nextAction }]);

  const after = run(state, 'alkeith', approved.actions);
  assert.equal(taskById(after, 'klarna')!.nextAction, c.proposal.nextAction);
  const trail = JSON.stringify(after.events);
  assert.ok(trail.includes('Okay. Oh, Keith means the call'), 'original wording survives in the history');
});

test('an explicit answer to "what" replaces the proposal outright', () => {
  const c = refine(clarify(klarna(), 'klarna')!, { what: 'Ask Klarna to reverse the duplicate charge by phone' });
  assert.equal(c.proposal.nextAction, 'Ask Klarna to reverse the duplicate charge by phone');
});

test('authority is unchanged: a member cannot approve a clarification on someone else’s task', () => {
  const state = klarna();
  const c = refine(clarify(state, 'klarna')!, { who: 'Alkeith', detail: 'order number' });
  const result = plan(state, c, 'riley2', T0);
  assert.equal(result.ok, false);
});

test('a stale draft is refused if the wording changed after it was drafted', () => {
  const state = klarna();
  const c = refine(clarify(state, 'klarna')!, { who: 'Alkeith', detail: 'order number' });
  const edited = run(state, 'alkeith', [{ type: 'task/update', id: 'klarna', changes: { nextAction: 'Call Klarna now' } }]);
  const result = plan(edited, c, 'alkeith', T0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /changed since/);
});

test('a missing task yields nothing to clarify', () => {
  assert.equal(clarify(klarna(), 'nope'), null);
});

test('good instructions are never flagged: every seeded task, lowercase wording and plain statements', () => {
  for (const task of seedState(T0).tasks) assert.equal(isAmbiguous(task), false, `${task.title}: ${task.nextAction}`);
  for (const text of ['send the invoice to the homeowner', 'call bob at 3', 'Customer wants a quote by Friday', 'Order 12 bundles of shingles']) assert.deepEqual(diagnose(text), [], text);
  assert.equal(isAmbiguous({ status: 'ready', nextAction: '' }), false, 'empty is a different problem');
  assert.equal(isAmbiguous({ status: 'done', nextAction: KLARNA_TEXT }), false, 'finished work is not offered');
  assert.equal(isAmbiguous({ status: 'working', nextAction: KLARNA_TEXT }), true);
});

test('refine keeps hyphenated wording intact', () => {
  const state = klarna();
  const c = refine({ ...clarify(state, 'klarna')!, proposal: { nextAction: 'Follow-up call to Klarna', source: 'inferred' } }, { detail: 'order 4' });
  assert.equal(c.proposal.nextAction, 'Follow-up call to Klarna — order 4');
});

test('a human rewrite is theirs: open questions stop gating, and the answers still go to history', () => {
  const state = klarna();
  const c = revise(refine(clarify(state, 'klarna')!, { who: 'Alkeith' }), 'Alkeith calls Klarna Monday to dispute order 4471');
  assert.equal(c.questions.length, 0);
  const result = plan(state, c, 'alkeith', T0);
  assert.ok(result.ok);
  if (!result.ok) return;
  const note = (result.actions[0] as { note: string }).note;
  assert.match(note, /Was: “Okay\. Oh, Keith/);
  assert.match(note, /who: Alkeith/);
});

test('plan failures carry a code the interface can act on', () => {
  const state = klarna();
  const c = clarify(state, 'klarna')!;
  assert.equal((plan(state, c, 'alkeith', T0) as { code: string }).code, 'open-questions');
  assert.equal((plan(state, revise(c, '   '), 'alkeith', T0) as { code: string }).code, 'empty');
  assert.equal((plan(state, revise(c, 'x'.repeat(201)), 'alkeith', T0) as { code: string }).code, 'too-long');
  assert.equal((plan(state, revise(c, KLARNA_TEXT), 'alkeith', T0) as { code: string }).code, 'unchanged');
  assert.equal((plan(state, revise(c, 'Call Klarna'), 'riley2', T0) as { code: string }).code, 'refused');
  const edited = run(state, 'alkeith', [{ type: 'task/update', id: 'klarna', changes: { nextAction: 'Call Klarna now' } }]);
  assert.equal((plan(edited, revise(c, 'Call Klarna'), 'alkeith', T0) as { code: string }).code, 'stale');
  assert.equal((plan(state, { ...c, taskId: 'nope' }, 'alkeith', T0) as { code: string }).code, 'missing');
});

test('provider seam: an async provider flows through the same pipeline and is held to the same rules', async () => {
  const state = klarna();
  const asyncProvider: ClarifyProvider = async task => ({ ...ruleGenerator(task, state), proposal: { nextAction: 'Phone Klarna and dispute the duplicate charge', source: 'answer' } });
  const c = (await clarifyWith(state, 'klarna', asyncProvider))!;
  assert.equal(c.proposal.source, 'inferred', 'a provider cannot claim the person answered');
  assert.equal(c.proposal.nextAction, 'Phone Klarna and dispute the duplicate charge');
  assert.equal((await clarifyWith(state, 'nope', asyncProvider)), null);
});

test('provider seam: malformed, oversized, failing or cancelled providers never produce a draft', async () => {
  const state = klarna();
  const bad = (output: unknown): ClarifyProvider => async () => output as never;
  await assert.rejects(clarifyWith(state, 'klarna', bad(null)));
  await assert.rejects(clarifyWith(state, 'klarna', bad({ reasons: [], questions: [], proposal: { nextAction: 'x'.repeat(201) } })), /too long/);
  await assert.rejects(clarifyWith(state, 'klarna', bad({ reasons: [], questions: [], proposal: { nextAction: '  ' } })), /no next action/);
  await assert.rejects(clarifyWith(state, 'klarna', async () => { throw new Error('model unavailable'); }), /model unavailable/);
  const controller = new AbortController();
  const slow: ClarifyProvider = async task => { controller.abort(); return ruleGenerator(task, state); };
  assert.equal(await clarifyWith(state, 'klarna', slow, controller.signal), null);
  const cleaned = checkGenerated({ reasons: ['a', 7 as never], proposal: { nextAction: ' Call ', source: 'answer' }, questions: [{ id: 'who', ask: 'Who?', why: '' }, { id: 'who', ask: 'dup', why: '' }, { id: 'owner' as never, ask: 'Reassign?', why: '' }] });
  assert.deepEqual(cleaned.reasons, ['a']);
  assert.deepEqual(cleaned.questions.map(question => question.id), ['who'], 'no unknown or duplicate questions, so no way to ask to reassign');
});
