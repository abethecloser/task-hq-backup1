import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from '../contract.ts';
import { apply } from '../engine.ts';
import { DEMO_PEOPLE, REVIEWER_PERSONA, seedState } from '../seed.ts';
import { evaluate, evaluateAll, parseFormula } from './formula.ts';
import { price, priceUnder } from './pricing.ts';
import type { PricingInput } from './pricing.ts';
import { baseValues, computeTakeoff } from './takeoff.ts';
import type { Takeoff } from './takeoff.ts';
import type { ToolAction, ToolContext, ToolsState } from './estimating.ts';
import { applyTool, approveEstimateBlocker, approvalCurrent, canEditEstimate, estimateNumbers, inputsHash, proposalStale } from './estimating.ts';
import { seedTools } from './seed.ts';
import { runTaskHooks } from './hooks.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const people = [...DEMO_PEOPLE, REVIEWER_PERSONA];

// ── Formula engine ─────────────────────────────────────────────────────────

test('formulas: precedence, every supported function, and float noise never rounds a box up', () => {
  const at = (src: string, refs: Record<string, number> = {}) => evaluate(parseFormula(src), name => refs[name]!);
  assert.equal(at('2 + 3 * 4'), 14);
  assert.equal(at('(2 + 3) * 4'), 20);
  assert.equal(at('-2 + -(3)'), -5);
  assert.equal(50 * (1 + 10 / 100), 55.00000000000001, 'the float trap is real');
  assert.equal(at('ROUNDUP({SQ} * (1 + 10 / 100))', { SQ: 50 }), 55, 'not 56');
  assert.equal(at('ROUNDUP({SQ} * 1.12)', { SQ: 25 }), 28, 'not 29');
  assert.equal(at('ROUNDUP(2.341, 2)'), 2.35);
  assert.equal(at('ROUNDDOWN(2.349, 1)'), 2.3);
  assert.equal(at('ROUND(2.5)'), 3);
  assert.equal(at('round(-2.5)'), -3, 'ROUND rounds half away from zero, like a spreadsheet');
  assert.equal(at('CEILING(23, 5)'), 25);
  assert.equal(at('FLOOR(23, 5)'), 20);
  assert.equal(at('MIN(4, 2, 9) + MAX(1, 7) + ABS(-3)'), 12);
});

test('formulas: refuses anything outside the language, never executes text', () => {
  for (const [src, message] of [
    ['alert(1)', /isn’t a supported function/], ['constructor', /isn’t a supported function/], ['{a} +', /ends too early/],
    ['2 3', /Unexpected/], ['{a', /never closed/], ['ROUNDUP()', /takes 1–2 arguments/], ['', /Write a formula/], ['1; 2', /Unexpected/],
  ] as const) assert.throws(() => parseFormula(src), message, src);
  assert.throws(() => evaluate(parseFormula('1 / ({a} - 1)'), () => 1), /Division by zero/);
});

test('formulas: lines can use each other in any order; cycles, unknown names and missing measurements are reported per line', () => {
  const results = evaluateAll([
    { name: 'Bundles', formula: '{Squares} * 3' }, { name: 'Squares', formula: 'ROUNDUP({Total SQ})' },
    { name: 'A', formula: '{B} + 1' }, { name: 'B', formula: '{A} + 1' },
    { name: 'Ghost', formula: '{Nope}' }, { name: 'Needs hips', formula: '{Hips}' }, { name: 'Typed', typed: 4 },
  ], { 'Total SQ': 20.2, Hips: null });
  const by = Object.fromEntries(results.map(item => [item.name, item]));
  assert.equal(by.Bundles!.value, 63);
  assert.match(by.A!.error!, /refer to each other/);
  assert.match(by.Ghost!.error!, /Nothing called “nope”/);
  assert.match(by['Needs hips']!.error!, /hasn’t been measured/);
  assert.equal(by.Typed!.value, 4);
});

// ── Pricing engine ─────────────────────────────────────────────────────────

const fixture = (p: number | null): PricingInput => ({ direct: { material: 10000, tax: 0, labor: 5000, permits: 0, disposal: 0, other: 0 }, rates: { overhead: 10, commission: 5, contingency: 5 }, target: 30, price: p });

test('pricing: hand-checked figures under both formulas', () => {
  const full = price(fixture(30000), 'full-burden', 2.5);
  assert.deepEqual(
    [full.directTotal, full.variableRate, full.variableCost, full.totalCost, full.grossProfit, full.margin, full.marginGap, full.priceAtTarget, full.breakEven, full.maxDirectAtTarget, full.directHeadroom, full.decision],
    [15000, 20, 6000, 21000, 9000, 30, 0, 30000, 18750, 15000, 0, 'meets-target']);
  const comm = price(fixture(30000), 'commission-only', 2.5);
  assert.deepEqual(
    [comm.variableRate, comm.variableCost, comm.totalCost, comm.grossProfit, comm.margin, comm.marginGap, comm.priceAtTarget, comm.breakEven, comm.maxDirectAtTarget, comm.directHeadroom],
    [5, 1500, 16500, 13500, 45, 15, 23076.92, 15789.47, 19500, 4500]);
  // Legacy statements this engine reproduces (inventory §2 A and C).
  assert.equal(full.variableCost, 30000 * (10 + 5 + 5) / 100, 'A: overhead+commission+contingency cost = price × sum of rates');
  assert.equal(comm.priceAtTarget, Math.round(15000 / (1 - 0.05 - 0.30) * 100) / 100, 'C: target quote = hard cost ÷ (1 − commission − target)');
});

test('pricing: review band is a setting; undecided policy prices both ways; impossible targets are explained', () => {
  assert.equal(price(fixture(29000), 'full-burden', 2.5).decision, 'review');
  assert.equal(price(fixture(29000), 'full-burden', 1).decision, 'reprice');
  assert.equal(price(fixture(27000), 'full-burden', 2.5).decision, 'reprice');
  assert.equal(price(fixture(null), 'full-burden', 2.5).decision, 'incomplete');
  assert.deepEqual(priceUnder('undecided', fixture(30000), 2.5).map(r => r.formula), ['full-burden', 'commission-only']);
  const impossible = price({ ...fixture(30000), rates: { overhead: 40, commission: 20, contingency: 10 } }, 'full-burden', 2.5);
  assert.equal(impossible.priceAtTarget, null);
  assert.match(impossible.problems.join(' '), /reach 100%/);
});

// ── Takeoff ────────────────────────────────────────────────────────────────

test('takeoff: job waste with a per-measurement override; lines roll up automatically; pitch never changes waste', () => {
  const takeoff: Takeoff = {
    measurements: { totalSq: 20, valleys: 40 }, wastePct: 10, overrides: { valleys: 15 }, pitch: '12/12', measuredOn: '', source: 'report', reports: [], crew: { size: 3, days: 2, hours: 8, rate: 30 },
    lines: [
      { id: 'a', group: 'material', name: 'Shingles', unit: 'bundle', formula: 'ROUNDUP({Total SQ + waste} * 3)', typed: null, unitCost: 40 },
      { id: 'b', group: 'material', name: 'Valley', unit: '10 ft', formula: 'ROUNDUP({Valleys + waste} / 10)', typed: null, unitCost: 20 },
      { id: 'c', group: 'labor', name: 'Install', unit: 'SQ', formula: '{Total SQ}', typed: null, unitCost: 100 },
    ],
  };
  const base = baseValues(takeoff);
  assert.equal(base['Total SQ + waste'], 22);
  assert.equal(baseValues({ ...takeoff, measurements: { totalSq: 50 } })['Total SQ + waste'], 55, '50 SQ at 10% is 55, not 55.00000000000001');
  assert.equal(base['Valleys + waste'], 46);
  const result = computeTakeoff(takeoff);
  assert.deepEqual(result.lines.map(line => line.value), [66, 5, 20]);
  assert.equal(result.material, 66 * 40 + 5 * 20);
  assert.equal(result.manHours, 48);
  assert.equal(result.labor, 2000 + 48 * 30);
  assert.deepEqual(computeTakeoff({ ...takeoff, pitch: '4/12' }).lines.map(line => line.value), [66, 5, 20]);
});

// ── Records, gates and tasks ───────────────────────────────────────────────

let seq = 0;
const ctxFor = (actor: string, open: Set<string> = new Set()): ToolContext => ({ actor, now: T0, people, newId: () => `t${++seq}`, taskOpen: id => open.has(id), today: '2026-10-17' });
function run(state: ToolsState, action: ToolAction, actor: string, open?: Set<string>) {
  const result = applyTool(state, action, ctxFor(actor, open));
  if (!result.ok) throw new Error(`${action.type} as ${actor}: ${result.error}`);
  return result;
}
const refuse = (state: ToolsState, action: ToolAction, actor: string, message: RegExp) => {
  const result = applyTool(state, action, ctxFor(actor));
  assert.equal(result.ok, false, `${action.type} as ${actor} should be refused`);
  if (!result.ok) assert.match(result.error, message);
};
/** Seed with Maple priced to meet target under full burden. */
function priced(): ToolsState {
  const state = seedTools('org-a', T0, people);
  const maple = state.estimates[0]!;
  const target = estimateNumbers(maple, { ...state.config, policy: { ...state.config.policy, formula: 'full-burden' } }).decided!.priceAtTarget!;
  return run(state, { type: 'estimate/update', id: maple.id, changes: { price: Math.ceil(target) } }, 'riley').state;
}

test('an undecided pricing formula blocks approval; a recorded demo decision unblocks it', () => {
  let state = priced();
  const submitted = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley');
  state = submitted.state;
  assert.equal(state.estimates[0]!.status, 'needs-review', 'undecided policy always needs review');
  assert.equal(submitted.tasks[0]!.key, 'review');
  assert.equal(submitted.tasks[0]!.task.owner, 'jordan');
  refuse(state, { type: 'estimate/approve', id: 'est-maple', note: 'ok' }, 'jordan', /hasn’t been decided/);
  refuse(state, { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'riley', /Only a manager/);
  const decided = run(state, { type: 'policy/decide', formula: 'full-burden', note: 'Demo only', demo: true }, 'jordan');
  assert.equal(decided.state.config.policy.decidedBy, 'jordan');
  assert.equal(decided.state.config.policy.demo, true);
  assert.match(decided.state.log[0]!.text, /for this demo only/);
  const approved = run(decided.state, { type: 'estimate/approve', id: 'est-maple', note: '' }, 'jordan');
  assert.equal(approved.state.estimates[0]!.status, 'approved');
  assert.equal(approved.tasks[0]!.key, 'proposal');
});

test('approval is bound to its inputs: an edit after approval voids it and blocks every proposal step', () => {
  let state = run(priced(), { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'jordan').state;
  state = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley').state;
  state = run(state, { type: 'estimate/approve', id: 'est-maple', note: '' }, 'jordan').state;
  assert.ok(approvalCurrent(state.estimates[0]!, state.config));
  // Even a record that still says "approved" is not current if its numbers differ from what was approved.
  assert.equal(approvalCurrent({ ...state.estimates[0]!, price: state.estimates[0]!.price! + 1 }, state.config), false);
  assert.equal(approvalCurrent(state.estimates[0]!, { ...state.config, reviewBand: state.config.reviewBand + 1 }), false);
  state = run(state, { type: 'proposal/create', estimateId: 'est-maple', templateId: 'shingle' }, 'riley').state;
  const proposal = state.proposals[0]!;
  assert.equal(proposal.snapshot.price, state.estimates[0]!.approval!.price, 'the proposal snapshots the approved price');
  refuse(state, { type: 'proposal/create', estimateId: 'est-maple', templateId: 'shingle' }, 'riley', /already uses this approved price/);
  state = run(state, { type: 'proposal/submit', id: proposal.id }, 'riley').state;
  // Change one material cost after approval.
  const maple = state.estimates[0]!;
  const lines = maple.takeoff.lines.map((line, index) => (index === 0 ? { ...line, unitCost: line.unitCost + 5 } : line));
  const edited = run(state, { type: 'estimate/update', id: maple.id, changes: { takeoff: { ...maple.takeoff, lines } } }, 'riley');
  state = edited.state;
  assert.equal(state.estimates[0]!.status, 'draft');
  assert.equal(state.estimates[0]!.approval, null);
  assert.equal(state.estimates[0]!.voided.length, 1);
  assert.equal(state.proposals[0]!.snapshot.price, proposal.snapshot.price, 'the proposal keeps its snapshot, it does not read live numbers');
  assert.ok(proposalStale(state.proposals[0]!, state));
  refuse(state, { type: 'proposal/approve', id: proposal.id, note: '' }, 'jordan', /changed or lost its approval/);
  refuse(state, { type: 'proposal/create', estimateId: 'est-maple', templateId: 'shingle' }, 'riley', /only be made from an approved price/);
  // Changing the formula also voids approvals.
  let again = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley').state;
  const priceNow = estimateNumbers(again.estimates[0]!, again.config).decided!;
  if (priceNow.decision === 'reprice' || priceNow.decision === 'review') again = run(run(again, { type: 'estimate/update', id: 'est-maple', changes: { price: Math.ceil(priceNow.priceAtTarget!) } }, 'riley').state, { type: 'estimate/submit', id: 'est-maple' }, 'riley').state;
  again = run(again, { type: 'estimate/approve', id: 'est-maple', note: '' }, 'jordan').state;
  const switched = run(again, { type: 'policy/decide', formula: 'commission-only', note: '', demo: true }, 'jordan');
  assert.equal(switched.state.estimates[0]!.status, 'draft');
  assert.match(switched.message, /need approval again/);
});

test('who may approve: never the preparer by default, never a field lead or the reviewer persona; self-approval is a setting', () => {
  let state = run(priced(), { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'jordan').state;
  // Jordan prepares their own estimate and picks themself as approver: refused by default.
  state = run(state, { type: 'estimate/create', title: 'Own job', customer: { name: 'X', phone: '', email: '' }, address: '1 Test St', trade: 'Roofing', fromLibrary: false }, 'jordan').state;
  const own = state.estimates[0]!;
  refuse(state, { type: 'estimate/update', id: own.id, changes: { approver: 'jordan' } }, 'jordan', /can’t approve this price/);
  state = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley').state;
  const maple = state.estimates.find(item => item.id === 'est-maple')!;
  for (const actor of ['riley', 'maya', 'alex', 'sam']) assert.ok(approveEstimateBlocker(state, maple, actor, people), actor);
  refuse(state, { type: 'estimate/approve', id: 'est-maple', note: '' }, 'abraham', /Reviewers/);
  refuse(state, { type: 'estimate/approve', id: 'est-maple', note: '' }, 'alex', /pricing approver/);
  assert.equal(approveEstimateBlocker(state, maple, 'jordan', people), null);
  const estimatorsToo = run(state, { type: 'config/update', changes: { approverRoles: ['manager', 'estimator'] } }, 'jordan').state;
  assert.match(approveEstimateBlocker(estimatorsToo, maple, 'riley', people)!, /prepared a price can’t approve it/, 'an estimator may approve, but not their own price');
  const relaxed = run(state, { type: 'config/update', changes: { allowSelfApproval: true, approverRoles: ['manager', 'estimator'] } }, 'jordan').state;
  assert.equal(approveEstimateBlocker(relaxed, maple, 'riley', people), 'This price is waiting on Jordan Lee.', 'still waits on the named approver');
});

test('authority parity: the UI predicates match what the reducer does for every person', () => {
  let state = run(priced(), { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'jordan').state;
  state = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley').state;
  for (const p of people) {
    const maple = state.estimates.find(item => item.id === 'est-maple')!;
    const elm = state.estimates.find(item => item.id === 'est-elm')!;
    const approve = applyTool(state, { type: 'estimate/approve', id: maple.id, note: 'reason given' }, ctxFor(p.id));
    assert.equal(approve.ok, approveEstimateBlocker(state, maple, p.id, people) === null && p.role !== 'reviewer', `approve as ${p.id}`);
    const edit = applyTool(state, { type: 'estimate/update', id: elm.id, changes: { address: '48 Elm St (sample, edited)' } }, ctxFor(p.id));
    assert.equal(edit.ok, canEditEstimate(people, elm, p.id), `edit as ${p.id}`);
  }
});

test('task requests are idempotent: a step never asks twice while its task is open', () => {
  let state = run(priced(), { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'jordan').state;
  const first = run(state, { type: 'estimate/submit', id: 'est-maple' }, 'riley');
  state = run(first.state, { type: 'tasks/link', kind: 'estimate', id: 'est-maple', links: { review: 'task-review-1' } }, 'riley').state;
  const open = new Set(['task-review-1']);
  // Edit → back to draft (asks to close the open review), submit again while it is still open → no second request.
  const edited = run(state, { type: 'estimate/update', id: 'est-maple', changes: { extra: { permits: 451, disposal: 600, other: 0 } } }, 'riley', open);
  assert.deepEqual(edited.close, ['task-review-1']);
  const resubmitted = run(edited.state, { type: 'estimate/submit', id: 'est-maple' }, 'riley', open);
  assert.equal(resubmitted.tasks.length, 0);
  // Once that task is done, a new submission asks again.
  const later = run(edited.state, { type: 'estimate/submit', id: 'est-maple' }, 'riley', new Set());
  assert.equal(later.tasks.length, 1);
  const linked = run(state, { type: 'tasks/link', kind: 'estimate', id: 'est-elm', links: { measure: 'm1' } }, 'riley').state;
  const twice = applyTool(linked, { type: 'estimate/request-measurements', id: 'est-elm', to: 'alex', note: '' }, ctxFor('riley', new Set(['m1'])));
  assert.equal(twice.ok, false);
  if (!twice.ok) assert.match(twice.error, /already open/);
  assert.equal(applyTool(linked, { type: 'estimate/request-measurements', id: 'est-elm', to: 'alex', note: '' }, ctxFor('riley')).ok, true, 'allowed again once that task is done');
});

test('workspaces are isolated: one organization’s records are invisible to another’s', () => {
  const a = seedTools('org-a', T0, people);
  const b = run(seedTools('org-b', T0, people), { type: 'estimate/create', title: 'B only', customer: { name: '', phone: '', email: '' }, address: '', trade: 'Roofing', fromLibrary: false }, 'riley').state;
  const bOnly = b.estimates[0]!;
  refuse(a, { type: 'estimate/update', id: bOnly.id, changes: { title: 'stolen' } }, 'jordan', /no longer exists/);
  refuse(a, { type: 'proposal/create', estimateId: bOnly.id, templateId: 'shingle' }, 'jordan', /no longer exists/);
  assert.notEqual(a.orgId, b.orgId);
});

test('end to end through the task engine: measurements → approved price → proposal → recorded acceptance → handoff tasks', async () => {
  let quest: QuestState = seedState(T0);
  let tools = seedTools('demo', T0, people);
  let n = 0;
  const dispatchAs = (actor: string) => async (action: Action) => {
    const res = apply(quest, action, { actor, now: T0, newId: () => `e2e-${++n}` });
    if (!res.ok) return { ok: false as const, error: res.error };
    quest = res.state;
    return { ok: true as const, state: res.state, eventId: res.event?.id ?? null };
  };
  const open = () => new Set(quest.tasks.filter(task => task.status !== 'done').map(task => task.id));
  async function step(action: ToolAction, actor: string) {
    const res = applyTool(tools, action, { ...ctxFor(actor), taskOpen: id => open().has(id) });
    if (!res.ok) throw new Error(`${action.type}: ${res.error}`);
    tools = res.state;
    const hooks = await runTaskHooks(res.tasks, res.close, dispatchAs(actor));
    for (const link of hooks.links) tools = run(tools, link, actor).state;
    return hooks;
  }
  const asked = await step({ type: 'estimate/request-measurements', id: 'est-elm', to: 'alex', note: 'Report not in yet.' }, 'riley');
  assert.equal(quest.tasks.find(task => task.id === asked.created[0]!.taskId)!.owner, 'alex');
  tools = run(tools, { type: 'policy/decide', formula: 'full-burden', note: '', demo: true }, 'jordan').state;
  const maple = tools.estimates.find(item => item.id === 'est-maple')!;
  tools = run(tools, { type: 'estimate/update', id: maple.id, changes: { price: Math.ceil(estimateNumbers(maple, tools.config).decided!.priceAtTarget!) } }, 'riley').state;
  const submitted = await step({ type: 'estimate/submit', id: 'est-maple' }, 'riley');
  const reviewTask = submitted.created[0]!.taskId;
  assert.equal(quest.tasks.find(task => task.id === reviewTask)!.owner, 'jordan');
  const approved = await step({ type: 'estimate/approve', id: 'est-maple', note: '' }, 'jordan');
  assert.deepEqual(approved.closed, [reviewTask], 'the approver’s review task is finished through the engine');
  assert.equal(quest.tasks.find(task => task.id === reviewTask)!.status, 'done');
  await step({ type: 'proposal/create', estimateId: 'est-maple', templateId: 'shingle' }, 'riley');
  const proposal = tools.proposals[0]!;
  await step({ type: 'proposal/submit', id: proposal.id }, 'riley');
  const delivered = await step({ type: 'proposal/approve', id: proposal.id, note: 'Looks right.' }, 'jordan');
  assert.equal(delivered.created[0]!.key, 'deliver');
  refuse(tools, { type: 'proposal/record-decision', id: proposal.id, outcome: 'accepted', signer: 'Sample Homeowner A', note: '', handoffTo: 'maya' }, 'riley', /Only a manager/);
  const accepted = await step({ type: 'proposal/record-decision', id: proposal.id, outcome: 'accepted', signer: 'Sample Homeowner A', note: 'Signed paper copy.', handoffTo: 'maya' }, 'jordan');
  assert.deepEqual(accepted.created.map(item => item.key), ['handoff-deposit', 'handoff-materials', 'handoff-schedule']);
  assert.ok(accepted.created.every(item => quest.tasks.find(task => task.id === item.taskId)!.owner === 'maya'));
  assert.match(tools.proposals[0]!.history[0]!.text, /Recorded manually — no client signature/);
  assert.equal(inputsHash(tools.estimates.find(item => item.id === 'est-maple')!, tools.config), tools.proposals[0]!.basedOn);
});
