// Quest OS executive layer: deterministic briefing, decision desk, follow-up
// intelligence and daily signal over QuestState. Read-only: nothing here changes
// state. Options are proposals the UI performs through apply() only after the
// principal confirms, and the engine still decides what is allowed.
//
// Detection reuses insights() (rules.ts); options reuse check() (capabilities.ts).
// Nothing is invented: sources that are not connected are reported as such.
import type { Action, Lead, Person, QuestEvent, QuestState, Task } from './contract.ts';
import { SECTION_LABELS } from './contract.ts';
import { apply } from './engine.ts';
import { check } from './capabilities.ts';
import type { ActionOffer, CapabilityId, Subject, Values } from './capabilities.ts';
import { insights } from './rules.ts';
import type { Insight, InsightKind, Severity } from './rules.ts';
import { canDecideGrants, dependents, firstName, hasRole, isOpen, leadById, nameOf, taskById } from './selectors.ts';
import { DAY, duration, localDate } from './time.ts';

// ── Sources ────────────────────────────────────────────────────────────────

export interface SourceRef {
  kind: 'task' | 'lead' | 'grant' | 'event' | 'appointment';
  id: string;
  /** True for demo-workspace records and simulated leads. */
  synthetic: boolean;
}

/** Demo workspaces hold synthetic people and work; live ones come from the server. */
export const isSyntheticWorkspace = (state: QuestState) => (state.workspace?.plan ?? 'local-demo') === 'local-demo';

function sourceOf(state: QuestState, kind: SourceRef['kind'], id: string): SourceRef {
  const lead = kind === 'lead' ? leadById(state, id) : undefined;
  return { kind, id, synthetic: isSyntheticWorkspace(state) || !!lead?.simulated };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };

// ── Owner recommendation ───────────────────────────────────────────────────

const AFFINITY: { role: Person['role']; pattern: RegExp }[] = [
  { role: 'estimator', pattern: /\b(estimate|quote|pricing|measure|inspection)\b/i },
  { role: 'field', pattern: /\b(tarp|crew|install|repair|roof|shingles?|flashing|site|staging|safety|ladder)\b/i },
  { role: 'coordinator', pattern: /\b(permit|schedule|paperwork|warranty|documents?|docs|order|supplier|invoice)\b/i },
  { role: 'sales', pattern: /\b(lead|customer|follow up|follow-up|homeowner|call)\b/i },
];

export interface OwnerRecommendation { personId: string; reason: string }

/**
 * Deterministic "right person": role fit from the work itself, then who has done
 * work in the same project, then the lightest open load. Never a reviewer, and
 * never anyone in `exclude` (the principal, when the point is to delegate).
 */
export function recommendOwner(state: QuestState, subject: { task?: Task; lead?: Lead }, exclude: string[] = []): OwnerRecommendation | null {
  const candidates = state.people.filter(item => item.role !== 'reviewer' && !exclude.includes(item.id));
  if (!candidates.length) return null;
  const text = subject.task ? `${subject.task.title} ${subject.task.description} ${subject.task.nextAction}` : '';
  const wanted = new Set<Person['role']>(subject.lead || subject.task?.leadId ? ['sales'] : AFFINITY.filter(item => item.pattern.test(text)).map(item => item.role));
  const load = (id: string) => state.tasks.filter(item => isOpen(item) && item.owner === id).length;
  const history = (id: string) => (subject.task?.projectId ? state.tasks.filter(item => item.projectId === subject.task!.projectId && item.owner === id && item.id !== subject.task!.id).length : 0);
  const scored = candidates
    .map(item => ({ item, fit: wanted.has(item.role) ? 1 : 0, history: history(item.id), load: load(item.id) }))
    .sort((a, b) => b.fit - a.fit || b.history - a.history || a.load - b.load || a.item.id.localeCompare(b.item.id));
  const best = scored[0]!;
  const reasons = [
    best.fit ? `${best.item.title.toLowerCase()} work` : '',
    best.history ? `${best.history} other task(s) in this project` : '',
    `${best.load} open task(s)`,
  ].filter(Boolean);
  return { personId: best.item.id, reason: reasons.join(', ') };
}

// ── Decision Desk ──────────────────────────────────────────────────────────

export type DecisionKind = 'access' | 'approval' | 'escalated-lead' | 'needs-your-call' | 'unowned-priority';
export type OptionKind = 'approve' | 'decline' | 'delegate' | 'other';

export interface DecisionOption {
  key: string;
  kind: OptionKind;
  label: string;
  /** Capability offer (UI collects `offer.inputs`, then actionFor + apply) … */
  offer?: ActionOffer;
  /** … or a complete engine action with nothing left to collect. */
  action?: Action;
  /** The engine would accept it from the principal right now (dry run). */
  supported: boolean;
  /** The engine's own reason when not supported. */
  refusal?: string;
  recommended: boolean;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  urgency: Severity;
  what: string;
  why: string;
  /** People (or a customer) held up by this decision. */
  waiting: { personId?: string; label: string }[];
  delay: string;
  recommendation: string;
  options: DecisionOption[];
  since: number;
  source: SourceRef;
}

function capOption(state: QuestState, principal: string, now: number, kind: OptionKind, capability: CapabilityId, subject: Subject, label: string, preset: Values = {}, ask?: string[]): DecisionOption {
  const result = check(state, principal, now, capability, subject, { label, preset, ask });
  const key = `${kind}:${capability}:${subject.taskId ?? subject.leadId ?? ''}`;
  return result.ok
    ? { key, kind, label, offer: result.offer, supported: true, recommended: false }
    : { key, kind, label, supported: false, refusal: result.error, recommended: false };
}

function actionOption(state: QuestState, principal: string, now: number, kind: OptionKind, action: Action, label: string): DecisionOption {
  const dry = apply(state, action, { actor: principal, now, newId: () => 'dry-run' });
  const key = `${kind}:${action.type}:${'id' in action ? action.id : ''}`;
  return dry.ok ? { key, kind, label, action, supported: true, recommended: false } : { key, kind, label, action, supported: false, refusal: dry.error, recommended: false };
}

function recommend(options: DecisionOption[], kind: OptionKind) {
  const target = options.find(item => item.kind === kind && item.supported) ?? options.find(item => item.supported);
  return options.map(item => (item === target ? { ...item, recommended: true } : item));
}

const isManager = (state: QuestState, id: string) => hasRole(state, id, ['manager']);

/** Decisions that need the principal's authority, most urgent first. */
export function decisionDesk(state: QuestState, now: number, principal: string): Decision[] {
  const out: Decision[] = [];
  const manager = isManager(state, principal);
  const covered = new Set<string>();

  for (const grant of state.grants) {
    if (grant.status !== 'pending' || grant.requester === principal || !canDecideGrants(state, principal)) continue;
    const task = taskById(state, grant.taskId);
    const options = [
      actionOption(state, principal, now, 'approve', { type: 'grant/decide', id: grant.id, approve: true }, `Allow ${duration(state.policy.grantSeconds * 1000)}`),
      actionOption(state, principal, now, 'decline', { type: 'grant/decide', id: grant.id, approve: false }, 'Deny'),
    ];
    out.push({
      id: `access-${grant.id}`, kind: 'access', urgency: 'critical', since: grant.requestedAt, source: sourceOf(state, 'grant', grant.id),
      what: `${nameOf(state, grant.requester)} wants ${SECTION_LABELS[grant.section]} during Critical Focus.`,
      why: `Reason given: “${grant.reason}”. Access is temporary and returns to “${task?.title ?? 'the critical task'}” automatically.`,
      waiting: [{ personId: grant.requester, label: nameOf(state, grant.requester) }],
      delay: `${firstName(state, grant.requester)} stays locked to the critical task until you decide.`,
      recommendation: 'Only you can decide this under the current policy. Short, automatic expiry keeps the risk low.',
      options: recommend(options, 'approve'),
    });
  }

  for (const task of state.tasks) {
    if (task.status !== 'review') continue;
    if (!(task.approver === principal || (!task.approver && manager))) continue;
    covered.add(task.id);
    const unlocks = dependents(state, task);
    const delegate = recommendOwner(state, { task }, [principal, task.owner, ...state.people.filter(item => !hasRole(state, item.id, ['manager', 'coordinator'])).map(item => item.id)]);
    const options = [
      capOption(state, principal, now, 'approve', 'task.advance', { taskId: task.id }, 'Approve & complete'),
      capOption(state, principal, now, 'decline', 'task.send-back', { taskId: task.id }, 'Send back with a note'),
      ...(delegate ? [actionOption(state, principal, now, 'delegate', { type: 'task/update', id: task.id, changes: { approver: delegate.personId } }, `Let ${firstName(state, delegate.personId)} approve`)] : []),
    ];
    out.push({
      id: `approval-${task.id}`, kind: 'approval', urgency: unlocks.length || task.priority === 'high' ? 'high' : 'normal', since: task.lastActivityAt, source: sourceOf(state, 'task', task.id),
      what: `Approve “${task.title}”?`,
      why: task.approver ? `You are the approver. ${nameOf(state, task.owner, 'The owner')} sent it for review.` : 'It has no approver, so it needs a manager.',
      waiting: [
        ...(task.owner ? [{ personId: task.owner, label: nameOf(state, task.owner) }] : []),
        ...unlocks.map(item => ({ personId: item.owner || task.nextOwner || undefined, label: `${nameOf(state, item.owner || task.nextOwner, 'nobody yet')} (“${item.title}”)` })),
      ],
      delay: unlocks.length ? `${unlocks.length} task(s) stay locked: ${unlocks.map(item => `“${item.title}”`).join(', ')}.` : `${firstName(state, task.owner, 'The owner')} can’t close it.`,
      recommendation: unlocks.length
        ? 'Decide now: other work is waiting on it.'
        : delegate ? `Nothing waits on it. Hand the approval to ${nameOf(state, delegate.personId)} (${delegate.reason}) to take it off your desk.` : 'Nothing waits on it; decide when convenient.',
      options: recommend(options, unlocks.length || !delegate ? 'approve' : 'delegate'),
    });
  }

  for (const lead of state.leads) {
    if (lead.stage !== 'escalated') continue;
    if (!(lead.escalatedTo === principal || (!lead.escalatedTo && manager))) continue;
    for (const task of state.tasks) if (task.leadId === lead.id) covered.add(task.id);
    // A follow-up clears the escalation and goes to the lead's owner; assigning alone leaves it escalated.
    const owner = lead.assignee && lead.assignee !== principal ? lead.assignee : '';
    const delegate = owner ? { personId: owner, reason: 'already owns the lead' } : recommendOwner(state, { lead }, [principal]);
    const options = [
      ...(owner
        ? [capOption(state, principal, now, 'delegate', 'lead.follow-up', { leadId: lead.id }, `Back to ${firstName(state, owner)} with a follow-up date`, {}, ['date', 'note'])]
        : delegate ? [capOption(state, principal, now, 'delegate', 'lead.assign', { leadId: lead.id }, `Give it to ${firstName(state, delegate.personId)}`, { person: delegate.personId })] : []),
      capOption(state, principal, now, 'approve', 'lead.advance', { leadId: lead.id }, 'Hand it on to delivery'),
      ...(owner ? [] : [capOption(state, principal, now, 'other', 'lead.follow-up', { leadId: lead.id }, 'Schedule a follow-up yourself', {}, ['date', 'note'])]),
    ];
    out.push({
      id: `lead-${lead.id}`, kind: 'escalated-lead', urgency: 'high', since: lead.updatedAt, source: sourceOf(state, 'lead', lead.id),
      what: `${lead.name} was escalated to you.`,
      why: `${lead.need}.${lead.blocker ? ` Blocker: “${lead.blocker}”.` : ''}`,
      waiting: [{ label: `${lead.name} (customer)` }, ...(lead.assignee ? [{ personId: lead.assignee, label: nameOf(state, lead.assignee) }] : [])],
      delay: 'A responsive lead goes cold while nobody owns the next step.',
      recommendation: owner
        ? `Send it back to ${nameOf(state, owner)} with a follow-up date and your answer as the next step.`
        : delegate ? `Give it to ${nameOf(state, delegate.personId)} (${delegate.reason}). It stays escalated until a follow-up is scheduled or it is handed on.` : 'Decide the next step.',
      options: recommend(options, 'delegate'),
    });
  }

  for (const task of state.tasks) {
    if (!isOpen(task) || covered.has(task.id)) continue;
    const blockedOnMe = task.status === 'blocked' && (task.blocker?.helper === principal || (task.decisionOwner === principal && task.owner !== principal));
    if (!blockedOnMe) continue;
    covered.add(task.id);
    const helper = recommendOwner(state, { task }, [principal, task.owner]);
    const options = [
      capOption(state, principal, now, 'approve', 'task.resolve', { taskId: task.id }, 'Mark the blocker resolved', {}, ['note']),
      ...(helper ? [capOption(state, principal, now, 'delegate', 'task.request-help', { taskId: task.id }, `Ask ${firstName(state, helper.personId)} instead`, { person: helper.personId, note: task.blocker?.note ?? 'Needs a decision' })] : []),
    ];
    out.push({
      id: `call-${task.id}`, kind: 'needs-your-call', urgency: task.priority === 'high' || task.ultra ? 'critical' : 'high', since: task.blocker?.at ?? task.lastActivityAt, source: sourceOf(state, 'task', task.id),
      what: `“${task.title}” is blocked on you.`,
      why: `${firstName(state, task.blocker?.by ?? task.owner, 'Someone')} asked: “${task.blocker?.note ?? 'needs a decision'}”.`,
      waiting: [{ personId: task.owner || undefined, label: nameOf(state, task.owner, 'nobody yet') }, ...dependents(state, task).map(item => ({ personId: item.owner || undefined, label: `${nameOf(state, item.owner, 'nobody yet')} (“${item.title}”)` }))],
      delay: `Blocked for ${duration(now - (task.blocker?.at ?? task.lastActivityAt))}${dependents(state, task).length ? `; ${dependents(state, task).length} task(s) wait behind it` : ''}.`,
      recommendation: task.decisionOwner === principal || !helper
        ? 'It is your call: answer it, then mark the blocker resolved.'
        : `Unless only you can answer, ask ${nameOf(state, helper.personId)} (${helper.reason}).`,
      options: recommend(options, task.decisionOwner === principal || !helper ? 'approve' : 'delegate'),
    });
  }

  if (manager) {
    const today = localDate(now);
    for (const task of state.tasks) {
      if (!isOpen(task) || task.owner || covered.has(task.id)) continue;
      const pressing = task.priority === 'high' || task.ultra || (task.due !== '' && task.due <= today);
      if (!pressing) continue;
      const pick = recommendOwner(state, { task }, [principal]);
      const options = [
        ...(pick ? [capOption(state, principal, now, 'delegate', 'task.handoff', { taskId: task.id }, `Assign ${firstName(state, pick.personId)}`, { person: pick.personId }, ['note'])] : []),
        capOption(state, principal, now, 'other', 'task.handoff', { taskId: task.id }, 'Assign someone else', {}, ['person', 'note']),
      ];
      out.push({
        id: `unowned-${task.id}`, kind: 'unowned-priority', urgency: 'high', since: task.createdAt, source: sourceOf(state, 'task', task.id),
        what: `Who should own “${task.title}”?`,
        why: `It is ${task.priority === 'high' ? 'high priority' : `due ${task.due}`} and nobody owns it.`,
        waiting: dependents(state, task).map(item => ({ personId: item.owner || undefined, label: `${nameOf(state, item.owner, 'nobody yet')} (“${item.title}”)` })),
        delay: 'Work without an owner does not move, and nobody is told when it unlocks.',
        recommendation: pick ? `Assign ${nameOf(state, pick.personId)} (${pick.reason}).` : 'Assign someone who can do it.',
        options: recommend(options, 'delegate'),
      });
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.urgency] - SEVERITY_ORDER[b.urgency] || a.since - b.since || a.id.localeCompare(b.id));
}

// ── Follow-up intelligence ────────────────────────────────────────────────

export type FollowUpKind = 'no-owner' | 'stalled' | 'unanswered-lead' | 'missed-deadline' | 'handoff-failure';

export interface FollowUp {
  id: string;
  kind: FollowUpKind;
  severity: Severity;
  what: string;
  why: string;
  /** Who should handle it. '' = the team. */
  handler: string;
  /** Whether the principal personally has to act. */
  needsPrincipal: boolean;
  suggestion: string;
  /** A one-click action for the handler, when the engine accepts it. */
  suggested?: DecisionOption;
  source: SourceRef;
}

const FOLLOW_UP_KINDS: Partial<Record<InsightKind, FollowUpKind>> = {
  unassigned: 'no-owner', 'handoff-gap': 'no-owner', stalled: 'stalled', overdue: 'missed-deadline',
  'lead-response': 'unanswered-lead', 'lead-unassigned': 'unanswered-lead',
};

export interface HandoffHistory { taskId: string; reassignments: number; sendBacks: number }

/** Repeated handoff failures from event structure (not text). Undone events don't count. */
export function handoffHistory(state: QuestState): HandoffHistory[] {
  const byTask = new Map<string, HandoffHistory>();
  const entry = (taskId: string) => byTask.get(taskId) ?? byTask.set(taskId, { taskId, reassignments: 0, sendBacks: 0 }).get(taskId)!;
  const approvalsFromReview = new Map<string, number>();
  for (const event of state.events) {
    if (event.undone || !event.taskId) continue;
    const before = event.undo?.tasks[event.taskId];
    if (!before) continue;
    if (event.kind === 'handoff' && before.owner) entry(event.taskId).reassignments += 1;
    if (event.kind === 'approval' && before.status === 'review') approvalsFromReview.set(event.taskId, (approvalsFromReview.get(event.taskId) ?? 0) + 1);
  }
  // Leaving review either approves (task is now done) or sends it back.
  for (const [taskId, count] of approvalsFromReview) entry(taskId).sendBacks = count - (taskById(state, taskId)?.status === 'done' ? 1 : 0);
  return [...byTask.values()].filter(item => taskById(state, item.taskId)).sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function followUps(state: QuestState, now: number, principal: string): FollowUp[] {
  const out: FollowUp[] = [];
  const asOption = (item: Insight): DecisionOption | undefined => (item.action ? { key: `suggested:${item.id}`, kind: 'other', label: item.action.label, action: item.action.do, supported: true, recommended: true } : undefined);

  for (const item of insights(state, now)) {
    const kind = FOLLOW_UP_KINDS[item.kind];
    if (!kind) continue;
    const task = item.taskId ? taskById(state, item.taskId) : undefined;
    let suggested = asOption(item);
    let suggestion = item.next;
    if (item.kind === 'unassigned' && task) {
      const pick = recommendOwner(state, { task }, [principal]);
      if (pick) {
        suggestion = `Assign ${nameOf(state, pick.personId)} (${pick.reason}).`;
        const option = capOption(state, item.who || principal, now, 'delegate', 'task.handoff', { taskId: task.id }, `Assign ${firstName(state, pick.personId)}`, { person: pick.personId }, ['note']);
        if (option.supported) suggested = { ...option, recommended: true };
      }
    }
    out.push({
      id: item.id, kind, severity: item.severity, what: item.what, why: item.why, handler: item.who, needsPrincipal: item.who === principal, suggestion, suggested,
      source: item.leadId ? sourceOf(state, 'lead', item.leadId) : sourceOf(state, 'task', item.taskId ?? ''),
    });
  }

  for (const history of handoffHistory(state)) {
    const task = taskById(state, history.taskId)!;
    if (!isOpen(task) || (history.reassignments < 3 && history.sendBacks < 2)) continue;
    const handler = task.decisionOwner || state.people.find(item => item.role === 'coordinator')?.id || '';
    out.push({
      id: `handoff-failure-${task.id}`, kind: 'handoff-failure', severity: 'high', handler, needsPrincipal: handler === principal,
      what: `“${task.title}” keeps bouncing.`,
      why: [history.reassignments >= 3 ? `reassigned ${history.reassignments} times` : '', history.sendBacks >= 2 ? `sent back ${history.sendBacks} times` : ''].filter(Boolean).join(' and ') + '.',
      suggestion: 'Agree one owner and a written definition of done before it moves again.',
      source: sourceOf(state, 'task', task.id),
    });
  }

  return out.sort((a, b) => Number(b.needsPrincipal) - Number(a.needsPrincipal) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id));
}

// ── Executive Brief ───────────────────────────────────────────────────────

/** Calendar data supplied by an authorized integration. Task-HQ has none today. */
export interface CalendarFeed {
  source: string;
  synthetic: boolean;
  appointments: { id: string; title: string; start: number; end?: number; with?: string }[];
}

export type BriefSectionKey = 'decisions' | 'blocked' | 'leads' | 'overdue' | 'appointments' | 'reassignment' | 'changes';

export interface BriefItem {
  id: string;
  text: string;
  /** Who handles it ('' = the team). */
  handler: string;
  needsPrincipal: boolean;
  /** Also on the principal's Decision Desk; counted once there. */
  onDesk: boolean;
  severity: Severity;
  source: SourceRef;
}

export interface BriefSection {
  key: BriefSectionKey;
  label: string;
  /** not-connected: no authorized source; partial: history before `since` is no longer retained. */
  status: 'ok' | 'not-connected' | 'partial';
  note?: string;
  items: BriefItem[];
}

export interface ExecutiveBrief {
  principal: string;
  generatedAt: number;
  since: number | null;
  synthetic: boolean;
  /** One or two spoken-length sentences. */
  headline: string;
  needsYou: number;
  handledByOthers: number;
  sections: BriefSection[];
}

const EVENT_CAP = 400;

export function executiveBrief(state: QuestState, now: number, principal: string, options: { since?: number | null; calendar?: CalendarFeed | null } = {}): ExecutiveBrief {
  const since = options.since ?? null;
  const desk = decisionDesk(state, now, principal);
  const all = insights(state, now);
  const fromInsight = (item: Insight): BriefItem => ({
    id: item.id, text: item.what, handler: item.who, needsPrincipal: item.who === principal, onDesk: false, severity: item.severity,
    source: item.leadId ? sourceOf(state, 'lead', item.leadId) : item.grantId ? sourceOf(state, 'grant', item.grantId) : sourceOf(state, 'task', item.taskId ?? ''),
  });
  const of = (...kinds: InsightKind[]) => all.filter(item => kinds.includes(item.kind)).map(fromInsight);
  const failures = followUps(state, now, principal).filter(item => item.kind === 'handoff-failure');

  const sections: BriefSection[] = [
    { key: 'decisions', label: 'Decisions that need you', status: 'ok', items: desk.map(item => ({ id: item.id, text: item.what, handler: principal, needsPrincipal: true, onDesk: true, severity: item.urgency, source: item.source })) },
    { key: 'blocked', label: 'Blocked work', status: 'ok', items: of('blocked', 'lead-blocked') },
    { key: 'leads', label: 'Unanswered leads', status: 'ok', items: of('lead-response', 'lead-unassigned') },
    { key: 'overdue', label: 'Overdue commitments', status: 'ok', items: of('overdue') },
    appointments(state, now, principal, options.calendar ?? null),
    {
      key: 'reassignment', label: 'Work awaiting reassignment', status: 'ok',
      items: [...of('unassigned', 'handoff-gap'), ...failures.map(item => ({ id: item.id, text: `${item.what} ${item.why}`, handler: item.handler, needsPrincipal: item.needsPrincipal, onDesk: false, severity: item.severity, source: item.source }))],
    },
    changes(state, principal, since),
  ];

  // Items the desk already covers stay visible in their section but are owned by the desk.
  const deskSources = new Set(desk.map(item => `${item.source.kind}:${item.source.id}`));
  for (const section of sections) {
    if (section.key === 'decisions' || section.key === 'changes') continue;
    section.items = section.items.map(item => (deskSources.has(`${item.source.kind}:${item.source.id}`) ? { ...item, needsPrincipal: true, onDesk: true, handler: principal } : item));
  }

  // Count each underlying record once: desk decisions, then anything else that needs the principal.
  const open = sections.filter(section => section.key !== 'changes' && section.key !== 'appointments').flatMap(section => section.items);
  const mine = new Set(open.filter(item => item.needsPrincipal).map(item => `${item.source.kind}:${item.source.id}`));
  const others = new Set(open.filter(item => !item.needsPrincipal).map(item => `${item.source.kind}:${item.source.id}`).filter(key => !mine.has(key)));
  const needsYou = mine.size;
  const handledByOthers = others.size;

  const name = firstName(state, principal, 'there');
  const headline = needsYou === 0
    ? `${name}, nothing needs you right now. ${handledByOthers} open item(s) are with the people who own them.`
    : `${name}, ${needsYou} thing(s) need you${desk.length ? `, ${desk.length} of them decision(s)` : ''}. ${handledByOthers} other item(s) are with the people who own them.`;

  return { principal, generatedAt: now, since, synthetic: isSyntheticWorkspace(state), headline, needsYou, handledByOthers, sections };
}

function appointments(state: QuestState, now: number, principal: string, calendar: CalendarFeed | null): BriefSection {
  if (!calendar) return { key: 'appointments', label: 'Upcoming appointments', status: 'not-connected', note: 'No calendar is connected. Nothing is shown rather than guessed.', items: [] };
  const items = calendar.appointments
    .filter(item => item.start >= now && item.start < now + DAY)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map(item => ({ id: item.id, text: `${item.title} at ${new Date(item.start).toTimeString().slice(0, 5)}${item.with ? ` with ${item.with}` : ''}`, handler: principal, needsPrincipal: true, onDesk: false, severity: 'normal' as Severity, source: { kind: 'appointment' as const, id: item.id, synthetic: calendar.synthetic } }));
  return { key: 'appointments', label: 'Upcoming appointments', status: 'ok', note: `From ${calendar.source}${calendar.synthetic ? ' (synthetic)' : ''}, next 24 hours.`, items };
}

function changes(state: QuestState, principal: string, since: number | null): BriefSection {
  if (since === null) return { key: 'changes', label: 'Changes since your last briefing', status: 'ok', note: 'First briefing: no earlier briefing to compare with.', items: [] };
  // The principal's own actions are not news to them.
  const recent = state.events.filter(event => event.at > since && event.actor !== 'system' && event.actor !== principal && event.kind !== 'feedback');
  const oldest = state.events[state.events.length - 1];
  const partial = state.events.length >= EVENT_CAP && !!oldest && oldest.at > since;
  return {
    key: 'changes', label: 'Changes since your last briefing', status: partial ? 'partial' : 'ok',
    note: partial ? `Only the most recent ${EVENT_CAP} changes are kept; earlier changes since your last briefing are not shown.` : undefined,
    items: recent.map(event => ({ id: event.id, text: event.text, handler: event.actor, needsPrincipal: false, onDesk: false, severity: 'normal', source: sourceOf(state, 'event', event.id) })),
  };
}

// ── Daily Signal ──────────────────────────────────────────────────────────

export type SignalSourceId = 'task-hq' | 'calendar' | 'calls' | 'email' | 'customer-interactions';

export interface SignalSource { id: SignalSourceId; label: string; status: 'connected' | 'not-connected'; synthetic: boolean; note: string }

export interface SignalEntry { at: number; actor: string; kind: QuestEvent['kind']; text: string; source: SourceRef }

export interface DailySignal {
  day: string;
  synthetic: boolean;
  sources: SignalSource[];
  entries: SignalEntry[];
  totals: { completed: number; handoffs: number; helpRequests: number; approvals: number; leadActivity: number; undone: number };
  summary: string;
}

/**
 * One day of authorized activity, every entry linked to its source record.
 * Only Task-HQ records are read. Calls, email, calendar and customer
 * interactions are listed as not connected; private communications are never read.
 */
export function dailySignal(state: QuestState, now: number, day = localDate(now)): DailySignal {
  const synthetic = isSyntheticWorkspace(state);
  const entries = state.events
    .filter(event => localDate(event.at) === day && event.actor !== 'system' && event.kind !== 'feedback')
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(event => ({ at: event.at, actor: event.actor, kind: event.kind, text: event.text, source: sourceOf(state, 'event', event.id) }));
  const events = new Map(state.events.map(event => [event.id, event]));
  const live = entries.filter(item => !events.get(item.source.id)?.undone);
  const before = (item: SignalEntry) => { const event = events.get(item.source.id); return event?.taskId ? event.undo?.tasks[event.taskId] : undefined; };
  const totals = {
    // Completion comes from the task records themselves, not from event wording.
    completed: state.tasks.filter(task => task.completedAt !== null && localDate(task.completedAt) === day).length,
    handoffs: live.filter(item => item.kind === 'handoff').length,
    helpRequests: live.filter(item => item.kind === 'help' && before(item) && before(item)!.status !== 'blocked').length,
    approvals: live.filter(item => item.kind === 'approval').length,
    leadActivity: live.filter(item => item.kind === 'lead').length,
    undone: entries.length - live.length,
  };
  const sources: SignalSource[] = [
    { id: 'task-hq', label: 'Task-HQ activity', status: 'connected', synthetic, note: synthetic ? 'Demo workspace: synthetic people and work.' : 'Live workspace records.' },
    { id: 'calendar', label: 'Calendar', status: 'not-connected', synthetic: false, note: 'Needs an authorized calendar integration.' },
    { id: 'calls', label: 'Business calls', status: 'not-connected', synthetic: false, note: 'Needs an authorized call-log integration.' },
    { id: 'email', label: 'Business email', status: 'not-connected', synthetic: false, note: 'Needs an authorized, scoped business mailbox. Private mail is never read.' },
    { id: 'customer-interactions', label: 'Customer interactions', status: 'not-connected', synthetic: false, note: 'Only Task-HQ lead records today.' },
  ];
  const summary = entries.length === 0
    ? `No Task-HQ activity recorded on ${day}.`
    : `${entries.length} change(s) on ${day}: ${totals.completed} completed, ${totals.handoffs} handoff(s), ${totals.helpRequests} help request(s), ${totals.leadActivity} lead update(s).${synthetic ? ' Synthetic demo data.' : ''}`;
  return { day, synthetic, sources, entries, totals, summary };
}
