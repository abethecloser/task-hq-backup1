// All Tasks: one permission-scoped registry over state.tasks. Lenses (All, Mine,
// Team, Needs Attention, Completed) are views of the same records, never copies,
// so a change made anywhere appears in every lens at once.
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { insights } from './rules.ts';
import { blockingDeps, compareTasks, isOpen, isOverdue, nameOf, projectName } from './selectors.ts';
import { addDays, localDate } from './time.ts';

export type Lens = 'all' | 'mine' | 'team' | 'attention' | 'completed';
export const LENS_LABELS: Record<Lens, string> = { all: 'All Tasks', mine: 'My Tasks', team: 'Team Tasks', attention: 'Needs Attention', completed: 'Completed' };
export const LENS_HINTS: Record<Lens, string> = {
  all: 'Every open task in the workspace.',
  mine: 'Work you own, plus approvals waiting on you.',
  team: 'Work owned by someone else — what is moving without you.',
  attention: 'Blocked, overdue, unowned or stalled work.',
  completed: 'Finished work, most recent first.',
};

export type StatusFilter = TaskStatus | 'open' | 'any';
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';
export type PriorityFilter = 'any' | 'high' | 'normal' | 'ultra';
export type SortKey = 'urgency' | 'due' | 'updated' | 'title' | 'owner';
export const SORT_LABELS: Record<SortKey, string> = { urgency: 'Urgency', due: 'Due date', updated: 'Recently updated', title: 'Name', owner: 'Owner' };

export interface RegistryQuery {
  lens: Lens;
  search: string;
  status: StatusFilter;
  /** Person id, '' for any, 'none' for unowned. */
  owner: string;
  /** Project id, '' for any, 'none' for no project. */
  project: string;
  due: DueFilter;
  priority: PriorityFilter;
  sort: SortKey;
}

export const DEFAULT_QUERY: RegistryQuery = { lens: 'all', search: '', status: 'open', owner: '', project: '', due: 'any', priority: 'any', sort: 'urgency' };

/** Task ids flagged by the shared attention rules (the same ones Needs Attention uses). */
export function attentionIds(state: QuestState, now: number): Set<string> {
  return new Set(insights(state, now).map(item => item.taskId).filter((id): id is string => !!id));
}

export function inLens(state: QuestState, task: Task, actor: string, lens: Lens, flagged: Set<string>): boolean {
  switch (lens) {
    case 'all': return true;
    case 'mine': return task.owner === actor || (task.status === 'review' && task.approver === actor);
    case 'team': return !!task.owner && task.owner !== actor;
    case 'attention': return isOpen(task) && flagged.has(task.id);
    case 'completed': return task.status === 'done';
  }
}

function statusMatch(task: Task, status: StatusFilter, lens: Lens) {
  if (lens === 'completed') return task.status === 'done';
  if (status === 'any') return true;
  if (status === 'open') return isOpen(task);
  return task.status === status;
}

function dueMatch(task: Task, due: DueFilter, now: number) {
  const today = localDate(now);
  switch (due) {
    case 'any': return true;
    case 'none': return !task.due;
    case 'overdue': return isOverdue(task, now);
    case 'today': return task.due === today;
    case 'week': return !!task.due && task.due >= today && task.due <= addDays(now, 7);
  }
}

/** Case-insensitive match on title, next action, notes, blocker, people, project and outside dependency. */
export function matchesSearch(state: QuestState, task: Task, search: string) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [
    task.title, task.nextAction, task.description, task.waitingOn, task.blocker?.note ?? '',
    nameOf(state, task.owner, ''), nameOf(state, task.approver, ''), nameOf(state, task.nextOwner, ''), projectName(state, task.projectId),
  ].join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function sorter(state: QuestState, now: number, sort: SortKey, lens: Lens) {
  const urgency = compareTasks(now);
  if (lens === 'completed' && sort === 'urgency') return (a: Task, b: Task) => (b.completedAt ?? 0) - (a.completedAt ?? 0);
  switch (sort) {
    case 'urgency': return (a: Task, b: Task) => Number(a.status === 'done') - Number(b.status === 'done') || urgency(a, b);
    case 'due': return (a: Task, b: Task) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || urgency(a, b);
    case 'updated': return (a: Task, b: Task) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    case 'title': return (a: Task, b: Task) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    case 'owner': return (a: Task, b: Task) => nameOf(state, a.owner, '~').localeCompare(nameOf(state, b.owner, '~')) || urgency(a, b);
  }
}

export function queryTasks(state: QuestState, actor: string, now: number, query: RegistryQuery): Task[] {
  const flagged = attentionIds(state, now);
  return state.tasks
    .filter(task => inLens(state, task, actor, query.lens, flagged))
    .filter(task => statusMatch(task, query.status, query.lens))
    .filter(task => !query.owner || (query.owner === 'none' ? !task.owner : task.owner === query.owner))
    .filter(task => !query.project || (query.project === 'none' ? !task.projectId : task.projectId === query.project))
    .filter(task => dueMatch(task, query.due, now))
    .filter(task => query.priority === 'any' || (query.priority === 'ultra' ? task.ultra : task.priority === query.priority))
    .filter(task => matchesSearch(state, task, query.search))
    .sort(sorter(state, now, query.sort, query.lens));
}

/** Open-work counts per lens (Completed counts finished work). */
export function lensCounts(state: QuestState, actor: string, now: number): Record<Lens, number> {
  const flagged = attentionIds(state, now);
  const count = (lens: Lens) => state.tasks.filter(task => inLens(state, task, actor, lens, flagged) && (lens === 'completed' || isOpen(task))).length;
  return { all: count('all'), mine: count('mine'), team: count('team'), attention: count('attention'), completed: count('completed') };
}

export const BOARD_ORDER: TaskStatus[] = ['ready', 'working', 'blocked', 'review', 'done'];

/** Board columns are a grouping only; work moves through Move Work Forward, never by drag. */
export function boardColumns(tasks: Task[]): { status: TaskStatus; tasks: Task[] }[] {
  return BOARD_ORDER.map(status => ({ status, tasks: tasks.filter(task => task.status === status) }));
}

/** Short, factual flags for a registry row. */
export function rowFlags(state: QuestState, task: Task, now: number): { overdue: boolean; blocked: boolean; waiting: boolean; unowned: boolean } {
  return { overdue: isOverdue(task, now), blocked: task.status === 'blocked', waiting: isOpen(task) && blockingDeps(state, task).length > 0, unowned: isOpen(task) && !task.owner };
}
