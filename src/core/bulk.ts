// Bulk actions for selected tasks. Each selected task becomes its own ordinary engine action (one
// event per task, the usual permissions), or a skip with the reason. Nothing is batched server-side,
// so a bulk action is exactly the same as doing each task by hand.
import type { Action, Priority, QuestState, Task } from './contract.ts';
import { canArchiveLegacy, canAssignOthers, canEditTask, canReopenTask, lockedTaskFields } from './permissions.ts';
import { coordinates, isProjectArchived, person, taskById } from './selectors.ts';

export type BulkKind =
  | { kind: 'archive' }
  | { kind: 'restore' }
  | { kind: 'assign'; owner: string }
  | { kind: 'priority'; priority: Priority }
  | { kind: 'project'; projectId: string };

export interface BulkPlan { actions: { task: Task; action: Action }[]; skipped: { task: Task; reason: string }[] }

export function bulkPlan(state: QuestState, actor: string, ids: string[], request: BulkKind): BulkPlan {
  const plan: BulkPlan = { actions: [], skipped: [] };
  const coordinator = coordinates(person(state, actor));
  for (const id of ids) {
    const task = taskById(state, id);
    if (!task) continue;
    const skip = (reason: string) => plan.skipped.push({ task, reason });
    const act = (action: Action) => plan.actions.push({ task, action });
    if (request.kind === 'archive') {
      if (task.archivedAt) skip('already archived');
      else if (task.status === 'done') canReopenTask(state, task, actor) ? act({ type: 'task/archive', id: task.id }) : skip('only its owner, approver or a coordinator can archive it');
      else canArchiveLegacy(state, task, actor) ? act({ type: 'task/archive', id: task.id, reason: 'legacy' }) : skip('only a supervisor, admin or owner archives unfinished work');
      continue;
    }
    if (request.kind === 'restore') {
      if (!task.archivedAt) skip('not archived');
      else if (task.status === 'done' ? canReopenTask(state, task, actor) : coordinator) act({ type: 'task/unarchive', id: task.id });
      else skip('you can’t restore it');
      continue;
    }
    if (task.archivedAt) { skip('archived; restore it first'); continue; }
    if (!canEditTask(state, task, actor)) { skip('you can’t edit it'); continue; }
    if (request.kind === 'assign') {
      if (task.owner === request.owner) skip('already assigned');
      else if (task.status === 'done') skip('completed');
      else if (request.owner !== actor && !canAssignOthers(state, actor)) skip('only a supervisor, admin or owner assigns work to others');
      else if (lockedTaskFields(state, task, actor)) skip('Ultra Priority owner is locked');
      else act({ type: 'task/update', id: task.id, changes: { owner: request.owner } });
    } else if (request.kind === 'priority') {
      if (task.priority === request.priority) skip('already that priority');
      else if (lockedTaskFields(state, task, actor)) skip('Ultra Priority is locked');
      else act({ type: 'task/update', id: task.id, changes: { priority: request.priority } });
    } else {
      if (task.projectId === request.projectId) skip('already in that project');
      else if (request.projectId && isProjectArchived(state, request.projectId)) skip('that project is archived');
      else act({ type: 'task/update', id: task.id, changes: { projectId: request.projectId } });
    }
  }
  return plan;
}

/** One line for the result: "Archived 3 tasks. 1 not changed: “s” (already archived)." */
export function bulkSummary(verb: string, done: number, skipped: { task: Task; reason: string }[]): string {
  const head = done ? `${verb} ${done} ${done === 1 ? 'task' : 'tasks'}.` : 'Nothing changed.';
  if (!skipped.length) return head;
  const shown = skipped.slice(0, 3).map(item => `“${item.task.title}” (${item.reason})`).join(', ');
  return `${head} ${skipped.length} not changed: ${shown}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''}.`;
}
