// Context → composition pipeline for the Instrument Deck.
//   resolveContext(state, actor, selection, now)  – what is in front of this person
//   composeDeck(context, prefs)                     – which registered instruments, in what order
// Both are pure. Actions come from capability checks (engine dry runs) only.
import type { AccessGrant, QuestEvent, QuestState } from './contract.ts';
import { check } from './capabilities.ts';
import type { ActionOffer, CapabilityId, Subject } from './capabilities.ts';
import { composeForTask } from './compose.ts';
import type { DeckContextKind, DeckSpec, InstrumentSpec } from './instruments.ts';
import { DURATION_RANGE, PRIORITY_LEVELS, validateDeck } from './instruments.ts';
import {
  activeGrant, blockingDeps, dependents, firstName, inFocus, isOverdue, leadById, leadElapsed, nameOf, pendingGrant, taskById,
} from './selectors.ts';
import { MINUTE, duration } from './time.ts';
import { presetFor } from './workspace.ts';

export interface DeckPrefs {
  /** Deck-level designation 1 (P1) … 5 (P5). Not a lead field. */
  priority: number;
  /** Personal work interval in minutes. */
  durationMin: number;
  /** Personal interval timer. Never Only Priority. */
  focus: { on: boolean; startedAt: number | null };
}

export const DEFAULT_DECK_PREFS: DeckPrefs = { priority: 2, durationMin: 25, focus: { on: false, startedAt: null } };

export function clampDuration(minutes: number) {
  const stepped = Math.round(minutes / DURATION_RANGE.step) * DURATION_RANGE.step;
  return Math.min(DURATION_RANGE.max, Math.max(DURATION_RANGE.min, stepped));
}

/** Explicit mapping from deck priority to the task schema (tasks only know high/normal). */
export function taskPriorityFor(level: number): 'high' | 'normal' {
  return level <= 2 ? 'high' : 'normal';
}

export interface Selection { leadId?: string; taskId?: string }

export interface TaskRef { taskId: string; title: string; owner: string; status: string }

export interface DeckContext {
  kind: DeckContextKind;
  key: string;
  signature: string;
  actor: string;
  title: string;
  subtitle: string;
  subject: Subject;
  owner: string;
  ownerLabel: string;
  stateLabel: string;
  elapsedMs?: number;
  targetMs?: number;
  urgency: { level: 'critical' | 'high' | 'normal'; reasons: string[] };
  /** Authorized now (each one a successful engine dry run). */
  actions: ActionOffer[];
  /** First authorized action, or why there is none. */
  nextStep: string;
  events: QuestEvent[];
  relations: { waitsOn: TaskRef[]; unlocks: TaskRef[] };
  businessPriority?: 'high' | 'normal';
  focus?: { since: number; activatedBy: string; pending?: AccessGrant; active?: AccessGrant; request: ActionOffer | null; grantSeconds: number };
}

const ref = (state: QuestState, id: string): TaskRef | null => {
  const task = taskById(state, id);
  return task ? { taskId: task.id, title: task.title, owner: task.owner, status: task.status } : null;
};

function offers(state: QuestState, actor: string, now: number, subject: Subject, list: [CapabilityId, string, { ask?: string[]; preset?: Record<string, string> }?][]) {
  return list.map(([capability, label, extra]) => check(state, actor, now, capability, subject, { label, ...extra }))
    .flatMap(result => (result.ok ? [result.offer] : []));
}

const NONE: Omit<DeckContext, 'actor'> = {
  kind: 'none', key: 'none', signature: 'none', title: 'Nothing selected', subtitle: 'Select a lead or task to bring its instruments into focus.',
  subject: {}, owner: '', ownerLabel: 'Owner', stateLabel: '', urgency: { level: 'normal', reasons: [] }, actions: [], nextStep: '', events: [], relations: { waitsOn: [], unlocks: [] },
};

export function resolveContext(state: QuestState, actor: string, selection: Selection | null, now: number): DeckContext {
  if (selection?.leadId) {
    const lead = leadById(state, selection.leadId);
    if (!lead) return { ...NONE, actor, subtitle: 'That lead no longer exists.' };
    const subject = { leadId: lead.id };
    const targetMs = state.policy.leadResponseMinutes * MINUTE;
    const elapsedMs = leadElapsed(lead, now);
    const responded = !!lead.firstResponseAt;
    const actions = !lead.assignee
      ? offers(state, actor, now, subject, [['lead.take', 'Assign to me'], ['lead.assign', 'Assign to someone'], ['lead.attempt', 'Record contact attempt']])
      : !responded
        ? offers(state, actor, now, subject, [['lead.attempt', 'Record contact attempt'], ['lead.escalate', 'Escalate']])
        : offers(state, actor, now, subject, [['lead.follow-up', 'Schedule follow-up'], ...(lead.stage !== 'qualified' ? [['lead.qualify', 'Mark qualified'] as [CapabilityId, string]] : []), ['lead.advance', presetFor(state).leadHandoffAction], ['lead.escalate', 'Escalate']]);
    const reasons: string[] = [];
    if (!lead.assignee) reasons.push('Nobody owns this lead');
    if (!responded) reasons.push(elapsedMs > targetMs ? `Past the ${duration(targetMs)} response target` : `${duration(targetMs - elapsedMs)} left on the response target`);
    if (lead.stage === 'blocked') reasons.push(`Blocked: ${lead.blocker}`);
    if (lead.stage === 'escalated') reasons.push(`Escalated to ${nameOf(state, lead.escalatedTo)}`);
    const stateLabel = !responded ? (lead.assignee ? 'Waiting for first response' : 'Unassigned — no response yet')
      : lead.stage === 'won' ? presetFor(state).leadHandedLabel : lead.stage === 'follow-up' ? 'Responded · follow-up scheduled' : lead.stage === 'qualified' ? 'Responded · qualified' : lead.stage === 'escalated' ? 'Escalated' : 'Responded';
    const related = state.tasks.filter(task => task.leadId === lead.id);
    return {
      kind: 'lead', key: `lead:${lead.id}`, actor, subject,
      signature: `lead:${lead.id}:${lead.assignee}:${lead.stage}:${responded}:${actions.map(item => item.capability).join(',')}`,
      title: lead.name, subtitle: `${lead.need} · ${lead.source}`,
      owner: lead.assignee, ownerLabel: 'Lead owner', stateLabel, elapsedMs, targetMs,
      urgency: { level: !responded && (elapsedMs > targetMs || !lead.assignee) ? 'critical' : !responded ? 'high' : 'normal', reasons },
      actions, nextStep: actions[0] ? actions[0].label : lead.assignee && lead.assignee !== actor ? `${nameOf(state, lead.assignee)} owns this lead.` : 'No further lead action for you.',
      events: state.events.filter(event => event.leadId === lead.id || (event.taskId && related.some(task => task.id === event.taskId))).slice(0, 10),
      relations: { waitsOn: [], unlocks: related.map(task => ({ taskId: task.id, title: task.title, owner: task.owner, status: task.status })) },
    };
  }

  if (selection?.taskId) {
    const task = taskById(state, selection.taskId);
    if (!task) return { ...NONE, actor, subtitle: 'That task no longer exists.' };
    const subject = { taskId: task.id };
    const focused = state.focus?.taskId === task.id && inFocus(state, actor);
    const kind: DeckContextKind = focused ? 'focus' : task.dependsOn.length || dependents(state, task).length ? 'dependency' : 'task';
    const situation = composeForTask(state, actor, now, task.id);
    const rockable: CapabilityId[] = ['task.advance', 'task.resolve', 'task.request-help', 'task.send-back'];
    const actions = [...(situation?.actions ?? []), ...(situation?.more ?? [])].filter(item => rockable.includes(item.capability));
    const waitsOn = task.dependsOn.map(id => ref(state, id)).filter((item): item is TaskRef => !!item);
    const unlocks = state.tasks.filter(item => item.dependsOn.includes(task.id)).map(item => ({ taskId: item.id, title: item.title, owner: item.owner, status: item.status }));
    const reasons: string[] = [];
    if (focused) reasons.push('Only Priority');
    if (blockingDeps(state, task).length) reasons.push(`Waiting on “${blockingDeps(state, task)[0]!.title}”`);
    if (task.status === 'blocked') reasons.push(`Blocked: ${task.blocker?.note ?? ''}`);
    if (isOverdue(task, now)) reasons.push(`Overdue since ${task.due}`);
    const waiting = dependents(state, task).filter(item => item.owner && item.owner !== actor);
    if (waiting.length && task.status !== 'done') reasons.push(`${[...new Set(waiting.map(item => firstName(state, item.owner)))].join(', ')} waiting on this`);
    const grantSeconds = state.policy.grantSeconds;
    const focusInfo = focused && state.focus ? {
      since: state.focus.since, activatedBy: state.focus.activatedBy, grantSeconds,
      pending: pendingGrant(state, actor), active: activeGrant(state, actor, now),
      request: offers(state, actor, now, {}, [['grant.request', 'Request temporary access']])[0] ?? null,
    } : undefined;
    return {
      kind, key: `task:${task.id}`, actor, subject,
      signature: `${kind}:${task.id}:${task.status}:${task.owner}:${blockingDeps(state, task).length}:${actions.map(item => item.capability).join(',')}:${focusInfo?.pending?.id ?? ''}${focusInfo?.active?.id ?? ''}`,
      title: task.title, subtitle: situation?.headline ?? '',
      owner: task.owner, ownerLabel: 'Owner', stateLabel: situation?.kicker ? `${situation.kicker.charAt(0)}${situation.kicker.slice(1).toLowerCase()}` : task.status,
      urgency: { level: focused || task.status === 'blocked' ? 'critical' : reasons.length ? 'high' : 'normal', reasons },
      actions, nextStep: actions[0]?.label ?? situation?.headline ?? '',
      events: state.events.filter(event => event.taskId && [task.id, ...waitsOn.map(item => item.taskId), ...unlocks.map(item => item.taskId)].includes(event.taskId)).slice(0, 10),
      relations: { waitsOn, unlocks }, businessPriority: task.priority, focus: focusInfo,
    };
  }
  return { ...NONE, actor };
}

export function composeDeck(context: DeckContext, prefs: DeckPrefs, authority: 'local-demo' | 'server-verified' = 'local-demo'): DeckSpec {
  const dial = (locked: boolean): InstrumentSpec => ({ id: 'priority', instrument: 'priority-dial', state: locked ? 'locked' : 'adjustable', value: locked ? 'P1' : PRIORITY_LEVELS[Math.min(4, Math.max(0, prefs.priority - 1))] });
  const fader: InstrumentSpec = { id: 'interval', instrument: 'duration-fader', state: prefs.focus.on ? 'running' : 'idle', value: clampDuration(prefs.durationMin) };
  const rocker: InstrumentSpec = { id: 'rocker', instrument: 'action-rocker', state: context.actions.length ? 'ready' : 'none' };
  const status: InstrumentSpec = { id: 'status', instrument: 'status-display', state: authority };
  const timeline: InstrumentSpec = { id: 'timeline', instrument: 'context-timeline', state: 'history' };
  let instruments: InstrumentSpec[];
  switch (context.kind) {
    case 'lead': {
      const waiting = context.stateLabel.includes('no response') || context.stateLabel.startsWith('Waiting');
      instruments = waiting
        ? [{ id: 'response', instrument: 'response-meter', state: (context.elapsedMs ?? 0) > (context.targetMs ?? 0) ? 'over' : 'within' }, rocker, status, dial(false), fader, timeline]
        : [rocker, status, timeline, dial(false), fader];
      break;
    }
    case 'dependency': {
      const blocked = context.relations.waitsOn.some(item => item.status !== 'done');
      const handed = context.relations.unlocks.length > 0 && context.stateLabel.toLowerCase().startsWith('done');
      instruments = [{ id: 'handoff', instrument: 'dependency-map', state: blocked ? 'waiting' : handed ? 'handed-off' : 'ready' }, rocker, status, dial(false), fader, timeline];
      break;
    }
    case 'focus': {
      const f = context.focus;
      instruments = [status, rocker, { id: 'access', instrument: 'access-panel', state: f?.active ? 'granted' : f?.pending ? 'pending' : f?.request ? 'can-request' : 'none' }, dial(true), fader, timeline];
      break;
    }
    case 'task':
      instruments = [rocker, status, dial(false), fader, timeline];
      break;
    default:
      instruments = [];
  }
  const spec: DeckSpec = { context: context.kind, key: context.key, signature: context.signature, instruments };
  const errors = validateDeck(spec);
  if (errors.length) throw new Error(`Invalid deck layout: ${errors.join(' ')}`);
  return spec;
}
