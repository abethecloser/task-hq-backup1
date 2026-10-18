// Situation composer: a deterministic function from (state, person, time, device)
// to a structured description of what this person should see and be able to do
// right now, built only from approved blocks and capability offers.
//
// It never changes state, never invents permissions (every offer is a dry run
// through the engine) and never claims an external operation happened.
import type { Lead, QuestEvent, QuestState, Task, TaskStatus } from './contract.ts';
import { offer } from './capabilities.ts';
import type { ActionOffer } from './capabilities.ts';
import {
  blockingDeps, compareTasks, dependents, firstName, hasRole, inFocus, isOverdue, leadById, leadElapsed, moveForwardPlan, nameOf,
  nextActionable, peopleWithRole, taskById,
} from './selectors.ts';
import { HOUR, MINUTE, duration } from './time.ts';
import { presetFor } from './workspace.ts';

export type SituationKind =
  | 'critical-focus' | 'outcome' | 'lead-response' | 'approval' | 'blocker' | 'handoff-arrived'
  | 'handoff-ready' | 'help-request' | 'next-action' | 'waiting' | 'done' | 'clear';

/** Approved presentation blocks, rendered in this order when present. */
export type BlockKind = 'focus-boundary' | 'lead-timer' | 'contact' | 'blocker' | 'outcome' | 'chain' | 'people' | 'history';

export interface ChainNode {
  taskId: string;
  title: string;
  owner: string;
  status: TaskStatus;
  position: 'before' | 'current' | 'after';
  /** 1 = directly connected, 2+ = further downstream. */
  depth: number;
  /** Still waiting on something other than the current task. */
  locked: boolean;
}

export interface Outcome {
  tone: 'done' | 'handoff' | 'response' | 'handed-on';
  done: string;
  doneBy: string;
  unlocked: { taskId: string; title: string; owner: string }[];
  responseMs?: number;
  targetMs?: number;
}

export interface Situation {
  key: string;
  kind: SituationKind;
  kicker: string;
  headline: string;
  detail: string;
  why: string;
  taskId?: string;
  leadId?: string;
  eventId?: string;
  people: { role: string; id: string }[];
  chain: ChainNode[];
  /** Further downstream work, revealed when the person asks what happens afterward. */
  downstream: ChainNode[];
  blocks: BlockKind[];
  /** Visible actions. */
  actions: ActionOffer[];
  /** Revealed progressively. */
  more: ActionOffer[];
  timer?: { startedAt: number; targetMs: number; stoppedAt: number | null };
  outcome?: Outcome;
  history: QuestEvent[];
  layout: 'track' | 'stack';
}

export interface ComposeContext {
  /** Event the person just produced on this surface, to show its outcome. */
  justDid?: string | null;
  /** Situation key the person chose from the queue. */
  select?: string | null;
  viewport?: 'wide' | 'compact';
}

const HANDOFF_WINDOW = 12 * HOUR;
const compact = (items: (ActionOffer | null)[]) => items.filter((item): item is ActionOffer => !!item);

// ── Shared pieces ──────────────────────────────────────────────────────────

function chainFor(state: QuestState, task: Task, viewport: ComposeContext['viewport']) {
  const node = (item: Task, position: ChainNode['position'], depth: number): ChainNode => ({
    taskId: item.id, title: item.title, owner: item.owner, status: item.status, position, depth,
    locked: position === 'after' && blockingDeps(state, item).some(dep => dep.id !== task.id),
  });
  const before = task.dependsOn.map(id => taskById(state, id)).filter((item): item is Task => !!item).map(item => node(item, 'before', 1));
  const after = state.tasks.filter(item => item.dependsOn.includes(task.id)).map(item => node(item, 'after', 1));
  const downstream: ChainNode[] = [];
  const seen = new Set([task.id, ...after.map(item => item.taskId)]);
  let frontier = after.map(item => item.taskId);
  for (let depth = 2; depth <= 4 && frontier.length; depth += 1) {
    const next = state.tasks.filter(item => !seen.has(item.id) && item.dependsOn.some(id => frontier.includes(id)));
    next.forEach(item => { seen.add(item.id); downstream.push(node(item, 'after', depth)); });
    frontier = next.map(item => item.id);
  }
  const limit = viewport === 'compact' ? 1 : 3;
  return { chain: [...before.slice(-limit), node(task, 'current', 0), ...after.slice(0, limit)], downstream };
}

function historyFor(state: QuestState, ids: string[], leadId?: string) {
  return state.events.filter(event => (event.taskId && ids.includes(event.taskId)) || (leadId && event.leadId === leadId)).slice(0, 8);
}

function peopleFor(state: QuestState, task: Task) {
  const people: { role: string; id: string }[] = [];
  if (task.owner) people.push({ role: 'Owner', id: task.owner });
  if (task.blocker?.helper) people.push({ role: 'Asked to help', id: task.blocker.helper });
  if (task.approver) people.push({ role: 'Approver', id: task.approver });
  const role = task.status === 'done' ? 'Handed to' : 'Waiting on this';
  for (const item of dependents(state, task)) if (item.owner && !people.some(p => p.id === item.owner && p.role === role)) people.push({ role, id: item.owner });
  if (task.nextOwner && !people.some(p => p.id === task.nextOwner)) people.push({ role: 'Next step', id: task.nextOwner });
  return people;
}

function unlockText(state: QuestState, task: Task) {
  const after = dependents(state, task).filter(item => item.dependsOn.every(id => id === task.id || taskById(state, id)?.status === 'done'));
  if (!after.length) return task.nextOwner ? `Then it goes to ${nameOf(state, task.nextOwner)}.` : '';
  return `Finishing it unlocks ${after.map(item => `“${item.title}” for ${nameOf(state, item.owner || task.nextOwner, 'nobody yet')}`).join(' and ')}.`;
}

function commonTaskOffers(state: QuestState, actor: string, now: number, task: Task) {
  return compact([
    !task.nextAction ? offer(state, actor, now, 'task.next-action', { taskId: task.id }, { label: 'Write the next action' }) : null,
    task.status !== 'blocked' ? offer(state, actor, now, 'task.request-help', { taskId: task.id }, { label: 'Ask for help', shortcut: 'h' }) : null,
    offer(state, actor, now, 'task.handoff', { taskId: task.id }, { label: 'Hand it to someone else' }),
    offer(state, actor, now, 'ultra.activate', { taskId: task.id }, { label: `Make this ${firstName(state, task.owner)}’s only priority`, hint: 'Locks the rest of Task-HQ for them until it’s done or released.' }),
  ]);
}

function advanceOffer(state: QuestState, actor: string, now: number, task: Task, label?: string) {
  const plan = moveForwardPlan(state, task, actor);
  return offer(state, actor, now, 'task.advance', { taskId: task.id }, { label: label ?? plan.label, tone: 'primary', hint: plan.effect, shortcut: 'm' });
}

function base(state: QuestState, task: Task, ctx: ComposeContext): Pick<Situation, 'taskId' | 'chain' | 'downstream' | 'history' | 'people' | 'layout'> {
  const { chain, downstream } = chainFor(state, task, ctx.viewport);
  return {
    taskId: task.id, chain, downstream, people: peopleFor(state, task), layout: ctx.viewport === 'compact' ? 'stack' : 'track',
    history: historyFor(state, [task.id, ...chain.map(item => item.taskId)]),
  };
}

// ── Task situations ────────────────────────────────────────────────────────

export function taskSituation(state: QuestState, actor: string, now: number, task: Task, kind: SituationKind, ctx: ComposeContext = {}): Situation {
  const b = base(state, task, ctx);
  const plan = moveForwardPlan(state, task, actor);
  const key = `${kind}:${task.id}`;
  const blocks: BlockKind[] = ['chain', 'people', 'history'];
  switch (kind) {
    case 'critical-focus':
      return {
        ...b, key, kind, kicker: 'ONLY PRIORITY', headline: task.title, blocks: ['focus-boundary', ...blocks],
        detail: task.status === 'blocked' ? `Blocked: ${task.blocker?.note}` : task.nextAction || task.description,
        why: `${nameOf(state, state.focus?.activatedBy ?? '')} made this the only priority. Everything else in Task-HQ waits.`,
        actions: compact([task.status === 'blocked' ? offer(state, actor, now, 'task.resolve', { taskId: task.id }, { label: 'Blocker resolved — resume', tone: 'primary', shortcut: 'm' }) : advanceOffer(state, actor, now, task)]),
        more: compact([task.status !== 'blocked' ? offer(state, actor, now, 'task.request-help', { taskId: task.id }, { label: `Ask ${firstName(state, state.focus?.activatedBy ?? '')} for help`, preset: { person: state.focus?.activatedBy ?? '' }, shortcut: 'h' }) : null]),
      };
    case 'approval':
      return {
        ...b, key, kind, kicker: 'YOUR DECISION', headline: `Approve “${task.title}”?`,
        detail: `${nameOf(state, task.owner)} finished the work and sent it to you.`, why: unlockText(state, task) || 'They can’t close it until you decide.',
        blocks,
        actions: compact([advanceOffer(state, actor, now, task, 'Approve & complete'), offer(state, actor, now, 'task.send-back', { taskId: task.id }, { label: 'Send back with a note' })]),
        more: [],
      };
    case 'blocker':
    case 'help-request': {
      const helper = task.blocker?.helper ?? '';
      const mine = kind === 'blocker';
      return {
        ...b, key, kind,
        kicker: mine ? 'BLOCKED' : 'HELP REQUESTED',
        headline: mine ? `“${task.title}” is blocked` : `${firstName(state, task.blocker?.by ?? task.owner)} needs your help on “${task.title}”`,
        detail: `“${task.blocker?.note ?? 'Needs help'}”`,
        why: `${mine ? (helper ? `${nameOf(state, helper)} was asked` : 'The team was asked') : 'You were asked'} ${task.blocker ? duration(now - task.blocker.at) : ''} ago. ${unlockText(state, task)}`.trim(),
        blocks: ['blocker', ...blocks],
        actions: compact([offer(state, actor, now, 'task.resolve', { taskId: task.id }, { label: mine ? 'Blocker resolved — resume' : 'Sorted — unblock it', tone: 'primary', shortcut: 'm' })]),
        more: compact([
          mine ? offer(state, actor, now, 'task.request-help', { taskId: task.id }, { label: 'Ask someone else' }) : null,
          offer(state, actor, now, 'task.handoff', { taskId: task.id }, { label: 'Hand it to someone else' }),
        ]),
      };
    }
    case 'handoff-arrived': {
      const finished = task.dependsOn.map(id => taskById(state, id)).filter((item): item is Task => !!item).sort((x, y) => (y.completedAt ?? 0) - (x.completedAt ?? 0))[0];
      return {
        ...b, key, kind, kicker: 'HANDED TO YOU',
        headline: finished ? `${firstName(state, finished.owner, 'Someone')} finished “${finished.title}”. You’re up.` : `“${task.title}” is ready for you`,
        detail: `${task.title}${task.nextAction ? ` — ${task.nextAction}` : ''}`,
        why: finished?.completedAt ? `It was waiting on that work; it unlocked ${duration(now - finished.completedAt)} ago. ${unlockText(state, task)}`.trim() : unlockText(state, task),
        blocks, actions: compact([advanceOffer(state, actor, now, task)]), more: commonTaskOffers(state, actor, now, task),
      };
    }
    case 'handoff-ready': {
      const waiting = dependents(state, task).filter(item => item.owner && item.owner !== actor);
      const names = [...new Set(waiting.map(item => firstName(state, item.owner)))];
      return {
        ...b, key, kind, kicker: 'SOMEONE IS WAITING ON THIS',
        headline: `Finish “${task.title}” — ${names.join(' and ') || 'the next step'} ${names.length > 1 ? 'are' : 'is'} waiting on it`,
        detail: task.nextAction || task.description, why: unlockText(state, task),
        blocks, actions: compact([advanceOffer(state, actor, now, task)]), more: commonTaskOffers(state, actor, now, task),
      };
    }
    case 'waiting': {
      const dep = blockingDeps(state, task)[0];
      return {
        ...b, key, kind, kicker: 'WAITING', headline: dep ? `Waiting on ${firstName(state, dep.owner, 'someone')} to finish “${dep.title}”` : `Waiting`,
        detail: task.title, why: plan.effect, blocks, actions: [], more: compact([offer(state, actor, now, 'task.handoff', { taskId: task.id }, { label: 'Hand it to someone else' })]),
      };
    }
    case 'done': {
      const event = state.events.find(item => item.taskId === task.id && item.undo && !item.undone && /completed|approved/.test(item.text));
      return {
        ...b, key, kind, kicker: 'DONE', headline: `“${task.title}” is done`, detail: '', eventId: event?.id,
        why: dependents(state, task).length ? `It unlocked ${dependents(state, task).map(item => `“${item.title}”`).join(', ')}.` : 'Nothing was waiting on it.',
        blocks, actions: compact([event ? offer(state, actor, now, 'undo', { eventId: event.id }, { label: 'Undo completion', shortcut: 'u' }) : null]), more: [],
      };
    }
    default:
      return {
        ...b, key, kind: 'next-action', kicker: task.status === 'working' ? 'IN PROGRESS' : isOverdue(task, now) ? 'OVERDUE — NEXT UP' : 'NEXT UP',
        headline: task.title,
        detail: task.nextAction || task.description || 'No next action written yet.',
        why: plan.next === 'Nothing is waiting on this' ? plan.effect : plan.next,
        blocks, actions: compact([advanceOffer(state, actor, now, task)]), more: commonTaskOffers(state, actor, now, task),
      };
  }
}

/** Which situation a task is in from this person’s point of view (used by the task drawer). */
export function composeForTask(state: QuestState, actor: string, now: number, taskId: string, ctx: ComposeContext = {}): Situation | null {
  const task = taskById(state, taskId);
  if (!task) return null;
  if (state.focus?.taskId === task.id && inFocus(state, actor)) return taskSituation(state, actor, now, task, 'critical-focus', ctx);
  if (task.status === 'done') return taskSituation(state, actor, now, task, 'done', ctx);
  if (task.status === 'review' && (task.approver === actor || hasRole(state, actor, ['manager']))) return taskSituation(state, actor, now, task, 'approval', ctx);
  if (task.status === 'blocked') return taskSituation(state, actor, now, task, task.owner === actor || task.blocker?.helper !== actor ? 'blocker' : 'help-request', ctx);
  if (blockingDeps(state, task).length) return taskSituation(state, actor, now, task, 'waiting', ctx);
  if (task.status === 'ready' && recentlyUnlocked(state, task, now)) return taskSituation(state, actor, now, task, 'handoff-arrived', ctx);
  if (task.status === 'working' && dependents(state, task).length) return taskSituation(state, actor, now, task, 'handoff-ready', ctx);
  return taskSituation(state, actor, now, task, 'next-action', ctx);
}

function recentlyUnlocked(state: QuestState, task: Task, now: number) {
  if (!task.dependsOn.length || blockingDeps(state, task).length) return false;
  return task.dependsOn.some(id => { const dep = taskById(state, id); return !!dep?.completedAt && now - dep.completedAt <= HANDOFF_WINDOW; });
}

// ── Lead situation ─────────────────────────────────────────────────────────

export function leadSituation(state: QuestState, actor: string, now: number, lead: Lead): Situation {
  const target = state.policy.leadResponseMinutes * MINUTE;
  const elapsed = leadElapsed(lead, now);
  const subject = { leadId: lead.id };
  const contact = (label: string, outcome: string, shortcut?: string) =>
    offer(state, actor, now, 'lead.attempt', subject, { label, preset: { outcome }, tone: outcome === 'reached' && lead.assignee ? 'primary' : 'secondary', ask: [], shortcut });
  const manager = peopleWithRole(state, 'manager').find(item => item.id !== actor)?.id ?? peopleWithRole(state, 'manager')[0]?.id ?? '';
  return {
    key: `lead-response:${lead.id}`, kind: 'lead-response', leadId: lead.id,
    kicker: lead.assignee ? (elapsed > target ? 'NEW LEAD — PAST TARGET' : 'NEW LEAD') : 'NEW LEAD — NOBODY ON IT',
    headline: `${lead.name} is waiting for a first response`,
    detail: lead.need,
    why: `${lead.source} · ${lead.phone} · ${lead.address}. Respond, then log what happened — Task-HQ doesn’t call or text anyone.`,
    people: [{ role: 'Assignee', id: lead.assignee }, ...(manager ? [{ role: 'Escalates to', id: manager }] : [])],
    chain: [], downstream: [], layout: 'stack',
    blocks: ['lead-timer', 'contact', 'people', 'history'],
    timer: { startedAt: lead.arrivedAt, targetMs: target, stoppedAt: lead.firstResponseAt },
    actions: compact([
      !lead.assignee ? offer(state, actor, now, 'lead.take', subject, { label: 'I’ll take it', tone: 'primary', shortcut: 'a' }) : null,
      contact('Reached them', 'reached', 'm'), contact('No answer', 'no-answer'), contact('Left a message', 'left-message'),
    ]),
    more: compact([
      offer(state, actor, now, 'lead.assign', subject, { label: 'Assign to someone else' }),
      offer(state, actor, now, 'lead.escalate', subject, { label: 'Escalate to a manager' }),
      offer(state, actor, now, 'lead.block', subject, { label: 'Flag a blocker' }),
    ]),
    history: historyFor(state, [], lead.id),
  };
}

// ── Outcomes ───────────────────────────────────────────────────────────────

/** What just happened, composed from the real event and the state it produced. */
export function composeOutcome(state: QuestState, actor: string, now: number, eventId: string): Situation | null {
  const event = state.events.find(item => item.id === eventId);
  if (!event || event.undone) return null;
  const undo = event.undo ? offer(state, actor, now, 'undo', { eventId }, { label: 'Undo', shortcut: 'u' }) : null;
  const lead = event.leadId ? leadById(state, event.leadId) : undefined;
  const task = event.taskId ? taskById(state, event.taskId) : undefined;

  if (lead && /contact attempt/.test(event.text)) {
    const responseMs = (lead.firstResponseAt ?? now) - lead.arrivedAt;
    const targetMs = state.policy.leadResponseMinutes * MINUTE;
    const subject = { leadId: lead.id };
    return {
      key: `outcome:${eventId}`, kind: 'outcome', leadId: lead.id, eventId, kicker: 'RESPONSE LOGGED',
      headline: `First response in ${duration(responseMs)} — ${responseMs <= targetMs ? 'within' : 'over'} the ${state.policy.leadResponseMinutes}-minute target`,
      detail: `${lead.name}: ${lead.attempts.at(-1)?.outcome.replace('-', ' ') ?? 'contact'} by ${lead.attempts.at(-1)?.channel ?? 'phone'} (logged by ${firstName(state, lead.attempts.at(-1)?.by ?? actor)}).`,
      why: 'Choose what happens next for this lead.',
      people: [{ role: 'Assignee', id: lead.assignee }], chain: [], downstream: [], layout: 'stack',
      blocks: ['outcome', 'history'],
      outcome: { tone: 'response', done: lead.name, doneBy: lead.assignee, unlocked: [], responseMs, targetMs },
      actions: compact([
        offer(state, actor, now, 'lead.advance', subject, { label: presetFor(state).leadHandoffAction, tone: 'primary' }),
        offer(state, actor, now, 'lead.follow-up', subject, { label: 'Schedule a follow-up' }),
        lead.stage !== 'qualified' ? offer(state, actor, now, 'lead.qualify', subject, { label: 'Mark qualified' }) : null,
      ]),
      more: compact([offer(state, actor, now, 'lead.escalate', subject, { label: 'Escalate to a manager' }), undo]),
      history: historyFor(state, [], lead.id),
    };
  }

  const handedOn = lead && ((event.kind === 'handoff' && lead.stage === 'won') || (event.kind === 'lead' && lead.stage === 'escalated' && /escalated/.test(event.text)));
  if (lead && handedOn) {
    const next = taskById(state, lead.stage === 'won' ? lead.handoffTaskId : '') ?? state.tasks.find(item => item.leadId === lead.id && item.status !== 'done' && item.owner === lead.escalatedTo);
    return {
      key: `outcome:${eventId}`, kind: 'outcome', leadId: lead.id, eventId, kicker: lead.stage === 'won' ? 'HANDED ON' : 'ESCALATED',
      headline: next ? `${lead.name} is with ${nameOf(state, next.owner)} now` : `${lead.name} handed on`,
      detail: next ? `“${next.title}” is in ${firstName(state, next.owner)}’s My Work.` : '', why: '',
      people: next ? [{ role: 'Next owner', id: next.owner }] : [], chain: [], downstream: [], layout: 'track',
      blocks: ['outcome', 'history'],
      outcome: { tone: 'handed-on', done: lead.name, doneBy: lead.assignee, unlocked: next ? [{ taskId: next.id, title: next.title, owner: next.owner }] : [] },
      actions: compact([undo]), more: [], history: historyFor(state, next ? [next.id] : [], lead.id),
    };
  }

  if (task && task.status === 'done' && /completed|approved/.test(event.text)) {
    const unlocked = state.tasks.filter(item => item.dependsOn.includes(task.id) && item.status !== 'done' && blockingDeps(state, item).length === 0)
      .map(item => ({ taskId: item.id, title: item.title, owner: item.owner }));
    const { chain, downstream } = chainFor(state, task, 'wide');
    const owners = [...new Set(unlocked.map(item => item.owner).filter(Boolean))];
    return {
      key: `outcome:${eventId}`, kind: 'outcome', taskId: task.id, eventId,
      kicker: unlocked.length ? 'HANDOFF' : 'DONE',
      headline: unlocked.length ? `Handed to ${owners.map(id => firstName(state, id)).join(' and ') || 'the next step'}` : `“${task.title}” is done`,
      detail: unlocked.length ? `“${task.title}” is done. ${unlocked.map(item => `“${item.title}” is ready for ${nameOf(state, item.owner, 'nobody yet')}`).join('; ')}.` : task.nextOwner ? `Next step: ${nameOf(state, task.nextOwner)}.` : 'Nothing was waiting on it.',
      why: unlocked.length ? `${owners.map(id => firstName(state, id)).join(' and ')} will see it as the next thing to do.` : '',
      people: unlocked.filter(item => item.owner).map(item => ({ role: 'Now up', id: item.owner })), chain, downstream, layout: 'track',
      blocks: ['outcome', 'history'],
      outcome: { tone: unlocked.length ? 'handoff' : 'done', done: task.title, doneBy: task.owner, unlocked },
      actions: compact([undo]), more: [], history: historyFor(state, [task.id, ...unlocked.map(item => item.taskId)]),
    };
  }
  return null;
}

// ── Ranking ────────────────────────────────────────────────────────────────

/** Every situation this person is in, most important first. */
export function situationsFor(state: QuestState, actor: string, now: number, ctx: ComposeContext = {}): Situation[] {
  const focusTask = state.focus && inFocus(state, actor) ? taskById(state, state.focus.taskId) : undefined;
  if (focusTask) return [taskSituation(state, actor, now, focusTask, 'critical-focus', ctx)];
  const order = compareTasks(now);
  const open = state.tasks.filter(task => task.status !== 'done').sort(order);
  const out: Situation[] = [];
  const used = new Set<string>();
  const push = (situation: Situation) => {
    const id = situation.taskId ?? situation.leadId ?? situation.key;
    if (used.has(id)) return;
    used.add(id);
    out.push(situation);
  };
  const isSales = hasRole(state, actor, ['sales', 'manager']);
  state.leads
    .filter(lead => !lead.firstResponseAt && lead.stage !== 'lost' && lead.stage !== 'won' && (lead.assignee === actor || (!lead.assignee && isSales)))
    .sort((a, b) => a.arrivedAt - b.arrivedAt)
    .forEach(lead => push(leadSituation(state, actor, now, lead)));
  open.filter(task => task.status === 'review' && task.approver === actor).forEach(task => push(taskSituation(state, actor, now, task, 'approval', ctx)));
  open.filter(task => task.status === 'blocked' && task.owner === actor).forEach(task => push(taskSituation(state, actor, now, task, 'blocker', ctx)));
  open.filter(task => task.owner === actor && task.status === 'ready' && recentlyUnlocked(state, task, now)).forEach(task => push(taskSituation(state, actor, now, task, 'handoff-arrived', ctx)));
  open.filter(task => task.owner === actor && task.status === 'working' && dependents(state, task).some(item => item.owner && item.owner !== actor)).forEach(task => push(taskSituation(state, actor, now, task, 'handoff-ready', ctx)));
  open.filter(task => task.status === 'blocked' && task.blocker?.helper === actor && task.owner !== actor).forEach(task => push(taskSituation(state, actor, now, task, 'help-request', ctx)));
  const next = nextActionable(state, actor, now);
  if (next) push(taskSituation(state, actor, now, next, 'next-action', ctx));
  open.filter(task => task.owner === actor && blockingDeps(state, task).length === 0 && task.status !== 'review').forEach(task => push(taskSituation(state, actor, now, task, 'next-action', ctx)));
  return out;
}

export function clearSituation(state: QuestState, actor: string): Situation {
  return {
    key: 'clear', kind: 'clear', kicker: 'ALL CLEAR', headline: `Nothing is waiting on you, ${firstName(state, actor)}.`,
    detail: 'Pick something up from Company Work, or add a task below.', why: '', people: [], chain: [], downstream: [],
    blocks: [], actions: [], more: [], history: [], layout: 'stack',
  };
}

/** The primary situation plus the rest of the queue. */
export function compose(state: QuestState, actor: string, now: number, ctx: ComposeContext = {}): { primary: Situation; queue: Situation[] } {
  const all = situationsFor(state, actor, now, ctx);
  const outcome = ctx.justDid && !inFocus(state, actor) ? composeOutcome(state, actor, now, ctx.justDid) : null;
  if (outcome) return { primary: outcome, queue: all };
  const chosen = (ctx.select && all.find(item => item.key === ctx.select)) || all[0] || clearSituation(state, actor);
  return { primary: chosen, queue: all.filter(item => item.key !== chosen.key) };
}
