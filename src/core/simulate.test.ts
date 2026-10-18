// Deterministic simulation: seeded random walks of every persona through the
// engine, checking workflow invariants after each step. A failure prints the
// seed, step and recent action trace so it can be replayed exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, ContactChannel, ContactOutcome, QuestState, Section } from './contract.ts';
import { apply, fingerprint, reconcile } from './engine.ts';
import { seedState, simulatedLead } from './seed.ts';
import { insights } from './rules.ts';
import { situationsFor } from './compose.ts';
import { decisionDesk, executiveBrief } from './executive.ts';
import { actionFor } from './capabilities.ts';
import type { ActionOffer, InputSpec } from './capabilities.ts';
import { leadById, person, taskById } from './selectors.ts';
import { MINUTE, localDate } from './time.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const ACTORS = ['jordan', 'maya', 'alex', 'sam', 'riley', 'abraham'];
const OPERATIONAL = ACTORS.filter(id => id !== 'abraham');
const SECTIONS: Section[] = ['company-work', 'needs-attention', 'leads', 'create-task'];
const CHANNELS: ContactChannel[] = ['phone', 'text', 'email', 'in-person'];
const OUTCOMES: ContactOutcome[] = ['reached', 'no-answer', 'left-message'];
const MAX_EVENTS = 400;

/** mulberry32: small, seedable, good enough for test walks. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const chance = (rng: Rng, p: number) => rng() < p;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function randomAction(state: QuestState, rng: Rng, now: number): Action {
  const taskId = () => (chance(rng, 0.04) || state.tasks.length === 0 ? 'ghost-task' : pick(rng, state.tasks).id);
  const leadId = () => (chance(rng, 0.04) || state.leads.length === 0 ? 'ghost-lead' : pick(rng, state.leads).id);
  const grantId = () => (state.grants.length === 0 || chance(rng, 0.04) ? 'ghost-grant' : pick(rng, state.grants).id);
  const someone = () => (chance(rng, 0.15) ? '' : chance(rng, 0.05) ? 'abraham' : pick(rng, OPERATIONAL));
  const note = () => (chance(rng, 0.1) ? '  ' : 'note');
  const due = () => localDate(now + Math.floor(rng() * 7 - 3) * 24 * 60 * MINUTE);
  const deps = () => (chance(rng, 0.5) || state.tasks.length === 0 ? [] : [taskId()]);
  switch (Math.floor(rng() * 24)) {
    case 0: return { type: 'task/create', task: { title: chance(rng, 0.05) ? '' : `Sim task ${state.rev}`, owner: someone(), nextOwner: someone(), approver: chance(rng, 0.3) ? someone() : '', dependsOn: deps(), nextAction: chance(rng, 0.5) ? 'do it' : '', priority: chance(rng, 0.3) ? 'high' : 'normal', due: chance(rng, 0.5) ? due() : '' } };
    case 1: {
      const changes = pick(rng, [{ owner: someone() }, { nextOwner: someone() }, { approver: someone() }, { nextAction: chance(rng, 0.5) ? '' : 'next' }, { due: due() }, { priority: 'high' as const }, { dependsOn: deps() }]);
      return { type: 'task/update', id: taskId(), changes };
    }
    case 2: case 3: case 4: return { type: 'task/advance', id: taskId() };
    case 5: return { type: 'task/request-help', id: taskId(), note: note(), helper: someone() };
    case 6: return { type: 'task/resolve', id: taskId(), note: 'sorted' };
    case 7: return { type: 'task/send-back', id: taskId(), note: note() };
    case 8: return { type: 'task/handoff', id: taskId(), to: someone(), note: chance(rng, 0.5) ? 'first step' : undefined };
    case 9: return { type: 'ultra/activate', taskId: taskId() };
    case 10: return { type: 'ultra/release', reason: 'sim' };
    case 11: return { type: 'grant/request', section: pick(rng, SECTIONS), reason: note() };
    case 12: return { type: 'grant/decide', id: grantId(), approve: chance(rng, 0.7), seconds: chance(rng, 0.5) ? undefined : Math.floor(rng() * 900) };
    case 13: return chance(rng, 0.5) ? { type: 'grant/return', id: grantId() } : { type: 'grant/revoke', id: grantId() };
    case 14: return { type: 'lead/receive', lead: simulatedLead(Math.floor(rng() * 5)) };
    case 15: return { type: 'lead/assign', id: leadId(), to: someone() };
    case 16: return { type: 'lead/attempt', id: leadId(), channel: pick(rng, CHANNELS), outcome: pick(rng, OUTCOMES) };
    case 17: return { type: 'lead/qualify', id: leadId() };
    case 18: return { type: 'lead/block', id: leadId(), note: note() };
    case 19: return { type: 'lead/follow-up', id: leadId(), due: due(), note: chance(rng, 0.5) ? 'send the quote' : undefined };
    case 20: return { type: 'lead/advance', id: leadId() };
    case 21: return { type: 'lead/escalate', id: leadId(), note: note() };
    case 22: return { type: 'policy/update', changes: pick(rng, [{ ultraScope: 'company-wide' as const }, { ultraScope: 'manager-context' as const }, { grantSeconds: 60 }]) };
    default: {
      const undoable = state.events.filter(event => event.undo && !event.undone).slice(0, 6);
      return { type: 'undo', eventId: undoable.length ? pick(rng, undoable).id : 'ghost-event' };
    }
  }
}

/** Structural invariants every reachable state must satisfy. */
function violations(state: QuestState, now: number): string[] {
  const out: string[] = [];
  const ids = new Set(state.tasks.map(task => task.id));
  if (ids.size !== state.tasks.length) out.push('duplicate task ids');
  const canHold = (id: string) => id === '' || (!!person(state, id) && person(state, id)!.role !== 'reviewer');
  for (const task of state.tasks) {
    for (const dep of task.dependsOn) if (!ids.has(dep)) out.push(`dangling dependency: ${task.id} → ${dep}`);
    for (const field of ['owner', 'nextOwner', 'approver', 'decisionOwner'] as const) {
      if (!canHold(task[field])) out.push(`${task.id}.${field} = "${task[field]}" cannot hold work`);
    }
    if ((task.status === 'done') !== (task.completedAt !== null)) out.push(`${task.id}: status ${task.status} with completedAt ${task.completedAt}`);
    if ((task.status === 'blocked') !== (task.blocker !== null)) out.push(`${task.id}: status ${task.status} with blocker ${task.blocker ? 'set' : 'null'}`);
    if (task.ultra && state.focus?.taskId !== task.id) out.push(`${task.id}: ultra without matching focus`);
  }
  // Cycles: walk dependencies from each task.
  const byId = new Map(state.tasks.map(task => [task.id, task]));
  for (const task of state.tasks) {
    const seen = new Set<string>();
    const stack = [...task.dependsOn];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === task.id) { out.push(`dependency cycle through ${task.id}`); break; }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.dependsOn ?? []));
    }
  }
  if (state.focus) {
    const focusTask = byId.get(state.focus.taskId);
    if (!focusTask) out.push(`focus on missing task ${state.focus.taskId}`);
    else {
      if (focusTask.status === 'done') out.push(`focus on done task ${focusTask.id}`);
      if (!focusTask.ultra) out.push(`focus task ${focusTask.id} is not ultra`);
    }
  }
  for (const grant of state.grants) {
    if ((grant.status === 'pending' || grant.status === 'approved') && !state.focus) out.push(`open grant ${grant.id} (${grant.status}) without focus`);
    if (grant.status === 'approved' && grant.expiresAt === null) out.push(`approved grant ${grant.id} has no expiry`);
    if (grant.status === 'approved' && grant.expiresAt !== null && grant.expiresAt <= now) out.push(`approved grant ${grant.id} outlived its expiry`);
  }
  for (const lead of state.leads) if (!canHold(lead.assignee)) out.push(`lead ${lead.id}.assignee = "${lead.assignee}" cannot hold work`);
  if (state.events.length > MAX_EVENTS) out.push(`events exceed ${MAX_EVENTS}`);
  return out;
}

/** Every one-click insight action must be accepted for the person it is shown to. */
function deadInsightActions(state: QuestState, now: number): string[] {
  const out: string[] = [];
  const list = insights(state, now);
  if (new Set(list.map(item => item.id)).size !== list.length) out.push('duplicate insight ids');
  for (const item of list) {
    if (!item.action) continue;
    if (!item.who) { out.push(`${item.kind} ${item.id}: action “${item.action.label}” offered to nobody`); continue; }
    const result = apply(state, item.action.do, { actor: item.who, now, newId: () => 'probe' });
    if (!result.ok) out.push(`${item.kind} ${item.id}: “${item.action.label}” refused for ${item.who}: ${result.error}`);
  }
  return out;
}

function sample(input: InputSpec, state: QuestState, actor: string, now: number) {
  if (input.kind === 'text') return 'sample';
  if (input.kind === 'date') return localDate(now);
  if (input.kind === 'person') return state.people.find(item => item.id !== actor && item.role !== 'reviewer')?.id ?? actor;
  return input.options?.[0]?.value ?? '';
}

/** Every composed offer must be accepted when performed with ordinary input. */
function unsoundOffers(state: QuestState, now: number): string[] {
  const out: string[] = [];
  for (const actor of ACTORS) {
    for (const situation of situationsFor(state, actor, now)) {
      for (const item of [...situation.actions, ...situation.more] as ActionOffer[]) {
        const values = Object.fromEntries(item.inputs.map(input => [input.name, sample(input, state, actor, now)]));
        const action = actionFor(item, values, actor);
        if (!action) { out.push(`${actor}: offer ${item.key} builds no action`); continue; }
        const result = apply(state, action, { actor, now, newId: () => 'probe' });
        if (!result.ok) out.push(`${actor}: offer ${item.key} refused: ${result.error}`);
      }
    }
  }
  return out;
}

/** Decision Desk options say “supported” only when the engine accepts them; brief sources all exist. */
function unsoundDesk(state: QuestState, now: number): string[] {
  const out: string[] = [];
  for (const principal of ['jordan', 'maya']) {
    for (const decision of decisionDesk(state, now, principal)) {
      if (decision.options.filter(item => item.recommended).length > 1) out.push(`${decision.id}: more than one recommended option`);
      for (const option of decision.options) {
        if (!option.supported) { if (!option.refusal) out.push(`${decision.id}/${option.key}: refused without a reason`); continue; }
        const values = option.offer ? Object.fromEntries(option.offer.inputs.map(input => [input.name, sample(input, state, principal, now)])) : {};
        const action = option.offer ? actionFor(option.offer, values, principal) : option.action;
        const result = action ? apply(state, action, { actor: principal, now, newId: () => 'probe' }) : null;
        if (!result?.ok) out.push(`${principal}: ${decision.id}/${option.key} marked supported but refused: ${result && !result.ok ? result.error : 'no action'}`);
      }
    }
    for (const section of executiveBrief(state, now, principal).sections) for (const item of section.items) {
      const { kind, id } = item.source;
      const found = kind === 'task' ? taskById(state, id) : kind === 'lead' ? leadById(state, id) : kind === 'grant' ? state.grants.find(g => g.id === id) : state.events.find(e => e.id === id);
      if (!found) out.push(`brief ${section.key}: missing source ${kind}:${id}`);
    }
  }
  return out;
}

interface Finding { check: string; detail: string; seed: number; step: number; trace: string[] }

function walk(seed: number, steps: number, options: { offers: boolean }) {
  const rng = prng(seed);
  let now = T0;
  let n = 0;
  const newId = () => `s${seed}-${++n}`;
  let state = deepFreeze(seedState(T0));
  const trace: string[] = [];
  const findings: Finding[] = [];
  const note = (check: string, detail: string, step: number) => findings.push({ check, detail, seed, step, trace: trace.slice(-8) });

  for (let step = 0; step < steps; step += 1) {
    if (chance(rng, 0.25)) now += Math.floor(rng() * 40) * MINUTE;
    if (chance(rng, 0.03)) now += 30 * 60 * MINUTE;
    state = deepFreeze(reconcile(state, now, 'sim').state);

    const action = randomAction(state, rng, now);
    // Access requests only come from the person in Critical Focus; make them likely.
    const actor = action.type === 'grant/request' && state.focus && chance(rng, 0.8) ? state.focus.employee : pick(rng, ACTORS);
    trace.push(`${step} t+${Math.round((now - T0) / MINUTE)}m ${actor} ${JSON.stringify(action)}`);
    // State is deep-frozen, so any mutation of the input throws inside apply().
    let result;
    try {
      result = apply(state, action, { actor, now, newId, writer: 'sim' });
    } catch (error) {
      note('apply threw', String(error), step);
      break;
    }
    if (!result.ok) {
      if (result.state !== state) note('refusal changed state', `${action.type}: ${result.error}`, step);
      continue;
    }
    if (result.state.rev !== state.rev + 1) note('rev', `${action.type}: ${state.rev} → ${result.state.rev}`, step);
    state = deepFreeze(result.state);
    trace[trace.length - 1] += ' ✓';

    for (const detail of violations(state, now)) note('state invariant', detail, step);
    for (const detail of deadInsightActions(state, now)) note('insight action', detail, step);
    if (options.offers && step % 5 === 0) for (const detail of unsoundOffers(state, now)) note('composed offer', detail, step);
    if (options.offers && step % 2 === 0) for (const detail of unsoundDesk(state, now)) note('decision desk', detail, step);
  }
  return { state, findings };
}

function report(findings: Finding[]) {
  const first = new Map<string, Finding>();
  for (const item of findings) {
    const key = `${item.check}: ${item.detail.replace(/s\d+-\d+/g, '<id>')}`;
    if (!first.has(key)) first.set(key, item);
  }
  return [...first.entries()].map(([key, item]) => `${key}\n  seed ${item.seed} step ${item.step}\n    ${item.trace.join('\n    ')}`).join('\n\n');
}

test('simulation: same seed produces the same workspace', () => {
  const a = walk(7, 120, { offers: false }).state;
  const b = walk(7, 120, { offers: false }).state;
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(walk(8, 120, { offers: false }).state));
});

test('simulation: 200 seeded walks keep every workflow invariant and one-click insight action', () => {
  const findings: Finding[] = [];
  for (let seed = 1; seed <= 200; seed += 1) findings.push(...walk(seed, 60, { offers: false }).findings);
  assert.equal(findings.length, 0, `\n${report(findings)}`);
});

test('simulation: composed offers and Decision Desk options are accepted by the engine when performed', () => {
  const findings: Finding[] = [];
  for (let seed = 1001; seed <= 1040; seed += 1) findings.push(...walk(seed, 40, { offers: true }).findings);
  const relevant = findings.filter(item => item.check === 'composed offer' || item.check === 'decision desk');
  assert.equal(relevant.length, 0, `\n${report(relevant)}`);
});

// ── Regressions found by the walks above ───────────────────────────────────

function act(state: QuestState, actor: string, action: Action, now = T0) {
  let n = 0;
  const result = apply(state, action, { actor, now, newId: () => `r${state.rev}-${++n}` });
  assert.ok(result.ok, result.ok ? '' : `${action.type} by ${actor}: ${result.error}`);
  return result;
}

test('handing a lead on completes its blocked follow-up task cleanly', () => {
  let state = seedState(T0);
  state = act(state, 'sam', { type: 'lead/follow-up', id: 'lead-brightline', due: localDate(T0) }).state;
  const followUp = state.leads.find(lead => lead.id === 'lead-brightline')!.followUpTaskId;
  state = act(state, 'sam', { type: 'task/request-help', id: followUp, note: 'Need the quote template', helper: 'maya' }).state;
  state = act(state, 'sam', { type: 'lead/advance', id: 'lead-brightline' }).state;
  const done = state.tasks.find(task => task.id === followUp)!;
  assert.equal(done.status, 'done');
  assert.equal(done.blocker, null, 'a done task keeps no blocker');
  assert.deepEqual(violations(state, T0), []);
});

test('undoing a task creation is refused once other work depends on it', () => {
  let state = seedState(T0);
  const created = act(state, 'maya', { type: 'task/create', task: { title: 'Measure the garage', owner: 'alex' } });
  state = created.state;
  state = act(state, 'riley', { type: 'task/create', task: { title: 'Order garage flashing', owner: 'riley', dependsOn: [created.event!.taskId!] } }).state;
  const result = apply(state, { type: 'undo', eventId: created.event!.id }, { actor: 'maya', now: T0 });
  assert.equal(result.ok, false);
  assert.deepEqual(violations(state, T0), []);
});

test('a review task with no approver asks a manager, and the button works for them', () => {
  const state = act(seedState(T0), 'maya', { type: 'task/update', id: 'maple-estimate', changes: { approver: '' } }).state;
  const approval = insights(state, T0).find(item => item.id === 'approval-maple-estimate')!;
  assert.equal(approval.who, 'jordan');
  assert.ok(approval.action);
  assert.deepEqual(deadInsightActions(state, T0), []);
});

test('Critical Focus hides one-click actions the focused person cannot take, but keeps the insight', () => {
  let state = act(seedState(T0), 'maya', { type: 'task/advance', id: 'staging-area' }).state;
  assert.ok(insights(state, T0).find(item => item.id === 'ready-crew-handoff')?.action, 'offered before focus');
  state = act(state, 'jordan', { type: 'ultra/activate', taskId: 'maple-tarp' }).state;
  const ready = insights(state, T0).find(item => item.id === 'ready-crew-handoff')!;
  assert.equal(ready.who, 'alex');
  assert.equal(ready.action, undefined);
  assert.deepEqual(deadInsightActions(state, T0), []);
});

test('an access request is never routed back to the person who made it', () => {
  let state = act(seedState(T0), 'jordan', { type: 'task/update', id: 'safety-brief', changes: { owner: 'jordan' } }).state;
  state = act(state, 'jordan', { type: 'ultra/activate', taskId: 'safety-brief' }).state;
  state = act(state, 'jordan', { type: 'grant/request', section: 'leads', reason: 'Check the new lead' }).state;
  const request = insights(state, T0).find(item => item.kind === 'ultra-request')!;
  assert.notEqual(request.who, 'jordan');
  assert.equal(request.action, undefined);
});
