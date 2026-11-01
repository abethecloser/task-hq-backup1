// Read-only views over QuestState shared by the app, popup and background worker.
import type { AccessGrant, Action, Lead, Person, QuestState, Role, Section, Task } from './contract.ts';
import { STATUS_LABELS } from './contract.ts';
import { MINUTE, localDate } from './time.ts';

export function person(state: QuestState, id: string): Person | undefined {
  return state.people.find(item => item.id === id);
}

export function nameOf(state: QuestState, id: string, empty = 'Unassigned') {
  return person(state, id)?.name ?? empty;
}

export function firstName(state: QuestState, id: string, empty = 'Unassigned') {
  return nameOf(state, id, empty).split(' ')[0]!;
}

export function hasRole(state: QuestState, id: string, roles: Role[]) {
  const role = person(state, id)?.role;
  return !!role && roles.includes(role);
}

// ── Authority ──────────────────────────────────────────────────────────────
// Live workspaces: authority comes only from organization membership (Person.authority, rebuilt by
// the server from memberships on every call). Owner and Admin manage; Supervisor coordinates;
// Member works on their own tasks; Reviewer (Developer / Observer) only leaves feedback.
// Work roles (manager, coordinator, field, sales, estimator) only route work.
// The local demo has no memberships, so its work roles stand in exactly as before.
export const manages = (p: Person | undefined) => (p?.authority ? p.authority === 'owner' || p.authority === 'admin' : p?.role === 'manager');
export const coordinates = (p: Person | undefined) => manages(p) || (p?.authority ? p.authority === 'supervisor' : p?.role === 'coordinator');
export const owns = (p: Person | undefined) => (p?.authority ? p.authority === 'owner' : p?.role === 'manager');
export const observes = (p: Person | undefined) => p?.role === 'reviewer' || p?.authority === 'reviewer';
/** The role token a policy role list (ultraActivators, ultraApprovers) is matched against. */
export const actsAs = (p: Person | undefined): Role | 'member' | undefined => (p?.authority ? (manages(p) ? 'manager' : coordinates(p) ? 'coordinator' : p.authority === 'reviewer' ? 'reviewer' : 'member') : p?.role);
export const allowedBy = (p: Person | undefined, roles: Role[]) => { const token = actsAs(p); return !!token && (roles as string[]).includes(token); };

export function peopleWithRole(state: QuestState, role: Role) {
  return state.people.filter(item => item.role === role);
}

export function taskById(state: QuestState, id: string) {
  return state.tasks.find(task => task.id === id);
}

export function leadById(state: QuestState, id: string) {
  return state.leads.find(lead => lead.id === id);
}

export function projectName(state: QuestState, id: string) {
  return state.projects.find(project => project.id === id)?.name ?? '';
}

/** Active work: not done, and not archived as legacy (archived unfinished work keeps its status). */
export const isOpen = (task: Task) => task.status !== 'done' && !task.archivedAt;
/** Archived without being completed. */
export const isLegacyArchived = (task: Task) => task.status !== 'done' && !!task.archivedAt;
/** Projects in active navigation and pickers: archived projects are left out (they stay in state). */
export const activeProjects = (state: QuestState) => state.projects.filter(project => !project.archivedAt);
export const isProjectArchived = (state: QuestState, id: string) => !!state.projects.find(project => project.id === id)?.archivedAt;
/** The workspace as active views read it: work archived as legacy left out (it keeps its status). */
export const withoutLegacyArchived = (state: QuestState): QuestState =>
  state.tasks.some(isLegacyArchived) ? { ...state, tasks: state.tasks.filter(task => !isLegacyArchived(task)) } : state;

export function isOverdue(task: Task, now: number) {
  return isOpen(task) && task.due !== '' && task.due < localDate(now);
}

export function blockingDeps(state: QuestState, task: Task) {
  return task.dependsOn.map(id => taskById(state, id)).filter((dep): dep is Task => !!dep && isOpen(dep));
}

export function dependents(state: QuestState, task: Task) {
  return state.tasks.filter(item => item.dependsOn.includes(task.id) && isOpen(item));
}

export function isStalled(state: QuestState, task: Task, now: number) {
  return (task.status === 'working' || task.status === 'ready') && now - task.lastActivityAt > state.policy.stalledHours * 60 * MINUTE;
}

/** Operational order: Ultra first, then overdue, blocked, high priority, earliest due, oldest. */
export function compareTasks(now: number) {
  return (a: Task, b: Task) =>
    Number(b.ultra) - Number(a.ultra)
    || Number(isOverdue(b, now)) - Number(isOverdue(a, now))
    || Number(b.status === 'blocked') - Number(a.status === 'blocked')
    || Number(b.priority === 'high') - Number(a.priority === 'high')
    || (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99')
    || a.createdAt - b.createdAt;
}

export function myTasks(state: QuestState, actor: string, now: number) {
  return state.tasks.filter(task => isOpen(task) && (task.owner === actor || (task.status === 'review' && task.approver === actor))).sort(compareTasks(now));
}

/** The one task this person can act on right now. */
export function nextActionable(state: QuestState, actor: string, now: number): Task | undefined {
  if (state.focus?.employee === actor) return taskById(state, state.focus.taskId);
  const mine = myTasks(state, actor, now).filter(task => blockingDeps(state, task).length === 0 && moveForwardPlan(state, task, actor).canAct);
  return mine.find(task => task.status === 'review' && task.approver === actor)
    ?? mine.find(task => task.status === 'working')
    ?? mine[0];
}

export interface MoveForwardPlan {
  canAct: boolean;
  label: string;
  /** Where the work is now. */
  current: string;
  /** What happens when the button is pressed. */
  effect: string;
  /** What becomes available next and who it goes to. */
  next: string;
  nextWho: string[];
}

/** Everything the Move Work Forward control needs to show: now → action → next. */
export function moveForwardPlan(state: QuestState, task: Task, actor: string): MoveForwardPlan {
  const deps = blockingDeps(state, task);
  const unlocks = dependents(state, task).filter(item => item.dependsOn.every(id => id === task.id || taskById(state, id)?.status === 'done'));
  const nextWho = [...new Set(unlocks.map(item => item.owner || task.nextOwner).filter(Boolean))];
  if (task.nextOwner && !nextWho.includes(task.nextOwner)) nextWho.push(task.nextOwner);
  const nextText = unlocks.length
    ? `Unlocks ${unlocks.map(item => `“${item.title}” for ${firstName(state, item.owner || task.nextOwner, 'nobody yet')}`).join(', ')}`
    : task.nextOwner ? `Hands off to ${nameOf(state, task.nextOwner)}` : 'Nothing is waiting on this';
  const isManagerish = coordinates(person(state, actor));
  const mayMove = task.owner === actor || isManagerish;

  if (task.status === 'done') return { canAct: false, label: 'Done', current: 'Completed', effect: '', next: nextText, nextWho };
  if (deps.length) {
    const dep = deps[0]!;
    return { canAct: false, label: `Waiting on ${firstName(state, dep.owner, 'someone')}`, current: `Waiting on “${dep.title}”`, effect: `Starts once ${nameOf(state, dep.owner, 'its owner')} finishes it`, next: nextText, nextWho };
  }
  if (!task.owner) return { canAct: true, label: 'I’ll take it', current: 'Nobody owns this yet', effect: 'You become the owner', next: 'Then start the work', nextWho: [actor] };
  if (task.status === 'ready') return { canAct: mayMove, label: 'Start work', current: `${firstName(state, task.owner)} has it, not started`, effect: 'Marks it Working so the team can see it moving', next: task.approver ? `Then goes to ${firstName(state, task.approver)} for approval` : nextText, nextWho };
  if (task.status === 'blocked') {
    const helper = task.blocker?.helper;
    return { canAct: mayMove || actor === helper, label: 'Blocker resolved · resume', current: `Blocked: ${task.blocker?.note ?? 'needs help'}`, effect: 'Clears the blocker and puts it back to Working', next: helper ? `${firstName(state, helper)} was asked to help` : 'Anyone on the team can help', nextWho: helper ? [helper] : [] };
  }
  if (task.status === 'working') {
    if (task.approver) return { canAct: mayMove, label: `Send to ${firstName(state, task.approver)} for approval`, current: `${firstName(state, task.owner)} is working on it`, effect: `${nameOf(state, task.approver)} reviews and approves`, next: nextText, nextWho: [task.approver] };
    return { canAct: mayMove, label: 'Complete', current: `${firstName(state, task.owner)} is working on it`, effect: 'Marks it Done', next: nextText, nextWho };
  }
  // review
  const mayApprove = actor === task.approver || manages(person(state, actor));
  return {
    canAct: mayApprove,
    label: mayApprove ? 'Approve & complete' : `Waiting on ${firstName(state, task.approver, 'approver')}`,
    current: `In review with ${nameOf(state, task.approver, 'an approver')}`,
    effect: mayApprove ? 'Approves the work and marks it Done' : 'Only the approver can complete this',
    next: nextText,
    nextWho,
  };
}

export function statusText(task: Task) {
  return STATUS_LABELS[task.status];
}

// ── Ultra Priority ─────────────────────────────────────────────────────────

export function activeGrant(state: QuestState, actor: string, now: number): AccessGrant | undefined {
  return state.grants.find(grant => grant.requester === actor && grant.status === 'approved' && (grant.expiresAt ?? 0) > now);
}

export function pendingGrant(state: QuestState, actor: string) {
  return state.grants.find(grant => grant.requester === actor && grant.status === 'pending');
}

export function inFocus(state: QuestState, actor: string) {
  return state.focus?.employee === actor;
}

/** Whether this person may enter an app section right now. */
export function canEnter(state: QuestState, actor: string, section: Section | 'my-work', now: number) {
  if (!inFocus(state, actor) || section === 'my-work') return true;
  return activeGrant(state, actor, now)?.section === section;
}

/** The section an action belongs to, for Ultra Priority gating. null = always allowed. */
export function sectionFor(state: QuestState, action: Action): Section | null | 'never' {
  const focusTask = state.focus?.taskId;
  switch (action.type) {
    case 'grant/request': case 'grant/return': case 'undo': case 'demo/reset':
    case 'feedback/create': case 'feedback/reply': case 'feedback/attach': case 'feedback/status':
      return null; // feedback stays possible during Critical Focus
    case 'task/create':
      return 'create-task';
    case 'task/comment': case 'task/update': case 'task/advance': case 'task/request-help': case 'task/resolve': case 'task/send-back': case 'task/handoff': case 'task/reopen': case 'task/archive': case 'task/unarchive':
      return action.id === focusTask ? null : 'company-work';
    case 'lead/claim': case 'lead/tags': case 'lead/receive': case 'lead/assign': case 'lead/attempt': case 'lead/qualify': case 'lead/block':
    case 'lead/follow-up': case 'lead/advance': case 'lead/escalate':
      return 'leads';
    default:
      return 'never';
  }
}

export function canDecideGrants(state: QuestState, actor: string) {
  if (!allowedBy(person(state, actor), state.policy.ultraApprovers)) return false;
  if (state.policy.ultraScope === 'company-wide' || !state.focus) return true;
  return state.focus.activatedBy === actor;
}

// ── Speed to Lead ──────────────────────────────────────────────────────────

export function leadElapsed(lead: Lead, now: number) {
  return (lead.firstResponseAt ?? now) - lead.arrivedAt;
}

export function leadOverTarget(state: QuestState, lead: Lead, now: number) {
  return leadElapsed(lead, now) > state.policy.leadResponseMinutes * MINUTE;
}

export type LeadBucket = 'waiting' | 'responded' | 'attention';

export function leadBucket(state: QuestState, lead: Lead, now: number): LeadBucket {
  if (lead.stage === 'blocked' || lead.stage === 'escalated') return 'attention';
  if (!lead.firstResponseAt) return !lead.assignee || leadOverTarget(state, lead, now) ? 'attention' : 'waiting';
  return 'responded';
}

export function activeLeads(state: QuestState) {
  return state.leads.filter(lead => lead.stage !== 'lost').sort((a, b) => b.arrivedAt - a.arrivedAt);
}
