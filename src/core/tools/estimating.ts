// Operational tools: takeoff → underwriting (estimate) → proposal, as one record that travels.
//
// Tool records are NOT stored in the task workspace document. They are their own records with
// their own rules (this reducer), and they connect to execution only through real tasks created
// by the task engine (`apply({ type: 'task/create' })`). A tool action never creates a task
// itself: it returns task *requests* keyed by purpose; the caller creates them through the
// engine and links the ids back with `tasks/link`. A request is skipped while a task for the
// same purpose is still open, so repeating a step never duplicates work.
//
// Approval is bound to the exact inputs it saw (inputsHash). Any later change to costs, rates,
// price or the pricing policy voids the approval, and proposals built on it become stale and
// can't be approved or accepted until the estimate is approved again.
import type { ReferenceFields } from '../references.ts';
import type { NewTask, Person, Role } from '../contract.ts';
import { OPERATIONAL_ROLES } from '../contract.ts';
import type { DirectCosts, FormulaPolicy, PricingResult, Rates } from './pricing.ts';
import { priceUnder, round2 } from './pricing.ts';
import type { ReportMeta, Takeoff, TakeoffLine, TakeoffResult } from './takeoff.ts';
import { computeTakeoff, taxFor } from './takeoff.ts';

// ── Records ────────────────────────────────────────────────────────────────

export interface Tier { id: string; label: string; target: number; needsSignoff: boolean }
export interface ScopeItem { id: string; service: string; description: string; highlight: boolean }
export interface ProposalTemplate { id: string; label: string; trade: string; scope: ScopeItem[]; materials: string }

export interface PolicyRecord {
  formula: FormulaPolicy;
  decidedBy: string;
  decidedAt: number | null;
  note: string;
  /** True when chosen only to exercise the demo, not as company policy. */
  demo: boolean;
}

export interface ToolsConfig {
  modules: { takeoff: boolean; underwriting: boolean; proposals: boolean };
  policy: PolicyRecord;
  /** Points below target that still count as "review" instead of "reprice". */
  reviewBand: number;
  /** Whether the person who prepared a price may also approve it. */
  allowSelfApproval: boolean;
  /** Operational roles that may approve prices and proposals. */
  approverRoles: Role[];
  tiers: Tier[];
  defaults: { overhead: number; commission: number; contingency: number; wastePct: number; taxPct: number; taxBase: 'material' | 'all' };
  library: TakeoffLine[];
  proposal: {
    numberPrefix: string;
    validDays: number;
    depositPct: number;
    companyName: string;
    companyDetails: string;
    warranty: string;
    terms: string;
    /** False until the company approves the wording; previews and PDFs say so. */
    wordingApproved: boolean;
    templates: ProposalTemplate[];
  };
  /** True for synthetic sample values that a company must replace. */
  sample: boolean;
}

export type EstimateStatus = 'draft' | 'ready' | 'needs-review' | 'approved' | 'reprice';
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft', ready: 'Ready for approval', 'needs-review': 'Needs review', approved: 'Approved', reprice: 'Reprice',
};

export interface HistoryEntry { at: number; by: string; text: string }

export interface Approval {
  by: string;
  at: number;
  inputsHash: string;
  formula: Exclude<FormulaPolicy, 'undecided'>;
  price: number;
  margin: number;
  note: string;
}

export interface Estimate {
  references?: ReferenceFields;
  id: string;
  number: string;
  title: string;
  customer: { name: string; phone: string; email: string };
  address: string;
  trade: string;
  status: EstimateStatus;
  preparedBy: string;
  /** Who approves this price ('' until chosen). */
  approver: string;
  takeoff: Takeoff;
  extra: { permits: number; disposal: number; other: number };
  taxPct: number;
  taxBase: 'material' | 'all';
  rates: Rates;
  tierId: string;
  /** Percent. Set from the tier; a custom tier needs recorded sign-off. */
  target: number;
  price: number | null;
  approval: Approval | null;
  voided: Approval[];
  /** Task purpose → task id. */
  tasks: Record<string, string>;
  history: HistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export type ProposalStatus = 'draft' | 'in-review' | 'approved' | 'accepted' | 'declined' | 'withdrawn';
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft', 'in-review': 'In review', approved: 'Approved to deliver', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn',
};

export interface ProposalSection { id: string; title: string; body: string }

export interface Proposal {
  references?: ReferenceFields;
  id: string;
  number: string;
  estimateId: string;
  /** The estimate approval this proposal was built from. */
  basedOn: string;
  status: ProposalStatus;
  snapshot: { title: string; customer: Estimate['customer']; address: string; trade: string; price: number; approvedBy: string; approvedAt: number };
  templateId: string;
  scope: ScopeItem[];
  sections: ProposalSection[];
  depositPct: number;
  payment: string;
  issuedOn: string;
  validThrough: string;
  preparedBy: string;
  approver: string;
  approval: { by: string; at: number; note: string } | null;
  versions: { n: number; at: number; by: string; note: string; digest: string }[];
  /** Recorded by a manager from an offline decision. There is no client-facing link yet. */
  decision: { outcome: 'accepted' | 'declined'; signer: string; recordedBy: string; at: number; note: string } | null;
  tasks: Record<string, string>;
  history: HistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolsState {
  version: 1;
  orgId: string;
  config: ToolsConfig;
  estimates: Estimate[];
  proposals: Proposal[];
  seq: { estimate: number; proposal: number };
  /** Configuration changes (policy, rates, roles). Estimates and proposals keep their own history. */
  log: HistoryEntry[];
}

// ── Derived numbers ────────────────────────────────────────────────────────

export interface EstimateNumbers {
  takeoff: TakeoffResult;
  direct: DirectCosts;
  results: PricingResult[];
  /** The result under the decided policy, or null while undecided. */
  decided: PricingResult | null;
  tier: Tier | null;
}

export function estimateNumbers(estimate: Estimate, config: ToolsConfig): EstimateNumbers {
  const takeoff = computeTakeoff(estimate.takeoff);
  const direct: DirectCosts = {
    material: takeoff.material, tax: taxFor(takeoff, estimate.taxPct, estimate.taxBase), labor: takeoff.labor,
    permits: estimate.extra.permits, disposal: estimate.extra.disposal, other: estimate.extra.other,
  };
  const results = priceUnder(config.policy.formula, { direct, rates: estimate.rates, target: estimate.target, price: estimate.price }, config.reviewBand);
  return { takeoff, direct, results, decided: config.policy.formula === 'undecided' ? null : results[0]!, tier: config.tiers.find(tier => tier.id === estimate.tierId) ?? null };
}

/** Everything the approval depends on, in a fixed order. */
export function inputsHash(estimate: Estimate, config: ToolsConfig): string {
  const t = estimate.takeoff;
  const canonical = JSON.stringify([
    config.policy.formula, config.reviewBand,
    Object.entries(t.measurements).sort(), t.wastePct, Object.entries(t.overrides).sort(), t.crew,
    t.lines.map(line => [line.id, line.group, line.name, line.unit, line.formula, line.typed, line.unitCost]),
    estimate.extra, estimate.taxPct, estimate.taxBase, estimate.rates, estimate.tierId, estimate.target, estimate.price,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const approvalCurrent = (estimate: Estimate, config: ToolsConfig) =>
  estimate.status === 'approved' && !!estimate.approval && estimate.approval.inputsHash === inputsHash(estimate, config);

/** A proposal is stale when its estimate is no longer approved with the numbers it was built from. */
export function proposalStale(proposal: Proposal, state: ToolsState): boolean {
  const estimate = state.estimates.find(item => item.id === proposal.estimateId);
  return !estimate || !approvalCurrent(estimate, state.config) || estimate.approval!.inputsHash !== proposal.basedOn;
}

// ── Authority (shared by the UI and the reducer) ───────────────────────────

const personOf = (people: Person[], id: string) => people.find(item => item.id === id);
const operational = (people: Person[], id: string) => { const p = personOf(people, id); return !!p && OPERATIONAL_ROLES.includes(p.role); };
const isManager = (people: Person[], id: string) => personOf(people, id)?.role === 'manager';
const PREPARER_ROLES: Role[] = ['manager', 'coordinator', 'estimator', 'sales'];

export const canPrepare = (people: Person[], actor: string) => { const p = personOf(people, actor); return !!p && PREPARER_ROLES.includes(p.role); };
export const canEditEstimate = (people: Person[], estimate: Estimate, actor: string) =>
  canPrepare(people, actor) && (estimate.preparedBy === actor || isManager(people, actor) || personOf(people, actor)?.role === 'estimator');
export const eligibleApprovers = (people: Person[], config: ToolsConfig, preparedBy: string) =>
  people.filter(p => OPERATIONAL_ROLES.includes(p.role) && config.approverRoles.includes(p.role) && (config.allowSelfApproval || p.id !== preparedBy));

/** Why `actor` can't approve `estimate` right now, or null if they can. */
export function approveEstimateBlocker(state: ToolsState, estimate: Estimate, actor: string, people: Person[]): string | null {
  const { config } = state;
  if (config.policy.formula === 'undecided') return 'The pricing formula hasn’t been decided, so prices can’t be approved yet.';
  if (estimate.status !== 'ready' && estimate.status !== 'needs-review') return 'Only an estimate submitted for approval can be approved.';
  const me = personOf(people, actor);
  if (!me || !operational(people, actor) || !config.approverRoles.includes(me.role)) return 'Only a pricing approver can approve prices.';
  if (!config.allowSelfApproval && estimate.preparedBy === actor) return 'The person who prepared a price can’t approve it (company setting).';
  if (estimate.approver && estimate.approver !== actor && !isManager(people, actor)) return `This price is waiting on ${personOf(people, estimate.approver)?.name ?? 'its approver'}.`;
  const decided = estimateNumbers(estimate, config).decided!;
  if (decided.decision === 'incomplete') return 'The estimate isn’t fully priced.';
  if (decided.decision === 'reprice') return 'The margin is below the review band. Send it back to reprice instead.';
  return null;
}

export function approveProposalBlocker(state: ToolsState, proposal: Proposal, actor: string, people: Person[]): string | null {
  if (proposal.status !== 'in-review') return 'Only a proposal in review can be approved.';
  if (proposalStale(proposal, state)) return 'The estimate behind this proposal changed or lost its approval. Re-approve the price first.';
  const me = personOf(people, actor);
  if (!me || !operational(people, actor) || !state.config.approverRoles.includes(me.role)) return 'Only an approver can approve proposals.';
  if (!state.config.allowSelfApproval && proposal.preparedBy === actor) return 'The person who prepared a proposal can’t approve it (company setting).';
  return null;
}

// ── Actions ────────────────────────────────────────────────────────────────

export type EstimateChanges = Partial<Pick<Estimate, 'title' | 'customer' | 'address' | 'trade' | 'approver' | 'takeoff' | 'extra' | 'taxPct' | 'taxBase' | 'rates' | 'tierId' | 'target' | 'price'>>;
export type ProposalChanges = Partial<Pick<Proposal, 'scope' | 'sections' | 'depositPct' | 'payment' | 'validThrough' | 'approver'>>;

export type ToolAction =
  | { type: 'policy/decide'; formula: Exclude<FormulaPolicy, 'undecided'>; note: string; demo: boolean }
  | { type: 'policy/reset' }
  | { type: 'config/update'; changes: Partial<Pick<ToolsConfig, 'reviewBand' | 'allowSelfApproval' | 'approverRoles' | 'tiers' | 'defaults' | 'library' | 'modules' | 'proposal'>> }
  | { type: 'estimate/create'; title: string; customer: Estimate['customer']; address: string; trade: string; fromLibrary: boolean }
  | { type: 'estimate/update'; id: string; changes: EstimateChanges }
  | { type: 'estimate/attach-report'; id: string; report: Omit<ReportMeta, 'id' | 'addedBy' | 'addedAt' | 'stored'> }
  | { type: 'estimate/remove-report'; id: string; reportId: string }
  | { type: 'estimate/request-measurements'; id: string; to: string; note: string }
  | { type: 'estimate/submit'; id: string }
  | { type: 'estimate/approve'; id: string; note: string }
  | { type: 'estimate/send-back'; id: string; note: string }
  | { type: 'proposal/create'; estimateId: string; templateId: string }
  | { type: 'proposal/update'; id: string; changes: ProposalChanges; note?: string }
  | { type: 'proposal/submit'; id: string }
  | { type: 'proposal/approve'; id: string; note: string }
  | { type: 'proposal/return'; id: string; note: string }
  | { type: 'proposal/record-decision'; id: string; outcome: 'accepted' | 'declined'; signer: string; note: string; handoffTo: string }
  | { type: 'proposal/withdraw'; id: string; note: string }
  | { type: 'tasks/link'; kind: 'estimate' | 'proposal'; id: string; links: Record<string, string> };

export interface ToolContext {
  actor: string;
  now: number;
  people: Person[];
  newId: () => string;
  /** Whether a task still exists and isn't done (from the task engine's state). */
  taskOpen: (taskId: string) => boolean;
  /** Local date for "today" (YYYY-MM-DD). */
  today: string;
}

export interface TaskRequest { kind: 'estimate' | 'proposal'; recordId: string; key: string; task: NewTask }

export type ToolResult =
  | { ok: true; state: ToolsState; message: string; tasks: TaskRequest[]; close: string[] }
  | { ok: false; state: ToolsState; error: string };

const fail = (state: ToolsState, error: string): ToolResult => ({ ok: false, state, error });
const nameOf = (people: Person[], id: string, fallback = 'someone') => personOf(people, id)?.name ?? fallback;
const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const num = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y!, m! - 1, d! + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Validates number fields; returns a refusal or null. */
function checkEstimate(e: Estimate): string | null {
  if (!e.title.trim()) return 'Give the estimate a name.';
  if (e.title.length > 120) return 'Keep the estimate name under 120 characters.';
  const t = e.takeoff;
  for (const value of Object.values(t.measurements)) if (value !== null && value !== undefined && !num(value, 0, 1e6)) return 'Measurements are zero or more.';
  if (!num(t.wastePct, 0, 100) || !Object.values(t.overrides).every(value => num(value, 0, 100))) return 'Waste is a percentage from 0 to 100.';
  if (t.lines.length > 80) return 'Keep a takeoff to 80 lines.';
  if (!t.lines.every(line => num(line.unitCost, 0, 1e6) && (line.typed === null || num(line.typed, 0, 1e6)) && line.formula.length <= 500)) return 'Line costs and typed quantities are zero or more.';
  if (t.crew && ![t.crew.size, t.crew.days, t.crew.hours, t.crew.rate].every(value => num(value, 0, 1e5))) return 'Crew figures are zero or more.';
  if (![e.extra.permits, e.extra.disposal, e.extra.other].every(value => num(value, 0, 1e7))) return 'Costs are zero or more.';
  if (![e.rates.overhead, e.rates.commission, e.rates.contingency, e.target, e.taxPct].every(value => num(value, 0, 100))) return 'Rates and margins are percentages from 0 to 100.';
  if (e.price !== null && !num(e.price, 0, 1e8)) return 'The price is zero or more.';
  return null;
}

/** Requests a task unless one for the same purpose is still open. */
function request(out: TaskRequest[], record: { id: string; tasks: Record<string, string> }, kind: TaskRequest['kind'], key: string, task: NewTask, ctx: ToolContext) {
  const existing = record.tasks[key];
  if (existing && ctx.taskOpen(existing)) return;
  out.push({ kind, recordId: record.id, key, task });
}

const openTasks = (record: { tasks: Record<string, string> }, keys: string[], ctx: ToolContext) =>
  keys.map(key => record.tasks[key]).filter((id): id is string => !!id && ctx.taskOpen(id));

function putEstimate(state: ToolsState, estimate: Estimate): ToolsState {
  return { ...state, estimates: state.estimates.map(item => (item.id === estimate.id ? estimate : item)) };
}
function putProposal(state: ToolsState, proposal: Proposal): ToolsState {
  return { ...state, proposals: state.proposals.map(item => (item.id === proposal.id ? proposal : item)) };
}
const note = (record: { history: HistoryEntry[] }, by: string, at: number, text: string) => [{ at, by, text }, ...record.history].slice(0, 200);

function digest(proposal: Proposal): string {
  const text = JSON.stringify([proposal.basedOn, proposal.scope, proposal.sections, proposal.depositPct, proposal.payment, proposal.validThrough, proposal.snapshot.price]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** After a policy or settings change, approvals that no longer match their numbers are voided. */
function sweepApprovals(state: ToolsState, by: string, at: number, reason: string): { state: ToolsState; voided: number } {
  let voided = 0;
  const estimates = state.estimates.map(estimate => {
    if (estimate.status !== 'approved' || !estimate.approval || estimate.approval.inputsHash === inputsHash(estimate, state.config)) return estimate;
    voided += 1;
    return { ...estimate, status: 'draft' as const, approval: null, voided: [estimate.approval, ...estimate.voided], updatedAt: at, history: note(estimate, by, at, `The approval no longer applies: ${reason}. Proposals built on it are on hold.`) };
  });
  return { state: { ...state, estimates }, voided };
}

export function applyTool(state: ToolsState, action: ToolAction, ctx: ToolContext): ToolResult {
  const { actor, now, people } = ctx;
  const me = personOf(people, actor);
  if (!me) return fail(state, 'Choose who you are working as first.');
  if (!operational(people, actor)) return fail(state, 'Reviewers can look at the tools but can’t change estimates or proposals.');
  const tasks: TaskRequest[] = []; const close: string[] = [];
  const ok = (next: ToolsState, message: string): ToolResult => ({ ok: true, state: next, message, tasks, close });
  const config = state.config;
  const estimateById = (id: string) => state.estimates.find(item => item.id === id);
  const proposalById = (id: string) => state.proposals.find(item => item.id === id);

  switch (action.type) {
    case 'policy/decide': {
      if (me.role !== 'manager') return fail(state, 'Only a manager can choose the pricing formula.');
      if (action.formula !== 'full-burden' && action.formula !== 'commission-only') return fail(state, 'Choose one of the two formulas.');
      const policy: PolicyRecord = { formula: action.formula, decidedBy: actor, decidedAt: now, note: clip(action.note, 300), demo: !!action.demo };
      const text = `${me.name} chose the ${action.formula === 'full-burden' ? 'full-burden' : 'commission-only'} pricing formula${policy.demo ? ' for this demo only' : ''}.`;
      const swept = sweepApprovals({ ...state, config: { ...config, policy }, log: [{ at: now, by: actor, text }, ...state.log] }, actor, now, 'the pricing formula changed');
      return ok(swept.state, swept.voided ? `${text} ${swept.voided} approved price${swept.voided === 1 ? '' : 's'} need approval again.` : text);
    }
    case 'policy/reset': {
      if (me.role !== 'manager') return fail(state, 'Only a manager can change the pricing formula.');
      const text = `${me.name} set the pricing formula back to “not decided”. Approvals are blocked until it’s chosen.`;
      return ok(sweepApprovals({ ...state, config: { ...config, policy: { formula: 'undecided', decidedBy: '', decidedAt: null, note: '', demo: false } }, log: [{ at: now, by: actor, text }, ...state.log] }, actor, now, 'the pricing formula is no longer decided').state, text);
    }
    case 'config/update': {
      if (me.role !== 'manager') return fail(state, 'Only a manager can change tool settings.');
      const c = action.changes;
      if (c.reviewBand !== undefined && !num(c.reviewBand, 0, 20)) return fail(state, 'The review band is 0 to 20 points.');
      if (c.approverRoles && (!c.approverRoles.length || !c.approverRoles.every(role => OPERATIONAL_ROLES.includes(role)))) return fail(state, 'Approvers must be at least one operational role.');
      if (c.tiers && (!c.tiers.length || c.tiers.length > 12 || !c.tiers.every(tier => tier.id && clip(tier.label, 40) && num(tier.target, 0, 95)))) return fail(state, 'Each margin tier needs a name and a target from 0 to 95%.');
      if (c.defaults && ![c.defaults.overhead, c.defaults.commission, c.defaults.contingency, c.defaults.wastePct, c.defaults.taxPct].every(value => num(value, 0, 100))) return fail(state, 'Default rates are percentages from 0 to 100.');
      if (c.proposal) {
        const p = c.proposal;
        if (!/^[A-Z0-9]{1,6}$/.test(p.numberPrefix)) return fail(state, 'The proposal number prefix is 1–6 capital letters or digits.');
        if (!num(p.validDays, 1, 365) || !num(p.depositPct, 0, 100)) return fail(state, 'Valid days are 1–365 and the deposit is 0–100%.');
        if (!clip(p.companyName, 120) || p.warranty.length > 6000 || p.terms.length > 6000 || !p.templates.length) return fail(state, 'Proposals need a company name, wording under 6,000 characters and at least one template.');
      }
      const next = { ...config, ...c };
      const text = `${me.name} changed tool settings (${Object.keys(c).join(', ')}).`;
      const swept = sweepApprovals({ ...state, config: next, log: [{ at: now, by: actor, text }, ...state.log] }, actor, now, 'pricing settings changed');
      return ok(swept.state, swept.voided ? `Settings saved. ${swept.voided} approved price${swept.voided === 1 ? '' : 's'} need approval again.` : 'Settings saved.');
    }

    case 'estimate/create': {
      if (!canPrepare(people, actor)) return fail(state, 'Only managers, coordinators, estimators and sales can start estimates.');
      if (!config.modules.underwriting) return fail(state, 'Estimating isn’t turned on for this workspace.');
      const title = clip(action.title, 120);
      if (!title) return fail(state, 'Give the estimate a name.');
      const seq = state.seq.estimate + 1;
      const tier = config.tiers.find(item => !item.needsSignoff) ?? config.tiers[0]!;
      const estimate: Estimate = {
        id: ctx.newId(), number: `E-${String(seq).padStart(4, '0')}`, title,
        customer: { name: clip(action.customer.name, 120), phone: clip(action.customer.phone, 40), email: clip(action.customer.email, 160) },
        address: clip(action.address, 200), trade: clip(action.trade, 40) || 'Roofing', status: 'draft', preparedBy: actor, approver: '',
        takeoff: {
          measurements: {}, wastePct: config.defaults.wastePct, overrides: {}, pitch: '', measuredOn: '', source: '', reports: [],
          lines: action.fromLibrary ? config.library.map(line => ({ ...line, id: ctx.newId() })) : [], crew: null,
        },
        extra: { permits: 0, disposal: 0, other: 0 }, taxPct: config.defaults.taxPct, taxBase: config.defaults.taxBase,
        rates: { overhead: config.defaults.overhead, commission: config.defaults.commission, contingency: config.defaults.contingency },
        tierId: tier.id, target: tier.target, price: null, approval: null, voided: [], tasks: {},
        history: [{ at: now, by: actor, text: `${me.name} started the estimate.` }], createdAt: now, updatedAt: now,
      };
      return ok({ ...state, estimates: [estimate, ...state.estimates], seq: { ...state.seq, estimate: seq } }, `Estimate ${estimate.number} started.`);
    }

    case 'estimate/update': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!canEditEstimate(people, current, actor)) return fail(state, 'Only the person preparing this estimate, an estimator or a manager can change it.');
      const c = { ...action.changes };
      if (c.approver !== undefined && c.approver !== '' && !eligibleApprovers(people, config, current.preparedBy).some(p => p.id === c.approver)) return fail(state, 'That person can’t approve this price.');
      if (c.tierId !== undefined) {
        const tier = config.tiers.find(item => item.id === c.tierId);
        if (!tier) return fail(state, 'That margin tier isn’t configured.');
        if (c.target === undefined) c.target = tier.target;
      }
      const next: Estimate = { ...current, ...c, updatedAt: now };
      if (c.customer) next.customer = { name: clip(c.customer.name, 120), phone: clip(c.customer.phone, 40), email: clip(c.customer.email, 160) };
      const tier = config.tiers.find(item => item.id === next.tierId);
      if (tier && !tier.needsSignoff && next.target !== tier.target) return fail(state, `The ${tier.label} tier sets the target at ${tier.target}%. Choose a sign-off tier to use a different target.`);
      const bad = checkEstimate(next);
      if (bad) return fail(state, bad);
      const before = inputsHash(current, config); const after = inputsHash(next, config);
      let message = 'Saved.';
      if (before !== after && current.status !== 'draft') {
        const voided = current.approval ? [current.approval, ...current.voided] : current.voided;
        next.status = 'draft'; next.approval = null; next.voided = voided;
        next.history = note(next, actor, now, current.status === 'approved'
          ? `${me.name} changed the numbers after approval. The approval no longer applies; proposals built on it are on hold.`
          : `${me.name} changed the numbers, so the estimate went back to Draft.`);
        message = current.status === 'approved' ? 'Changed — the price needs approval again.' : 'Changed — back to Draft.';
        close.push(...openTasks(current, ['review'], ctx));
      }
      return ok(putEstimate(state, next), message);
    }

    case 'estimate/attach-report': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!canEditEstimate(people, current, actor)) return fail(state, 'Only the person preparing this estimate, an estimator or a manager can add reports.');
      const name = clip(action.report.name, 160);
      if (!name) return fail(state, 'The file needs a name.');
      if (current.takeoff.reports.length >= 10) return fail(state, 'Keep it to 10 reports per estimate.');
      const report: ReportMeta = { id: ctx.newId(), name, size: Math.max(0, Math.round(action.report.size)), type: clip(action.report.type, 80), addedBy: actor, addedAt: now, stored: 'not-kept' };
      const next = { ...current, takeoff: { ...current.takeoff, reports: [...current.takeoff.reports, report] }, updatedAt: now };
      next.history = note(next, actor, now, `${me.name} recorded the measurement report “${name}”.`);
      return ok(putEstimate(state, next), 'Report recorded. The file itself isn’t uploaded yet.');
    }
    case 'estimate/remove-report': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!canEditEstimate(people, current, actor)) return fail(state, 'Only the person preparing this estimate, an estimator or a manager can remove reports.');
      const next = { ...current, takeoff: { ...current.takeoff, reports: current.takeoff.reports.filter(item => item.id !== action.reportId) }, updatedAt: now };
      return ok(putEstimate(state, next), 'Report removed.');
    }

    case 'estimate/request-measurements': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!canEditEstimate(people, current, actor)) return fail(state, 'Only the person preparing this estimate, an estimator or a manager can ask for measurements.');
      if (!operational(people, action.to)) return fail(state, 'Choose someone in this workspace.');
      request(tasks, current, 'estimate', 'measure', {
        title: `Get roof measurements: ${current.address || current.title}`.slice(0, 160), owner: action.to, nextOwner: current.preparedBy, priority: 'normal',
        nextAction: 'Enter the measurements (or attach the report) on the estimate.', description: [clip(action.note, 500), `Estimate ${current.number}: ${current.title}.`].filter(Boolean).join('\n\n'),
      }, ctx);
      if (!tasks.length) return fail(state, 'A measurement task for this estimate is already open.');
      const next = { ...current, history: note(current, actor, now, `${me.name} asked ${nameOf(people, action.to)} for measurements.`), updatedAt: now };
      return ok(putEstimate(state, next), `Asked ${nameOf(people, action.to)} for measurements.`);
    }

    case 'estimate/submit': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!canEditEstimate(people, current, actor)) return fail(state, 'Only the person preparing this estimate, an estimator or a manager can submit it.');
      if (current.status !== 'draft' && current.status !== 'reprice') return fail(state, 'This estimate is already submitted.');
      const numbers = estimateNumbers(current, config);
      if (numbers.takeoff.problems.length) return fail(state, `Fix the takeoff first: ${numbers.takeoff.problems[0]!.name} — ${numbers.takeoff.problems[0]!.error}`);
      if (numbers.direct.material + numbers.direct.labor <= 0) return fail(state, 'Add material and labor before submitting.');
      if (current.price === null || current.price <= 0) return fail(state, 'Set a selling price before submitting.');
      if (!current.approver) return fail(state, 'Choose who approves this price.');
      if (!eligibleApprovers(people, config, current.preparedBy).some(p => p.id === current.approver)) return fail(state, 'The chosen approver can’t approve this price.');
      const results = numbers.results;
      const tier = numbers.tier;
      const worst = results.some(r => r.decision === 'reprice') ? 'reprice' : results.some(r => r.decision === 'review') ? 'review' : 'meets-target';
      const decidedReprice = numbers.decided?.decision === 'reprice';
      const status: EstimateStatus = decidedReprice ? 'reprice' : numbers.decided && worst === 'meets-target' && !tier?.needsSignoff ? 'ready' : 'needs-review';
      const why = decidedReprice ? 'the margin is below the review band'
        : config.policy.formula === 'undecided' ? 'the pricing formula isn’t decided'
        : tier?.needsSignoff ? `the ${tier.label} tier needs sign-off`
        : worst === 'review' ? 'the margin is below target' : 'it meets target';
      const next: Estimate = { ...current, status, updatedAt: now, history: note(current, actor, now, `${me.name} submitted the price (${ESTIMATE_STATUS_LABELS[status]}: ${why}).`) };
      if (status === 'reprice') {
        request(tasks, next, 'estimate', 'reprice', { title: `Reprice: ${current.title}`.slice(0, 160), owner: current.preparedBy, priority: 'high', nextAction: 'Raise the price or lower costs until the margin is at least within the review band.', description: `Estimate ${current.number}.` }, ctx);
      } else {
        request(tasks, next, 'estimate', 'review', {
          title: `Approve price: ${current.title}`.slice(0, 160), owner: current.approver, nextOwner: current.preparedBy, priority: status === 'needs-review' ? 'high' : 'normal',
          nextAction: `Open estimate ${current.number} in Tools and approve or send it back.`, description: `Submitted by ${me.name}. ${ESTIMATE_STATUS_LABELS[status]}: ${why}.`,
        }, ctx);
        close.push(...openTasks(current, ['reprice'], ctx));
      }
      return ok(putEstimate(state, next), status === 'reprice' ? 'Below the review band — marked Reprice.' : `Sent to ${nameOf(people, current.approver)} for approval.`);
    }

    case 'estimate/approve': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      const blocker = approveEstimateBlocker(state, current, actor, people);
      if (blocker) return fail(state, blocker);
      const numbers = estimateNumbers(current, config);
      const decided = numbers.decided!;
      const exception = decided.decision === 'review' || numbers.tier?.needsSignoff;
      const why = clip(action.note, 500);
      if (exception && why.length < 5) return fail(state, 'This price is below target or on a sign-off tier. Write why you’re approving it.');
      const approval: Approval = { by: actor, at: now, inputsHash: inputsHash(current, config), formula: decided.formula, price: current.price!, margin: decided.margin!, note: why };
      const next: Estimate = { ...current, status: 'approved', approval, updatedAt: now, history: note(current, actor, now, `${me.name} approved the price at ${decided.margin}% margin${why ? ` — “${why}”` : ''}.`) };
      request(tasks, next, 'estimate', 'proposal', { title: `Prepare proposal: ${current.title}`.slice(0, 160), owner: current.preparedBy, priority: 'normal', nextAction: `Create the proposal from estimate ${current.number} in Tools.` }, ctx);
      close.push(...openTasks(current, ['review'], ctx));
      return ok(putEstimate(state, next), 'Price approved. It can be used in a proposal now.');
    }

    case 'estimate/send-back': {
      const current = estimateById(action.id);
      if (!current) return fail(state, 'That estimate no longer exists.');
      if (!['ready', 'needs-review', 'approved'].includes(current.status)) return fail(state, 'Only a submitted or approved estimate can be sent back.');
      if (!(current.approver === actor || me.role === 'manager')) return fail(state, 'Only the approver or a manager can send a price back.');
      const why = clip(action.note, 500);
      if (why.length < 5) return fail(state, 'Say what needs to change.');
      const next: Estimate = {
        ...current, status: 'reprice', approval: null, voided: current.approval ? [current.approval, ...current.voided] : current.voided, updatedAt: now,
        history: note(current, actor, now, `${me.name} sent the price back to reprice — “${why}”.`),
      };
      request(tasks, next, 'estimate', 'reprice', { title: `Reprice: ${current.title}`.slice(0, 160), owner: current.preparedBy, priority: 'high', nextAction: why, description: `Sent back by ${me.name}.` }, ctx);
      close.push(...openTasks(current, ['review'], ctx));
      return ok(putEstimate(state, next), 'Sent back to reprice.');
    }

    case 'proposal/create': {
      if (!config.modules.proposals) return fail(state, 'Proposals aren’t turned on for this workspace.');
      const estimate = estimateById(action.estimateId);
      if (!estimate) return fail(state, 'That estimate no longer exists.');
      if (!canPrepare(people, actor)) return fail(state, 'Only managers, coordinators, estimators and sales can prepare proposals.');
      if (!approvalCurrent(estimate, config)) return fail(state, 'A proposal can only be made from an approved price.');
      const live = state.proposals.find(item => item.estimateId === estimate.id && item.basedOn === estimate.approval!.inputsHash && ['draft', 'in-review', 'approved'].includes(item.status));
      if (live) return fail(state, `Proposal ${live.number} already uses this approved price.`);
      const template = config.proposal.templates.find(item => item.id === action.templateId);
      if (!template) return fail(state, 'Choose a template.');
      const seq = state.seq.proposal + 1;
      const year = new Date(now).getFullYear() % 100;
      const proposal: Proposal = {
        id: ctx.newId(), number: `${config.proposal.numberPrefix}-${String(year).padStart(2, '0')}-${String(seq).padStart(4, '0')}`,
        estimateId: estimate.id, basedOn: estimate.approval!.inputsHash, status: 'draft',
        snapshot: { title: estimate.title, customer: estimate.customer, address: estimate.address, trade: estimate.trade, price: estimate.approval!.price, approvedBy: estimate.approval!.by, approvedAt: estimate.approval!.at },
        templateId: template.id, scope: template.scope.map(item => ({ ...item, id: ctx.newId() })),
        sections: [
          { id: ctx.newId(), title: 'Materials', body: template.materials },
          { id: ctx.newId(), title: 'Warranty', body: config.proposal.warranty },
          { id: ctx.newId(), title: 'Terms', body: config.proposal.terms },
        ],
        depositPct: config.proposal.depositPct, payment: `Deposit of ${config.proposal.depositPct}% on signing; balance on completion.`,
        issuedOn: ctx.today, validThrough: addDays(ctx.today, config.proposal.validDays), preparedBy: actor, approver: estimate.approval!.by,
        approval: null, versions: [], decision: null, tasks: {}, history: [{ at: now, by: actor, text: `${me.name} created the proposal from estimate ${estimate.number}.` }], createdAt: now, updatedAt: now,
      };
      const nextEstimate = { ...estimate, history: note(estimate, actor, now, `${me.name} created proposal ${proposal.number}.`) };
      close.push(...openTasks(estimate, ['proposal'], ctx));
      return ok({ ...putEstimate(state, nextEstimate), proposals: [proposal, ...state.proposals], seq: { ...state.seq, proposal: seq } }, `Proposal ${proposal.number} drafted.`);
    }

    case 'proposal/update': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      if (!canPrepare(people, actor) || !(current.preparedBy === actor || me.role === 'manager' || me.role === 'estimator')) return fail(state, 'Only the person preparing this proposal, an estimator or a manager can edit it.');
      if (!['draft', 'in-review', 'approved'].includes(current.status)) return fail(state, 'A decided or withdrawn proposal can’t be edited.');
      const c = action.changes;
      if (c.depositPct !== undefined && !num(c.depositPct, 0, 100)) return fail(state, 'The deposit is 0–100%.');
      if (c.scope && (c.scope.length > 60 || !c.scope.every(item => clip(item.service, 120)))) return fail(state, 'Each scope line needs a service name (up to 60 lines).');
      if (c.sections && (c.sections.length > 20 || !c.sections.every(item => clip(item.title, 80) && item.body.length <= 6000))) return fail(state, 'Each section needs a title (up to 20 sections).');
      if (c.validThrough !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.validThrough)) return fail(state, 'Pick a valid-through date.');
      if (c.approver !== undefined && !eligibleApprovers(people, config, current.preparedBy).some(p => p.id === c.approver)) return fail(state, 'That person can’t approve proposals.');
      const next: Proposal = { ...current, ...c, updatedAt: now };
      if (current.status !== 'draft') {
        next.status = 'draft'; next.approval = null;
        next.history = note(next, actor, now, `${me.name} edited the proposal, so it went back to Draft${current.status === 'approved' ? ' and needs approval again' : ''}.`);
        close.push(...openTasks(current, ['review', 'deliver'], ctx));
      }
      return ok(putProposal(state, next), current.status === 'draft' ? 'Saved.' : 'Saved — back to Draft.');
    }

    case 'proposal/submit': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      if (current.status !== 'draft') return fail(state, 'Only a draft can be sent for review.');
      if (!(current.preparedBy === actor || me.role === 'manager' || me.role === 'estimator')) return fail(state, 'Only the person preparing this proposal, an estimator or a manager can submit it.');
      if (proposalStale(current, state)) return fail(state, 'The estimate behind this proposal changed or lost its approval. Re-approve the price first.');
      if (!current.scope.length) return fail(state, 'Add at least one scope line.');
      if (!eligibleApprovers(people, config, current.preparedBy).some(p => p.id === current.approver)) return fail(state, 'Choose an approver who can approve proposals.');
      const next: Proposal = { ...current, status: 'in-review', updatedAt: now, history: note(current, actor, now, `${me.name} sent the proposal to ${nameOf(people, current.approver)} for review.`) };
      request(tasks, next, 'proposal', 'review', { title: `Approve proposal ${current.number}: ${current.snapshot.title}`.slice(0, 160), owner: current.approver, nextOwner: current.preparedBy, priority: 'normal', nextAction: `Open proposal ${current.number} in Tools and approve or return it.` }, ctx);
      return ok(putProposal(state, next), `Sent to ${nameOf(people, current.approver)} for review.`);
    }

    case 'proposal/approve': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      const blocker = approveProposalBlocker(state, current, actor, people);
      if (blocker) return fail(state, blocker);
      const version = { n: current.versions.length + 1, at: now, by: actor, note: clip(action.note, 300), digest: digest(current) };
      const next: Proposal = { ...current, status: 'approved', approval: { by: actor, at: now, note: clip(action.note, 300) }, versions: [...current.versions, version], updatedAt: now, history: note(current, actor, now, `${me.name} approved version ${version.n} to deliver.`) };
      request(tasks, next, 'proposal', 'deliver', {
        title: `Deliver proposal ${current.number} to ${current.snapshot.customer.name || 'the client'}`.slice(0, 160), owner: current.preparedBy, priority: 'normal',
        nextAction: 'Export the PDF and deliver it yourself. Task-HQ doesn’t send proposals yet.',
      }, ctx);
      close.push(...openTasks(current, ['review'], ctx));
      return ok(putProposal(state, next), `Version ${version.n} approved. Deliver it yourself — Task-HQ doesn’t send proposals.`);
    }

    case 'proposal/return': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      if (current.status !== 'in-review') return fail(state, 'Only a proposal in review can be returned.');
      if (!(current.approver === actor || me.role === 'manager')) return fail(state, 'Only the approver or a manager can return a proposal.');
      const why = clip(action.note, 500);
      if (why.length < 5) return fail(state, 'Say what needs to change.');
      const next: Proposal = { ...current, status: 'draft', updatedAt: now, history: note(current, actor, now, `${me.name} returned the proposal — “${why}”.`) };
      close.push(...openTasks(current, ['review'], ctx));
      return ok(putProposal(state, next), 'Returned to Draft.');
    }

    case 'proposal/record-decision': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      if (me.role !== 'manager') return fail(state, 'Only a manager can record a client’s decision.');
      if (current.status !== 'approved') return fail(state, 'Only an approved proposal can be accepted or declined.');
      if (proposalStale(current, state)) return fail(state, 'The estimate behind this proposal changed. Re-approve before recording a decision.');
      const signer = clip(action.signer, 120);
      if (action.outcome === 'accepted' && !signer) return fail(state, 'Who accepted it for the client?');
      if (action.outcome === 'accepted' && !operational(people, action.handoffTo)) return fail(state, 'Choose who takes the job handoff.');
      const decision = { outcome: action.outcome, signer, recordedBy: actor, at: now, note: clip(action.note, 500) };
      const next: Proposal = { ...current, status: action.outcome, decision, updatedAt: now, history: note(current, actor, now, `${me.name} recorded that the client ${action.outcome}${signer ? ` (${signer})` : ''}. Recorded manually — no client signature in Task-HQ.`) };
      if (action.outcome === 'accepted') {
        const title = current.snapshot.title;
        request(tasks, next, 'proposal', 'handoff-deposit', { title: `Collect deposit: ${title}`.slice(0, 160), owner: action.handoffTo, priority: 'high', nextAction: `${current.depositPct}% deposit on ${current.number}.` }, ctx);
        request(tasks, next, 'proposal', 'handoff-materials', { title: `Order materials: ${title}`.slice(0, 160), owner: action.handoffTo, priority: 'normal', nextAction: 'Order from the approved takeoff.' }, ctx);
        request(tasks, next, 'proposal', 'handoff-schedule', { title: `Schedule crew: ${title}`.slice(0, 160), owner: action.handoffTo, priority: 'normal', nextAction: `Confirm a start date with ${current.snapshot.customer.name || 'the client'}.` }, ctx);
      }
      close.push(...openTasks(current, ['deliver'], ctx));
      return ok(putProposal(state, next), action.outcome === 'accepted' ? 'Acceptance recorded. Job handoff tasks are next.' : 'Decline recorded.');
    }

    case 'proposal/withdraw': {
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      if (!['draft', 'in-review', 'approved'].includes(current.status)) return fail(state, 'This proposal is already decided.');
      if (!(current.preparedBy === actor || me.role === 'manager')) return fail(state, 'Only the person who prepared it or a manager can withdraw it.');
      const next: Proposal = { ...current, status: 'withdrawn', updatedAt: now, history: note(current, actor, now, `${me.name} withdrew the proposal${action.note ? ` — “${clip(action.note, 300)}”` : ''}.`) };
      close.push(...openTasks(current, ['review', 'deliver'], ctx));
      return ok(putProposal(state, next), 'Proposal withdrawn.');
    }

    case 'tasks/link': {
      const links = Object.fromEntries(Object.entries(action.links).filter(([key, id]) => typeof key === 'string' && typeof id === 'string' && key.length <= 40 && id.length <= 80));
      if (action.kind === 'estimate') {
        const current = estimateById(action.id);
        if (!current) return fail(state, 'That estimate no longer exists.');
        return ok(putEstimate(state, { ...current, tasks: { ...current.tasks, ...links } }), 'Linked.');
      }
      const current = proposalById(action.id);
      if (!current) return fail(state, 'That proposal no longer exists.');
      return ok(putProposal(state, { ...current, tasks: { ...current.tasks, ...links } }), 'Linked.');
    }
  }
}

/** What to do next with an estimate, in one line. */
export function estimateNext(estimate: Estimate, state: ToolsState): string {
  const numbers = estimateNumbers(estimate, state.config);
  switch (estimate.status) {
    case 'draft':
      if (!estimate.takeoff.lines.length) return 'Add takeoff lines (or start from the line library).';
      if (numbers.takeoff.missing.includes('totalSq')) return 'Enter measurements from the report or field measure.';
      if (numbers.takeoff.problems.length) return `Fix “${numbers.takeoff.problems[0]!.name}”.`;
      if (estimate.price === null) return 'Set a selling price.';
      if (!estimate.approver) return 'Choose who approves the price, then submit.';
      return 'Submit for approval.';
    case 'reprice': return 'Reprice, then submit again.';
    case 'ready': case 'needs-review': return state.config.policy.formula === 'undecided' ? 'Waiting on the pricing formula decision.' : 'Waiting on approval.';
    case 'approved': {
      const proposal = state.proposals.find(item => item.estimateId === estimate.id && item.basedOn === estimate.approval?.inputsHash && item.status !== 'withdrawn');
      return proposal ? `Proposal ${proposal.number}: ${PROPOSAL_STATUS_LABELS[proposal.status]}.` : 'Create the proposal.';
    }
  }
}

export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `$${round2(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
