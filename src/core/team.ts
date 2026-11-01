// Team overview: each workspace member's operational state, derived only from records that already
// exist — people, task ownership/approval/hand-off fields, completions and the event log. Nothing is
// stored here and no capacity or workload score is invented: every figure is a count of real tasks.
import type { Person, QuestEvent, QuestState, Task } from './contract.ts';
import { blockingDeps, compareTasks, isOpen, isOverdue, nextActionable } from './selectors.ts';
import { DAY, localDate } from './time.ts';

/** A member counts as active with open work or anything recorded in this many days. */
export const ACTIVE_DAYS = 14;
/** "Completed" on the card counts the last 30 days; "Due soon" the next 7. */
export const COMPLETED_DAYS = 30;
export const DUE_SOON_DAYS = 7;

export type TeamFilter = 'active' | 'all' | 'attention' | 'inactive';
export type AttentionReason = 'Overdue' | 'Blocked' | 'Waiting on a dependency' | 'Waiting on an outside party' | 'Awaiting their review' | 'Asked to help';

export interface AttentionItem { task: Task; reason: AttentionReason }
export interface MemberSummary {
  person: Person;
  active: boolean;
  /** Open tasks they own. */
  open: number;
  completed: number;
  /** Open tasks they own due within DUE_SOON_DAYS (overdue counted separately). */
  dueSoon: number;
  overdue: number;
  /** Their open tasks by stage (real counts, shown as a stage bar). */
  stages: { working: number; review: number; blocked: number; ready: number };
  lastCompleted: Task | null;
  nextUp: Task | null;
  lastActivityAt: number | null;
  attention: AttentionItem[];
}

const owned = (state: QuestState, id: string) => state.tasks.filter(task => task.owner === id && isOpen(task));
const completedBy = (task: Task) => task.completedBy ?? task.owner;

/** Who may see the management overview. Initially one person: Abraham, as an owner or admin (authority
 * is set by the server from membership, so a name alone never grants it). An explicit allowlist of
 * account ids, when configured, replaces the name rule. The demo's local Abraham persona may preview it. */
export function canSeeTeamOverview(state: QuestState, actor: string, options: { allow?: string[]; demo: boolean }): boolean {
  if (options.allow && options.allow.length) return options.allow.includes(actor);
  const me = state.people.find(item => item.id === actor);
  if (!me || me.name.trim().split(/\s+/)[0]!.toLowerCase() !== 'abraham') return false;
  if (me.authority) return me.authority === 'owner' || me.authority === 'admin';
  return options.demo;
}

export function attentionFor(state: QuestState, id: string, now: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const task of owned(state, id).sort(compareTasks(now))) {
    if (isOverdue(task, now)) out.push({ task, reason: 'Overdue' });
    else if (task.status === 'blocked' || task.blocker) out.push({ task, reason: 'Blocked' });
    else if (blockingDeps(state, task).length) out.push({ task, reason: 'Waiting on a dependency' });
    else if (task.waitingOn.trim()) out.push({ task, reason: 'Waiting on an outside party' });
  }
  // Outstanding responses: work handed to them to approve, or someone's blocker they were asked to help with.
  for (const task of state.tasks.filter(item => isOpen(item) && item.owner !== id)) {
    if (task.status === 'review' && task.approver === id) out.push({ task, reason: 'Awaiting their review' });
    else if (task.blocker?.helper === id) out.push({ task, reason: 'Asked to help' });
  }
  return out;
}

export function memberSummary(state: QuestState, person: Person, now: number): MemberSummary {
  const mine = owned(state, person.id);
  const today = localDate(now), soon = localDate(now + DUE_SOON_DAYS * DAY);
  const done = state.tasks.filter(task => task.status === 'done' && completedBy(task) === person.id && task.completedAt)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const events = state.events.filter(event => event.actor === person.id && !event.undone);
  const lastActivityAt = Math.max(0, ...events.map(event => event.at), ...done.map(task => task.completedAt!)) || null;
  const stages = { working: 0, review: 0, blocked: 0, ready: 0 };
  for (const task of mine) stages[task.status as keyof typeof stages] += 1;
  const queue = [...mine].sort(compareTasks(now));
  return {
    person,
    active: mine.length > 0 || (lastActivityAt != null && now - lastActivityAt <= ACTIVE_DAYS * DAY),
    open: mine.length,
    completed: done.filter(task => now - task.completedAt! <= COMPLETED_DAYS * DAY).length,
    dueSoon: mine.filter(task => task.due && task.due >= today && task.due <= soon).length,
    overdue: mine.filter(task => isOverdue(task, now)).length,
    stages,
    lastCompleted: done[0] ?? null,
    nextUp: nextActionable(state, person.id, now) ?? queue[0] ?? null,
    lastActivityAt,
    attention: attentionFor(state, person.id, now),
  };
}

/** Everyone in the workspace, most in need of attention first, then by name. */
export function teamOverview(state: QuestState, now: number): MemberSummary[] {
  return state.people.map(person => memberSummary(state, person, now))
    .sort((a, b) => Number(b.attention.length > 0) - Number(a.attention.length > 0) || Number(b.active) - Number(a.active) || a.person.name.localeCompare(b.person.name));
}

export function filterTeam(members: MemberSummary[], filter: TeamFilter) {
  return members.filter(member => filter === 'all' || (filter === 'active' ? member.active : filter === 'inactive' ? !member.active : member.attention.length > 0));
}
export function teamCounts(members: MemberSummary[]): Record<TeamFilter, number> {
  return { active: filterTeam(members, 'active').length, all: members.length, attention: filterTeam(members, 'attention').length, inactive: filterTeam(members, 'inactive').length };
}

/** Their recorded history, newest first: their own events plus completions credited to them. */
export function memberActivity(state: QuestState, id: string, limit = 40): { at: number; text: string; taskId?: string; kind: QuestEvent['kind'] | 'done' }[] {
  const events = state.events.filter(event => event.actor === id && !event.undone).map(event => ({ at: event.at, text: event.text, taskId: event.taskId, kind: event.kind as QuestEvent['kind'] | 'done' }));
  const logged = new Set(events.filter(event => event.taskId && /complet|finish|done/i.test(event.text)).map(event => event.taskId));
  const completions = state.tasks.filter(task => task.status === 'done' && task.completedAt && completedBy(task) === id && !logged.has(task.id))
    .map(task => ({ at: task.completedAt!, text: `Completed “${task.title}”`, taskId: task.id, kind: 'done' as const }));
  return [...events, ...completions].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Current assignments grouped by project (tasks they own, plus work waiting on their approval). */
export function memberWork(state: QuestState, id: string, now: number): { projectId: string; tasks: Task[] }[] {
  const tasks = state.tasks.filter(task => isOpen(task) && (task.owner === id || (task.status === 'review' && task.approver === id))).sort(compareTasks(now));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) groups.set(task.projectId, [...(groups.get(task.projectId) ?? []), task]);
  return [...groups].map(([projectId, items]) => ({ projectId, tasks: items }));
}

/** Next commitments: dated open work in date order, then hand-offs that come to them when someone else finishes. */
export function memberUpcoming(state: QuestState, id: string, now: number): { dated: Task[]; incoming: Task[] } {
  const dated = owned(state, id).filter(task => task.due).sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || compareTasks(now)(a, b));
  const incoming = state.tasks.filter(task => isOpen(task) && task.nextOwner === id && task.owner !== id).sort(compareTasks(now));
  return { dated, incoming };
}
