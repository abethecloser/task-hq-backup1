// Projects & team: one read model for Home's combined section. Everything is counted from
// tasks the viewer may see; nothing is estimated. Two different measures are kept apart:
//   · task completion: tasks done ÷ tasks, for the current selection;
//   · project completion: projects whose every task is done ÷ projects that have tasks.
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { blockingDeps, compareTasks, firstName, isOpen, isOverdue } from './selectors.ts';

/** Tasks with no project are grouped under this id. */
export const NO_PROJECT = '';

export interface IntelFilter { projectId?: string | null; person?: string | null }
export interface Completion { done: number; total: number; percent: number }
export interface ProjectRow extends Completion { id: string; name: string; open: number; overdue: number; blocked: number; complete: boolean }
export interface PersonRow { person: string; name: string; open: number; overdue: number; blocked: number; byStatus: Record<Exclude<TaskStatus, 'done'>, number> }
export interface AttentionRow { task: Task; reason: 'Overdue' | 'Blocked' | 'Waiting on a dependency' }
export interface ProjectIntel {
  /** Tasks in the current selection (scope, then project and person filters). */
  tasks: Completion;
  stages: Record<TaskStatus, number>;
  projects: ProjectRow[];
  projectsComplete: { complete: number; total: number };
  people: PersonRow[];
  attention: AttentionRow[];
  next: Task[];
}

/** Rounded down until everything is done, so 99.6% never reads as 100%. */
export const percentOf = (done: number, total: number) => (total === 0 ? 0 : done === total ? 100 : Math.floor((done / total) * 100));
const completion = (tasks: Task[]): Completion => {
  const done = tasks.filter(task => task.status === 'done').length;
  return { done, total: tasks.length, percent: percentOf(done, tasks.length) };
};
const blockedOrWaiting = (state: QuestState, task: Task) => task.status === 'blocked' || (isOpen(task) && blockingDeps(state, task).length > 0);

export function projectIntel(state: QuestState, actor: string, now: number, company: boolean, filter: IntelFilter = {}): ProjectIntel {
  // Scope: the whole company for people who may see it, otherwise the viewer's own work.
  const visible = state.tasks.filter(task => company || task.owner === actor);
  const inProject = (task: Task) => filter.projectId == null || (task.projectId || NO_PROJECT) === filter.projectId;
  const byPerson = (task: Task) => filter.person == null || task.owner === filter.person;
  const selected = visible.filter(task => inProject(task) && byPerson(task));

  const stages = { ready: 0, working: 0, review: 0, blocked: 0, done: 0 } as Record<TaskStatus, number>;
  for (const task of selected) stages[task.status] += 1;

  // Project rows follow the person filter (never the project filter) so the list stays selectable.
  const forProjects = visible.filter(byPerson);
  const ids = [...new Set(forProjects.map(task => task.projectId || NO_PROJECT))];
  const projects = ids.map(id => {
    const tasks = forProjects.filter(task => (task.projectId || NO_PROJECT) === id);
    const open = tasks.filter(isOpen);
    return {
      id, name: id === NO_PROJECT ? 'No project' : state.projects.find(item => item.id === id)?.name ?? 'Removed project',
      ...completion(tasks), open: open.length, overdue: open.filter(task => isOverdue(task, now)).length,
      blocked: open.filter(task => blockedOrWaiting(state, task)).length, complete: tasks.length > 0 && open.length === 0,
    };
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const named = projects.filter(item => item.id !== NO_PROJECT);

  // People rows follow the project filter (never the person filter), company scope only.
  const forPeople = visible.filter(inProject).filter(isOpen);
  const people = company ? state.people.filter(item => item.role !== 'reviewer').map(item => {
    const open = forPeople.filter(task => task.owner === item.id);
    const by = (status: TaskStatus) => open.filter(task => task.status === status).length;
    return { person: item.id, name: firstName(state, item.id), open: open.length, overdue: open.filter(task => isOverdue(task, now)).length,
      blocked: open.filter(task => blockedOrWaiting(state, task)).length, byStatus: { ready: by('ready'), working: by('working'), review: by('review'), blocked: by('blocked') } };
  }).filter(item => item.open > 0).sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name)) : [];

  const open = selected.filter(isOpen).sort(compareTasks(now));
  const attention = open.flatMap((task): AttentionRow[] => {
    if (isOverdue(task, now)) return [{ task, reason: 'Overdue' }];
    if (task.status === 'blocked') return [{ task, reason: 'Blocked' }];
    if (blockingDeps(state, task).length > 0) return [{ task, reason: 'Waiting on a dependency' }];
    return [];
  });
  const next = open.filter(task => !blockedOrWaiting(state, task)).slice(0, 3);

  return {
    tasks: completion(selected), stages, projects,
    projectsComplete: { complete: named.filter(item => item.complete).length, total: named.length },
    people, attention, next,
  };
}
