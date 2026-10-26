// All Tasks: one permission-scoped registry over state.tasks. Two independent choices
// shape the list: the scope (My work or Company) says whose tasks, and the lens
// (All tasks, Urgent, Today, Overdue, Watching) says which of them. Both are views of
// the same records, never copies, so a change made anywhere appears everywhere at once.
// Finished work is reached through the status filter (Done).
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { companiesOf, workspaceCompanies } from './companies.ts';
import type { CompanyId } from './companies.ts';
import { insights } from './rules.ts';
import { blockingDeps, compareTasks, isOpen, isOverdue, nameOf, projectName } from './selectors.ts';
import { addDays, localDate } from './time.ts';

export type Scope = 'mine' | 'company';
export const SCOPE_LABELS: Record<Scope, string> = { mine: 'My work', company: 'Company' };
export type Lens = 'all' | 'urgent' | 'today' | 'overdue' | 'watching';
export const LENSES: Lens[] = ['all', 'urgent', 'today', 'overdue', 'watching'];
export const LENS_LABELS: Record<Lens, string> = { all: 'All tasks', urgent: 'Urgent', today: 'Today', overdue: 'Overdue', watching: 'Watching' };
export const LENS_HINTS: Record<Lens, string> = {
  all: 'Every task, narrowed by the filters below.',
  urgent: 'Ultra Priority and high-priority work.',
  today: 'Due today.',
  overdue: 'Past its due date and still open.',
  watching: 'Work you follow but don’t own.',
};
/** Older saved filters and links used other lens names; map them onto scope + lens. */
export const LEGACY_LENSES: Record<string, Partial<RegistryQuery>> = {
  mine: { scope: 'mine', lens: 'all' }, team: { scope: 'company', lens: 'all' }, attention: { lens: 'all' }, completed: { lens: 'all', status: 'done', sort: 'urgency' },
};

export type StatusFilter = TaskStatus | 'open' | 'any' | 'archived';
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none';
export type PriorityFilter = 'any' | 'high' | 'normal' | 'ultra';
/** Status, due and priority take one value or several; several match when any of them does. An empty list means any. */
export type Multi<T> = T | T[];
export const asList = <T>(value: Multi<T>): T[] => (Array.isArray(value) ? value : [value]);
export type SortKey = 'urgency' | 'due' | 'updated' | 'title' | 'owner';
export const SORT_LABELS: Record<SortKey, string> = { urgency: 'Urgency', due: 'Due date', updated: 'Recently updated', title: 'Name', owner: 'Owner' };

export interface RegistryQuery {
  scope: Scope;
  lens: Lens;
  search: string;
  status: Multi<StatusFilter>;
  /** Person id, '' for any, 'none' for unowned. */
  owner: string;
  /** Project id, '' for any, 'none' for no project. */
  project: string;
  /** Company (Roofing, Drafting, Lumen), '' for any. Inferred from workspace, job, tags and type. */
  company: CompanyId | '';
  due: Multi<DueFilter>;
  priority: Multi<PriorityFilter>;
  sort: SortKey;
}

export const DEFAULT_QUERY: RegistryQuery = { scope: 'company', lens: 'all', search: '', status: 'open', owner: '', project: '', company: '', due: 'any', priority: 'any', sort: 'urgency' };

/** The existing Done filter, exposed as a named navigation destination. */
export function isCompletedQuery(query: RegistryQuery): boolean {
  return query.lens === 'all' && asList(query.status).length === 1 && asList(query.status)[0] === 'done';
}
export function completedQuery(scope: Scope): RegistryQuery {
  return { ...DEFAULT_QUERY, scope, status: 'done' };
}

/** Task ids flagged by the shared attention rules (the same ones Needs Attention uses). */
export function attentionIds(state: QuestState, now: number): Set<string> {
  return new Set(insights(state, now).map(item => item.taskId).filter((id): id is string => !!id));
}

/** My work: tasks you own, plus reviews waiting on your approval. Company: everything. */
export function inScope(task: Task, actor: string, scope: Scope): boolean {
  return scope === 'company' || task.owner === actor || (task.status === 'review' && task.approver === actor);
}

/** Watching is personal: it ignores the scope and lists work you watch without owning. */
export function inLens(task: Task, actor: string, lens: Lens, now: number): boolean {
  switch (lens) {
    case 'all': return true;
    case 'urgent': return task.ultra || task.priority === 'high';
    case 'today': return task.due === localDate(now);
    case 'overdue': return isOverdue(task, now);
    case 'watching': return task.watchers.includes(actor) && task.owner !== actor;
  }
}

const inView = (task: Task, actor: string, scope: Scope, lens: Lens, now: number) => (lens === 'watching' || inScope(task, actor, scope)) && inLens(task, actor, lens, now);

function statusMatch(task: Task, status: Multi<StatusFilter>) {
  const wanted = asList(status);
  // Archived work leaves every list except the explicit Archived one; its history stays on the task.
  if (task.archivedAt) return wanted.includes('archived');
  return !wanted.length || wanted.some(value => value === 'any' || (value === 'open' ? isOpen(task) : task.status === value));
}

function priorityMatch(task: Task, priority: Multi<PriorityFilter>) {
  const wanted = asList(priority);
  return !wanted.length || wanted.some(value => value === 'any' || (value === 'ultra' ? task.ultra : task.priority === value));
}

function dueMatch(task: Task, due: Multi<DueFilter>, now: number) {
  const wanted = asList(due);
  return !wanted.length || wanted.some(value => dueIs(task, value, now));
}

function dueIs(task: Task, due: DueFilter, now: number) {
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
    ...(task.tags ?? []).map(tag => `#${tag}`), task.type ? state.taxonomy?.types.find(item => item.id === task.type)?.label ?? task.type : '',
  ].join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function sorter(state: QuestState, now: number, sort: SortKey, status: Multi<StatusFilter>) {
  const urgency = compareTasks(now);
  const onlyDone = asList(status).length === 1 && asList(status)[0] === 'done';
  if (onlyDone && sort === 'urgency') return (a: Task, b: Task) => (b.completedAt ?? 0) - (a.completedAt ?? 0);
  switch (sort) {
    case 'urgency': return (a: Task, b: Task) => Number(a.status === 'done') - Number(b.status === 'done') || urgency(a, b);
    case 'due': return (a: Task, b: Task) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || urgency(a, b);
    case 'updated': return (a: Task, b: Task) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    case 'title': return (a: Task, b: Task) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    case 'owner': return (a: Task, b: Task) => nameOf(state, a.owner, '~').localeCompare(nameOf(state, b.owner, '~')) || urgency(a, b);
  }
}

export function queryTasks(state: QuestState, actor: string, now: number, query: RegistryQuery): Task[] {
  const inWorkspace = workspaceCompanies(state);
  return state.tasks
    .filter(task => !query.company || companiesOf(state, task, inWorkspace).has(query.company))
    .filter(task => inView(task, actor, query.scope, query.lens, now))
    .filter(task => statusMatch(task, query.status))
    .filter(task => !query.owner || (query.owner === 'none' ? !task.owner : task.owner === query.owner))
    .filter(task => !query.project || (query.project === 'none' ? !task.projectId : task.projectId === query.project))
    .filter(task => dueMatch(task, query.due, now))
    .filter(task => priorityMatch(task, query.priority))
    .filter(task => matchesSearch(state, task, query.search))
    .sort(sorter(state, now, query.sort, query.status));
}

/** Open-work counts per lens within the scope. */
export function lensCounts(state: QuestState, actor: string, now: number, scope: Scope = 'company'): Record<Lens, number> {
  const count = (lens: Lens) => state.tasks.filter(task => isOpen(task) && inView(task, actor, scope, lens, now)).length;
  return { all: count('all'), urgent: count('urgent'), today: count('today'), overdue: count('overdue'), watching: count('watching') };
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
