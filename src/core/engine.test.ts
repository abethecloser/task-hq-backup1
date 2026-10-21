import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply, reconcile } from './engine.ts';
import { seedState, simulatedLead } from './seed.ts';
import { insights, insightsFor } from './rules.ts';
import { canEnter, leadBucket, moveForwardPlan, nextActionable, taskById } from './selectors.ts';
import { migrateV1 } from './migrate.ts';
import { MINUTE, localDate } from './time.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();

function harness(start = seedState(T0)) {
  let state = start;
  let now = T0;
  let n = 0;
  const newId = () => `id${++n}`;
  return {
    get state() { return state; },
    tick(ms: number) { now += ms; state = reconcile(state, now).state; },
    get now() { return now; },
    act(actor: string, action: Action) {
      const result = apply(state, action, { actor, now, newId, writer: 'test' });
      if (!result.ok) throw new Error(`${action.type} by ${actor} failed: ${result.error}`);
      state = result.state;
      return result;
    },
    refuse(actor: string, action: Action) {
      const result = apply(state, action, { actor, now, newId, writer: 'test' });
      assert.equal(result.ok, false, `${action.type} by ${actor} should be refused`);
      return result.ok ? '' : result.error;
    },
  };
}

const task = (state: QuestState, id: string) => taskById(state, id)!;

test('task execution: create → assign → start → help → resolve → complete → unlock next', () => {
  const h = harness();
  const first = h.act('maya', { type: 'task/create', task: { title: 'Measure the garage roof', approver: '' } });
  const firstId = first.event!.taskId!;
  assert.equal(task(h.state, firstId).owner, '', 'created without an owner');
  assert.ok(insights(h.state, h.now).some(item => item.kind === 'unassigned' && item.taskId === firstId));

  const second = h.act('maya', { type: 'task/create', task: { title: 'Order flashing for the garage', owner: 'riley', dependsOn: [firstId] } });
  const secondId = second.event!.taskId!;
  assert.equal(moveForwardPlan(h.state, task(h.state, secondId), 'riley').canAct, false, 'waits on dependency');
  h.refuse('riley', { type: 'task/advance', id: secondId });

  h.act('maya', { type: 'task/update', id: firstId, changes: { owner: 'alex', nextAction: 'Bring the long ladder' } });
  h.refuse('sam', { type: 'task/advance', id: firstId });
  h.act('alex', { type: 'task/advance', id: firstId });
  assert.equal(task(h.state, firstId).status, 'working');

  h.act('alex', { type: 'task/request-help', id: firstId, note: 'Gate code?', helper: 'maya' });
  assert.equal(task(h.state, firstId).status, 'blocked');
  assert.ok(insightsFor(h.state, h.now, 'maya').some(item => item.kind === 'blocked'));

  h.act('maya', { type: 'task/resolve', id: firstId, note: 'Code is 4411' });
  assert.equal(task(h.state, firstId).status, 'working');

  const done = h.act('alex', { type: 'task/advance', id: firstId });
  assert.equal(task(h.state, firstId).status, 'done');
  assert.match(done.message, /unlocked for Riley Brooks/);
  assert.equal(moveForwardPlan(h.state, task(h.state, secondId), 'riley').canAct, true);
  assert.ok(insightsFor(h.state, h.now, 'riley').some(item => item.kind === 'dependency-ready'));
  assert.equal(nextActionable(h.state, 'riley', h.now)?.status === 'review' || !!nextActionable(h.state, 'riley', h.now), true);
});

test('task/update edits only editable fields; status, Ultra and identity fields are refused for everyone', () => {
  const h = harness();
  const id = h.act('riley', { type: 'task/create', task: { title: 'Patch the ridge', owner: 'riley' } }).event!.taskId!;
  const before = task(h.state, id);
  for (const actor of ['riley', 'maya']) {
    for (const changes of [{ status: 'done' }, { ultra: true }, { completedAt: 1 }, { createdBy: 'maya' }, { id: 'hijack' }, { nextAction: 'ok', blocker: null }]) {
      assert.match(h.refuse(actor, { type: 'task/update', id, changes } as unknown as Action), /can’t be edited/);
    }
  }
  assert.deepEqual(task(h.state, id), before, 'nothing was written');
  h.act('riley', { type: 'task/update', id, changes: { nextAction: 'Bring sealant', priority: 'high', due: '2026-10-25' } });
  assert.equal(task(h.state, id).nextAction, 'Bring sealant');
});

test('approval: working → review with approver → approve unlocks and hands off', () => {
  const h = harness();
  h.refuse('riley', { type: 'task/advance', id: 'maple-estimate' });
  h.refuse('sam', { type: 'task/send-back', id: 'maple-estimate', note: 'x' });
  const result = h.act('jordan', { type: 'task/advance', id: 'maple-estimate' });
  assert.equal(task(h.state, 'maple-estimate').status, 'done');
  assert.equal(task(h.state, 'shingle-order').owner, 'sam', 'unowned dependent goes to next-step owner');
  assert.match(result.message, /Sam Rivera/);
});

test('undo reverses a transition and refuses once the task moved on', () => {
  const h = harness();
  const started = h.act('alex', { type: 'task/advance', id: 'safety-brief' });
  h.act('alex', { type: 'undo', eventId: started.event!.id });
  assert.equal(task(h.state, 'safety-brief').status, 'ready');
  const again = h.act('alex', { type: 'task/advance', id: 'safety-brief' });
  h.act('alex', { type: 'task/advance', id: 'safety-brief' });
  assert.match(h.refuse('alex', { type: 'undo', eventId: again.event!.id }), /changed this since/);
  h.refuse('maya', { type: 'undo', eventId: again.event!.id });
});

test('ultra priority: activate → restrict → request → approve → expire → return → release', () => {
  const h = harness();
  h.refuse('alex', { type: 'ultra/activate', taskId: 'maple-tarp' });
  h.act('jordan', { type: 'ultra/activate', taskId: 'maple-tarp' });
  assert.equal(h.state.focus?.employee, 'alex');
  assert.equal(canEnter(h.state, 'alex', 'company-work', h.now), false);
  assert.match(h.refuse('alex', { type: 'task/advance', id: 'safety-brief' }), /Critical Focus/);
  h.refuse('alex', { type: 'task/create', task: { title: 'Side quest' } });
  h.refuse('alex', { type: 'ultra/release' });
  assert.equal(nextActionable(h.state, 'alex', h.now)?.id, 'maple-tarp');

  h.act('alex', { type: 'grant/request', section: 'company-work', reason: 'Need the tarp sizes from the Maple estimate' });
  h.refuse('alex', { type: 'grant/request', section: 'leads', reason: 'again' });
  assert.ok(insightsFor(h.state, h.now, 'jordan').some(item => item.kind === 'ultra-request'));
  const grantId = h.state.grants[0]!.id;
  h.refuse('alex', { type: 'grant/decide', id: grantId, approve: true });
  h.act('jordan', { type: 'grant/decide', id: grantId, approve: true });
  assert.equal(canEnter(h.state, 'alex', 'company-work', h.now), true);
  h.act('alex', { type: 'task/update', id: 'safety-brief', changes: { nextAction: 'Print two copies' } });

  h.tick(61_000);
  assert.equal(h.state.grants[0]!.status, 'expired');
  assert.equal(canEnter(h.state, 'alex', 'company-work', h.now), false, 'back to the critical task after expiry');
  h.refuse('alex', { type: 'task/advance', id: 'safety-brief' });
  assert.match(h.state.events[0]!.text, /expired/);

  // second grant, revoked by the manager
  h.act('alex', { type: 'grant/request', section: 'leads', reason: 'Check a lead address' });
  h.act('jordan', { type: 'grant/decide', id: h.state.grants[0]!.id, approve: true, seconds: 30 });
  h.act('jordan', { type: 'grant/revoke', id: h.state.grants[0]!.id });
  assert.equal(canEnter(h.state, 'alex', 'leads', h.now), false);

  // completion releases focus
  h.act('alex', { type: 'task/advance', id: 'maple-tarp' });
  const done = h.act('alex', { type: 'task/advance', id: 'maple-tarp' });
  assert.match(done.message, /Critical Focus released/);
  assert.equal(h.state.focus, null);
  assert.equal(canEnter(h.state, 'alex', 'company-work', h.now), true);
});

test('ultra policy: manager-context scope and company-wide scope', () => {
  const h = harness();
  h.act('jordan', { type: 'policy/update', changes: { ultraApprovers: ['manager', 'coordinator'] } });
  h.act('jordan', { type: 'ultra/activate', taskId: 'maple-tarp' });
  h.act('alex', { type: 'grant/request', section: 'company-work', reason: 'x' });
  assert.match(h.refuse('maya', { type: 'grant/decide', id: h.state.grants[0]!.id, approve: true }), /only Jordan Lee/);
  h.act('jordan', { type: 'policy/update', changes: { ultraScope: 'company-wide' } });
  h.act('maya', { type: 'grant/decide', id: h.state.grants[0]!.id, approve: false });
  assert.equal(h.state.grants[0]!.status, 'denied');
  h.refuse('maya', { type: 'policy/update', changes: { grantSeconds: 30 } });
  h.act('jordan', { type: 'ultra/release', reason: 'test' });
  assert.equal(h.state.focus, null);
});

test('speed to lead: receive → assign → timer → response → follow-up → advance / escalate', () => {
  const h = harness();
  const received = h.act('sam', { type: 'lead/receive', lead: simulatedLead(0) });
  const leadId = received.event!.leadId!;
  const lead = () => h.state.leads.find(item => item.id === leadId)!;
  assert.ok(insights(h.state, h.now).some(item => item.kind === 'lead-unassigned' && item.leadId === leadId));
  h.tick(90_000);
  h.act('jordan', { type: 'lead/assign', id: leadId, to: 'sam' });
  assert.equal(leadBucket(h.state, lead(), h.now), 'waiting');
  h.tick(4 * MINUTE);
  assert.equal(leadBucket(h.state, lead(), h.now), 'attention', 'past the 5 minute target');
  h.refuse('alex', { type: 'lead/attempt', id: leadId, channel: 'phone', outcome: 'reached' });
  const attempt = h.act('sam', { type: 'lead/attempt', id: leadId, channel: 'phone', outcome: 'no-answer' });
  assert.match(attempt.message, /Task-HQ did not contact anyone/);
  assert.equal(lead().firstResponseAt, h.now);
  assert.equal(leadBucket(h.state, lead(), h.now), 'responded');
  h.act('sam', { type: 'lead/follow-up', id: leadId, due: localDate(h.now) });
  const followUp = taskById(h.state, lead().followUpTaskId)!;
  assert.equal(followUp.owner, 'sam');
  assert.equal(followUp.leadId, leadId);
  h.act('sam', { type: 'lead/qualify', id: leadId });
  h.act('sam', { type: 'lead/advance', id: leadId });
  assert.equal(lead().stage, 'won');
  assert.equal(taskById(h.state, lead().handoffTaskId)!.owner, 'riley');
  assert.equal(taskById(h.state, followUp.id)!.status, 'done');

  const other = h.act('sam', { type: 'lead/receive', lead: simulatedLead(3) }).event!.leadId!;
  h.act('sam', { type: 'lead/attempt', id: other, channel: 'text', outcome: 'reached' });
  h.act('sam', { type: 'lead/escalate', id: other, note: 'Wants commercial pricing today' });
  const escalated = h.state.leads.find(item => item.id === other)!;
  assert.equal(escalated.escalatedTo, 'jordan');
  assert.ok(h.state.tasks.some(item => item.leadId === other && item.owner === 'jordan'));
});

test('rules explain what, why, next and who for the seed workspace', () => {
  const state = seedState(T0);
  const kinds = new Set(insights(state, T0).map(item => item.kind));
  for (const kind of ['blocked', 'approval', 'overdue', 'unassigned', 'missing-next-action', 'stalled', 'lead-unassigned'] as const) assert.ok(kinds.has(kind), kind);
  for (const item of insights(state, T0)) assert.ok(item.what && item.why && item.next, item.id);
});

test('v1 browser data migrates without falling back to samples', () => {
  const v1 = JSON.stringify([{ id: 'a', title: 'Old task', description: '', owner: 'Maya Chen', status: 'need-help', due: '', priority: 'High', dependency: '', helpNote: 'stuck', createdAt: new Date(T0).toISOString() }]);
  const state = migrateV1(v1, null, T0)!;
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0]!.status, 'blocked');
  assert.equal(state.tasks[0]!.owner, 'maya');
});
