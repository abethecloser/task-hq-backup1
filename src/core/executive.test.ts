import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply, fingerprint } from './engine.ts';
import { seedState } from './seed.ts';
import { actionFor } from './capabilities.ts';
import { dailySignal, decisionDesk, executiveBrief, followUps, handoffHistory, recommendOwner } from './executive.ts';
import type { DecisionOption } from './executive.ts';
import { EXEC_COMMANDS, parseExecCommand, runExecCommand } from './executive-commands.ts';
import { leadById, taskById } from './selectors.ts';
import { HOUR, MINUTE, localDate } from './time.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();

function act(state: QuestState, actor: string, action: Action, now = T0) {
  let n = 0;
  const result = apply(state, action, { actor, now, newId: () => `x${state.rev}-${++n}` });
  assert.ok(result.ok, result.ok ? '' : `${action.type} by ${actor}: ${result.error}`);
  return result.state;
}

/** Perform a desk option the way the UI would after the principal confirms. */
function perform(state: QuestState, principal: string, option: DecisionOption, values: Record<string, string> = {}, now = T0) {
  assert.ok(option.supported, option.refusal);
  const action = option.offer ? actionFor(option.offer, values, principal)! : option.action!;
  return act(state, principal, action, now);
}

const exists = (state: QuestState, kind: string, id: string) =>
  kind === 'task' ? !!taskById(state, id) : kind === 'lead' ? !!leadById(state, id) : kind === 'grant' ? state.grants.some(item => item.id === id) : kind === 'event' ? state.events.some(item => item.id === id) : true;

test('executive brief: every section, source-linked, synthetic, nothing invented', () => {
  const state = seedState(T0);
  const brief = executiveBrief(state, T0, 'jordan');
  assert.deepEqual(brief.sections.map(section => section.key), ['decisions', 'blocked', 'leads', 'overdue', 'appointments', 'reassignment', 'changes']);
  assert.equal(brief.synthetic, true, 'demo workspace is labeled synthetic');
  const appointments = brief.sections.find(section => section.key === 'appointments')!;
  assert.equal(appointments.status, 'not-connected');
  assert.equal(appointments.items.length, 0, 'no calendar → no appointments, never guessed');
  for (const section of brief.sections) for (const item of section.items) {
    assert.ok(exists(state, item.source.kind, item.source.id), `${section.key}: ${item.source.kind}:${item.source.id} must exist`);
    assert.equal(item.source.synthetic, true);
  }
  assert.ok(brief.sections.find(section => section.key === 'decisions')!.items.some(item => item.source.id === 'maple-estimate'));
  assert.ok(brief.sections.find(section => section.key === 'blocked')!.items.some(item => item.source.id === 'permit-update' && !item.needsPrincipal), 'Maya handles the permit blocker, not Jordan');
  assert.ok(brief.sections.find(section => section.key === 'leads')!.items.some(item => item.source.id === 'lead-okafor'));
  assert.ok(brief.sections.find(section => section.key === 'overdue')!.items.some(item => item.source.id === 'maple-tarp'));
  assert.ok(brief.sections.find(section => section.key === 'reassignment')!.items.some(item => item.source.id === 'shingle-order'));
  assert.equal(brief.needsYou, 2);
  assert.match(brief.headline, /^Jordan, 2 thing\(s\) need you/);
});

test('executive brief: calendar only from a supplied feed, next 24 hours, labeled', () => {
  const state = seedState(T0);
  const brief = executiveBrief(state, T0, 'jordan', {
    calendar: {
      source: 'Demo calendar', synthetic: true,
      appointments: [
        { id: 'b', title: 'Site walk', start: T0 + 3 * HOUR, with: 'Okafor family' },
        { id: 'a', title: 'Supplier call', start: T0 + HOUR },
        { id: 'past', title: 'Yesterday', start: T0 - HOUR },
        { id: 'far', title: 'Next week', start: T0 + 7 * 24 * HOUR },
      ],
    },
  });
  const section = brief.sections.find(item => item.key === 'appointments')!;
  assert.equal(section.status, 'ok');
  assert.deepEqual(section.items.map(item => item.id), ['a', 'b']);
  assert.ok(section.items.every(item => item.source.kind === 'appointment' && item.source.synthetic));
});

test('executive brief: changes since the previous briefing, and partial coverage when history was trimmed', () => {
  let state = seedState(T0);
  state = act(state, 'maya', { type: 'task/advance', id: 'staging-area' }, T0 + MINUTE);
  const since = T0 + 2 * MINUTE;
  state = act(state, 'alex', { type: 'task/advance', id: 'crew-handoff' }, T0 + 3 * MINUTE);
  const changes = executiveBrief(state, T0 + 4 * MINUTE, 'jordan', { since }).sections.find(item => item.key === 'changes')!;
  assert.equal(changes.status, 'ok');
  assert.equal(changes.items.length, 1);
  assert.match(changes.items[0]!.text, /Alex Morgan started/);

  for (let i = 0; i < 405; i += 1) state = act(state, 'maya', { type: 'task/update', id: 'safety-brief', changes: { nextAction: `step ${i}` } }, T0 + 10 * MINUTE + i);
  const trimmed = executiveBrief(state, T0 + HOUR, 'jordan', { since }).sections.find(item => item.key === 'changes')!;
  assert.equal(trimmed.status, 'partial');
  assert.match(trimmed.note!, /most recent 400/);
});

test('decision desk: access request during Critical Focus — approve or deny, never executed by the desk', () => {
  let state = act(seedState(T0), 'jordan', { type: 'ultra/activate', taskId: 'maple-tarp' });
  state = act(state, 'alex', { type: 'grant/request', section: 'leads', reason: 'Call back the Okafor family' });
  const before = fingerprint(state);
  const desk = decisionDesk(state, T0, 'jordan');
  assert.equal(fingerprint(state), before, 'computing the desk changes nothing');
  const access = desk[0]!;
  assert.equal(access.kind, 'access');
  assert.equal(access.urgency, 'critical');
  assert.deepEqual(access.waiting.map(item => item.personId), ['alex']);
  assert.deepEqual(access.options.map(item => [item.kind, item.supported]), [['approve', true], ['decline', true]]);
  const after = perform(state, 'jordan', access.options[0]!);
  assert.equal(after.grants[0]!.status, 'approved');
  assert.equal(decisionDesk(after, T0, 'jordan').some(item => item.kind === 'access'), false, 'decided requests leave the desk');
  assert.equal(decisionDesk(state, T0, 'alex').some(item => item.kind === 'access'), false, 'the requester never decides');
});

test('decision desk: approvals — decide when work waits, otherwise recommend delegating', () => {
  const state = seedState(T0);
  const approval = decisionDesk(state, T0, 'jordan').find(item => item.id === 'approval-maple-estimate')!;
  assert.match(approval.delay, /1 task\(s\) stay locked/);
  assert.equal(approval.options.find(item => item.recommended)!.kind, 'approve');
  const sendBack = approval.options.find(item => item.kind === 'decline')!;
  assert.deepEqual(sendBack.offer!.inputs.map(item => item.name), ['note'], 'the UI must collect a note before sending back');
  const done = perform(state, 'jordan', approval.options.find(item => item.kind === 'approve')!);
  assert.equal(taskById(done, 'maple-estimate')!.status, 'done');

  // A review task that unlocks nothing and has no approver: a manager decides, delegation recommended.
  let quiet = act(state, 'maya', { type: 'task/create', task: { title: 'Update the yard sign artwork', owner: 'sam', approver: 'jordan' } });
  const id = quiet.tasks.find(item => item.title === 'Update the yard sign artwork')!.id;
  quiet = act(quiet, 'sam', { type: 'task/advance', id });
  quiet = act(quiet, 'sam', { type: 'task/advance', id });
  quiet = act(quiet, 'maya', { type: 'task/update', id, changes: { approver: '' } });
  const decision = decisionDesk(quiet, T0, 'jordan').find(item => item.id === `approval-${id}`)!;
  assert.match(decision.why, /no approver/);
  const delegate = decision.options.find(item => item.recommended)!;
  assert.equal(delegate.kind, 'delegate');
  const handed = perform(quiet, 'jordan', delegate);
  assert.equal(taskById(handed, id)!.approver, 'maya');
  assert.equal(decisionDesk(handed, T0, 'jordan').some(item => item.id === `approval-${id}`), false, 'off Jordan’s desk');
});

test('decision desk: escalated lead goes back to its owner with a follow-up date, and leaves the desk', () => {
  let state = act(seedState(T0), 'sam', { type: 'lead/escalate', id: 'lead-brightline', note: 'Wants a commercial discount' });
  const lead = decisionDesk(state, T0, 'jordan').find(item => item.kind === 'escalated-lead')!;
  assert.ok(lead.waiting.some(item => item.label === 'Brightline Dental (customer)'));
  const delegate = lead.options.find(item => item.recommended)!;
  assert.equal(delegate.kind, 'delegate');
  assert.deepEqual(delegate.offer!.inputs.map(item => item.name), ['date', 'note']);
  state = perform(state, 'jordan', delegate, { date: localDate(T0 + 24 * HOUR), note: 'Offer 5% if they book this week' });
  assert.equal(leadById(state, 'lead-brightline')!.stage, 'follow-up');
  assert.equal(state.tasks.find(item => item.id === leadById(state, 'lead-brightline')!.followUpTaskId)!.owner, 'sam');
  assert.equal(decisionDesk(state, T0, 'jordan').some(item => item.kind === 'escalated-lead'), false);
});

test('decision desk: an escalated lead with no owner is offered to sales, honestly still escalated', () => {
  const state = act(seedState(T0), 'maya', { type: 'lead/escalate', id: 'lead-okafor', note: 'Insurance question' });
  const lead = decisionDesk(state, T0, 'jordan').find(item => item.kind === 'escalated-lead')!;
  const delegate = lead.options.find(item => item.recommended)!;
  assert.equal(delegate.offer!.preset.person, 'sam');
  assert.match(lead.recommendation, /stays escalated/);
});

test('decision desk: blocked on you, unowned priority work, and other principals', () => {
  let state = act(seedState(T0), 'alex', { type: 'task/request-help', id: 'safety-brief', note: 'Do we buy new harnesses?', helper: 'jordan' });
  state = act(state, 'maya', { type: 'task/create', task: { title: 'Replace the cracked ridge vent', priority: 'high', projectId: 'northside' } });
  const desk = decisionDesk(state, T0, 'jordan');
  const call = desk.find(item => item.kind === 'needs-your-call')!;
  assert.equal(call.source.id, 'safety-brief');
  assert.ok(call.options.every(item => item.supported));
  const unowned = desk.find(item => item.kind === 'unowned-priority')!;
  const assign = unowned.options.find(item => item.recommended)!;
  assert.notEqual(assign.offer!.preset.person, 'jordan', 'delegation never lands back on the principal');
  assert.notEqual(assign.offer!.preset.person, 'abraham');
  // Non-managers only see what is theirs; the reviewer persona has no decisions.
  assert.equal(decisionDesk(state, T0, 'alex').length, 0);
  assert.equal(decisionDesk(state, T0, 'abraham').length, 0);
});

test('owner recommendation: role fit, project history, load — never a reviewer or excluded person', () => {
  const state = seedState(T0);
  const lead = leadById(state, 'lead-okafor')!;
  assert.equal(recommendOwner(state, { lead })!.personId, 'sam');
  assert.equal(recommendOwner(state, { lead }, ['sam'])!.personId === 'sam', false);
  const pick = recommendOwner(state, { task: taskById(state, 'shingle-order')! }, ['jordan'])!;
  assert.ok(['riley', 'alex', 'maya'].includes(pick.personId));
  assert.match(pick.reason, /open task/);
  const everyone = state.people.filter(item => item.role !== 'reviewer').map(item => item.id);
  assert.equal(recommendOwner(state, { lead }, everyone), null, 'reviewer is never a fallback');
});

test('follow-up intelligence: owner, stall, lead, deadline and repeated handoff failures', () => {
  let state = seedState(T0);
  for (const to of ['riley', 'alex', 'sam']) state = act(state, 'maya', { type: 'task/handoff', id: 'warranty-docs', to });
  state = act(state, 'jordan', { type: 'task/send-back', id: 'maple-estimate', note: 'Add the gutter line' });
  state = act(state, 'riley', { type: 'task/advance', id: 'maple-estimate' });
  state = act(state, 'jordan', { type: 'task/send-back', id: 'maple-estimate', note: 'Wrong shingle color' });
  const history = Object.fromEntries(handoffHistory(state).map(item => [item.taskId, item]));
  assert.equal(history['warranty-docs']!.reassignments, 3);
  assert.equal(history['maple-estimate']!.sendBacks, 2);
  const kinds = new Set(followUps(state, T0, 'jordan').map(item => item.kind));
  for (const kind of ['no-owner', 'stalled', 'unanswered-lead', 'missed-deadline', 'handoff-failure'] as const) assert.ok(kinds.has(kind), kind);
  const failure = followUps(state, T0, 'jordan').filter(item => item.kind === 'handoff-failure').map(item => item.source.id).sort();
  assert.deepEqual(failure, ['maple-estimate', 'warranty-docs']);
  // Every suggested one-click action works for its handler.
  for (const item of followUps(state, T0, 'jordan')) {
    if (!item.suggested) continue;
    const actor = item.handler || 'jordan';
    const action = item.suggested.offer ? actionFor(item.suggested.offer, { note: '' }, actor)! : item.suggested.action!;
    assert.ok(apply(state, action, { actor, now: T0, newId: () => 'probe' }).ok, item.id);
  }
});

test('daily signal: Task-HQ only, source-linked; other channels reported as not connected', () => {
  let state = seedState(T0);
  state = act(state, 'maya', { type: 'task/advance', id: 'staging-area' }, T0 + MINUTE);
  state = act(state, 'alex', { type: 'task/request-help', id: 'crew-handoff', note: 'Which gate?', helper: 'maya' }, T0 + 2 * MINUTE);
  const signal = dailySignal(state, T0 + HOUR);
  assert.equal(signal.day, localDate(T0));
  assert.deepEqual(signal.sources.filter(item => item.status === 'connected').map(item => item.id), ['task-hq']);
  assert.ok(signal.sources.find(item => item.id === 'email')!.note.includes('Private mail is never read'));
  assert.equal(signal.entries.length, 2);
  assert.ok(signal.entries.every(item => item.source.kind === 'event' && exists(state, 'event', item.source.id)));
  assert.equal(signal.totals.helpRequests, 1);
  assert.equal(signal.totals.completed, 2, 'site-plan (seed) and staging-area completed today, from task records');
  assert.match(signal.summary, /Synthetic demo data/);
});

test('voice-first commands: every documented phrase parses; text is the working input', () => {
  for (const command of EXEC_COMMANDS) for (const example of command.examples) assert.equal(parseExecCommand(example), command.id, example);
  assert.equal(parseExecCommand('order pizza'), null);
  const state = seedState(T0);
  const input = { modality: 'text' as const, principal: 'jordan', now: T0 };
  assert.match(runExecCommand(state, { ...input, text: 'What’s holding us up?' }).spoken, /permit schedule/);
  const needs = runExecCommand(state, { ...input, text: 'Who needs me?' });
  assert.equal(needs.kind, 'query');
  assert.ok(needs.sources.some(item => item.id === 'maple-estimate'));
  assert.match(runExecCommand(state, { ...input, text: 'Summarize my day' }).spoken, /^Jordan, /);
  assert.equal(runExecCommand(state, { ...input, text: 'sing a song' }).kind, 'unsupported');
});

test('“assign this to the right person” proposes, and only confirmation changes anything', () => {
  const state = seedState(T0);
  const input = { modality: 'voice' as const, principal: 'jordan', now: T0, text: 'Assign this to the right person' };
  assert.equal(runExecCommand(state, input).kind, 'unsupported', 'needs a selected task or lead');
  const before = fingerprint(state);
  const proposal = runExecCommand(state, { ...input, subject: { taskId: 'shingle-order' } });
  assert.equal(proposal.kind, 'action');
  assert.equal(fingerprint(state), before);
  if (proposal.kind !== 'action') return;
  assert.match(proposal.preview, /Nothing changes until you confirm/);
  const after = act(state, 'jordan', actionFor(proposal.offer, { note: '' }, 'jordan')!);
  assert.equal(taskById(after, 'shingle-order')!.owner, proposal.offer.preset.person);
});

test('executive outputs are deterministic for the same state and time', () => {
  const state = seedState(T0);
  assert.deepEqual(executiveBrief(state, T0, 'jordan'), executiveBrief(seedState(T0), T0, 'jordan'));
  assert.deepEqual(decisionDesk(state, T0, 'jordan'), decisionDesk(seedState(T0), T0, 'jordan'));
});
