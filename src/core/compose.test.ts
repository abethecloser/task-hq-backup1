import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { seedState } from './seed.ts';
import { compose, composeForTask, composeOutcome, situationsFor } from './compose.ts';
import { actionFor } from './capabilities.ts';
import type { ActionOffer } from './capabilities.ts';
import { MINUTE } from './time.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();

function run(state: QuestState, actor: string, action: Action, now = T0) {
  const result = apply(state, action, { actor, now, newId: (() => { let n = 0; return () => `e${now}-${++n}`; })() });
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result;
}

function perform(state: QuestState, actor: string, item: ActionOffer, values = {}, now = T0) {
  return run(state, actor, actionFor(item, values, actor)!, now);
}

test('Maya → Alex: prerequisite, spatial dependent, handoff, Alex sees it first, history and undo', () => {
  let state = seedState(T0);
  // 1–2. Maya is working on the prerequisite; Quest shows Alex's dependent task.
  const maya = compose(state, 'maya', T0).primary;
  assert.equal(maya.kind, 'handoff-ready');
  assert.equal(maya.taskId, 'staging-area');
  assert.match(maya.headline, /Alex is waiting on it/);
  const after = maya.chain.find(node => node.position === 'after');
  assert.equal(after?.taskId, 'crew-handoff');
  assert.equal(after?.owner, 'alex');
  assert.equal(maya.chain.find(node => node.position === 'before')?.status, 'done');
  assert.equal(maya.actions[0]?.capability, 'task.advance');

  // 3–4. Maya completes it; the outcome describes the handoff from real state.
  const done = perform(state, 'maya', maya.actions[0]!);
  state = done.state;
  const outcome = composeOutcome(state, 'maya', T0, done.event!.id)!;
  assert.equal(outcome.kind, 'outcome');
  assert.equal(outcome.kicker, 'HANDOFF');
  assert.deepEqual(outcome.outcome?.unlocked.map(item => [item.taskId, item.owner]), [['crew-handoff', 'alex']]);
  const undo = outcome.actions.find(item => item.capability === 'undo');
  assert.ok(undo, 'undo offered');

  // 5–6. Alex's next action is available and comes first for Alex.
  const alex = compose(state, 'alex', T0 + MINUTE).primary;
  assert.equal(alex.kind, 'handoff-arrived');
  assert.equal(alex.taskId, 'crew-handoff');
  assert.match(alex.headline, /Maya finished/);
  assert.equal(alex.actions[0]?.label, 'Start work');
  // 7. History includes the dependency completion; undo restores it.
  assert.ok(alex.history.some(event => event.taskId === 'staging-area' && /completed/.test(event.text)));
  state = perform(state, 'maya', undo!).state;
  assert.equal(compose(state, 'maya', T0).primary.taskId, 'staging-area');
  assert.notEqual(compose(state, 'alex', T0).primary.taskId, 'crew-handoff');
});

test('composition never offers actions the engine would refuse', () => {
  const state = seedState(T0);
  for (const actor of state.people.map(item => item.id)) {
    for (const situation of situationsFor(state, actor, T0)) {
      for (const item of [...situation.actions, ...situation.more]) {
        const values = Object.fromEntries(item.inputs.map(input => [input.name, input.kind === 'person' ? 'jordan' : input.kind === 'date' ? '2026-10-20' : input.options?.[0]?.value ?? 'note']));
        const result = apply(state, actionFor(item, values, actor)!, { actor, now: T0, newId: () => 'x' });
        assert.ok(result.ok, `${actor} ${item.capability}: ${result.ok ? '' : result.error}`);
      }
    }
  }
  // Riley cannot approve Jordan's review item; the drawer shows waiting-for-approval with no approve offer.
  const forRiley = composeForTask(state, 'riley', T0, 'maple-estimate')!;
  assert.ok(!forRiley.actions.some(item => item.capability === 'task.advance'));
  assert.equal(composeForTask(state, 'jordan', T0, 'maple-estimate')!.kind, 'approval');
});

test('first-response lead: timer, contact actions, outcome with next steps', () => {
  let state = seedState(T0);
  const sam = compose(state, 'sam', T0).primary;
  assert.equal(sam.kind, 'lead-response');
  assert.equal(sam.leadId, 'lead-okafor');
  assert.ok(sam.timer && sam.timer.stoppedAt === null);
  assert.deepEqual(sam.actions.map(item => item.label), ['I’ll take it', 'Reached them', 'No answer', 'Left a message']);
  assert.equal(compose(state, 'alex', T0).queue.some(item => item.kind === 'lead-response'), false, 'field lead is not handed leads');

  const logged = perform(state, 'sam', sam.actions[1]!, { channel: 'text' });
  state = logged.state;
  const outcome = composeOutcome(state, 'sam', T0, logged.event!.id)!;
  assert.match(outcome.headline, /First response in 3m 00s — within the 5-minute target/);
  assert.deepEqual(outcome.actions.map(item => item.capability), ['lead.advance', 'lead.follow-up', 'lead.qualify']);
  const handed = perform(state, 'sam', outcome.actions[0]!);
  const handedOutcome = composeOutcome(handed.state, 'sam', T0, handed.event!.id)!;
  assert.equal(handedOutcome.kicker, 'HANDED ON');
  assert.equal(handedOutcome.outcome?.unlocked[0]?.owner, 'riley');
});

test('only priority composes a single focused situation with permitted actions', () => {
  const state = run(seedState(T0), 'jordan', { type: 'ultra/activate', taskId: 'maple-tarp' }).state;
  const { primary, queue } = compose(state, 'alex', T0);
  assert.equal(primary.kind, 'critical-focus');
  assert.equal(queue.length, 0);
  assert.ok(primary.more.some(item => item.capability === 'task.request-help' && item.preset.person === 'jordan'));
  assert.ok(![...primary.actions, ...primary.more].some(item => item.capability === 'task.handoff'), 'handoff is refused by the engine during focus');
});
