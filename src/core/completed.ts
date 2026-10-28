// Display completion provenance from the persisted task, with retained history as
// a legacy fallback. Never substitute the assignee for the completion actor.
import type { QuestState, Task } from './contract.ts';

export function completionDetails(state: QuestState, task: Task) {
  const event = task.status === 'done' ? state.events.find(event => event.taskId === task.id && !event.undone && event.undo?.tasks[task.id] && event.undo.tasks[task.id]!.status !== 'done') : undefined;
  return { actor: task.completedBy || event?.actor || '', at: task.completedAt ?? event?.at ?? null };
}
