// What the UI offers for tasks, as pure predicates the screens import. Each must agree
// with the engine's own answer (apply), which is what the server runs; parity.test.ts
// checks every person × task × action against an engine dry-run.
import type { Action, QuestState, Task, TaskStatus } from './contract.ts';
import { activeGrant, coordinates, inFocus, isLegacyArchived, isOpen, manages, moveForwardPlan, observes, person } from './selectors.ts';

/** The New task control is enabled. */
export function canCreateTask(state: QuestState, actor: string, now: number): boolean {
  if (observes(person(state, actor))) return false;
  return !inFocus(state, actor) || activeGrant(state, actor, now)?.section === 'create-task';
}

/** Move Work Forward is shown and enabled for this person on this task. */
export function offersMoveForward(state: QuestState, task: Task, actor: string, now: number): boolean {
  if (observes(person(state, actor)) || isLegacyArchived(task)) return false;
  if (inFocus(state, actor) && state.focus?.taskId !== task.id && activeGrant(state, actor, now)?.section !== 'company-work') return false;
  return moveForwardPlan(state, task, actor).canAct;
}

/** Reopen is offered for completed work (owner, approver, or a supervisor, admin or owner). */
export function canReopenTask(state: QuestState, task: Task, actor: string): boolean {
  if (task.status !== 'done' || observes(person(state, actor))) return false;
  return task.owner === actor || task.approver === actor || coordinates(person(state, actor));
}

/** Archive as legacy is offered on unfinished, unarchived work to supervisors, admins and owners. */
export function canArchiveLegacy(state: QuestState, task: Task, actor: string): boolean {
  return task.status !== 'done' && !task.archivedAt && coordinates(person(state, actor));
}

/** Owner, due date and priority are read-only on Ultra Priority work below Owner/Admin. */
export function lockedTaskFields(state: QuestState, task: Task, actor: string): boolean {
  return task.ultra && !manages(person(state, actor));
}

/** Editing a task's fields. Live members edit only their own tasks; Supervisor, Admin and Owner edit any. The demo keeps its work-role rules. */
export function canEditTask(state: QuestState, task: Task, actor: string): boolean {
  const me = person(state, actor);
  if (!me || observes(me) || isLegacyArchived(task)) return false;
  return !me.authority || coordinates(me) || task.owner === actor;
}

/** Choosing someone other than yourself as a task's owner (create or reassign). */
export function canAssignOthers(state: QuestState, actor: string): boolean {
  const me = person(state, actor);
  return !!me && !observes(me) && (!me.authority || coordinates(me));
}

/** A status change offered from the status pill. Moves with a `prompt` need a note first. */
export type StatusMove = { key: 'advance' | 'block' | 'send-back'; label: string; to: TaskStatus; prompt?: string };

/** The status changes this person can make on this task, in the order the pill lists them. */
export function statusMoves(state: QuestState, task: Task, actor: string, now: number): StatusMove[] {
  const me = person(state, actor);
  if (!me || observes(me) || !isOpen(task)) return [];
  if (inFocus(state, actor) && state.focus?.taskId !== task.id && activeGrant(state, actor, now)?.section !== 'company-work') return [];
  const moves: StatusMove[] = [];
  if (offersMoveForward(state, task, actor, now)) {
    const to: TaskStatus = !task.owner ? task.status // taking unowned work keeps its status
      : task.status === 'working' ? (task.approver && task.approver !== actor ? 'review' : 'done')
      : task.status === 'review' ? 'done' : 'working';
    moves.push({ key: 'advance', label: moveForwardPlan(state, task, actor).label, to });
  }
  const onTask = [task.owner, task.approver, task.nextOwner, task.decisionOwner, ...task.watchers].includes(actor);
  if (task.status !== 'blocked' && (!me.authority || coordinates(me) || onTask)) moves.push({ key: 'block', label: 'Blocked · ask for help', to: 'blocked', prompt: 'What’s in the way?' });
  if (task.status === 'review' && (actor === task.approver || manages(me))) moves.push({ key: 'send-back', label: 'Send back', to: 'working', prompt: 'What needs to change?' });
  return moves;
}

/** The engine action for a status move. */
export function statusAction(task: Task, move: StatusMove, note = ''): Action {
  if (move.key === 'block') return { type: 'task/request-help', id: task.id, note };
  if (move.key === 'send-back') return { type: 'task/send-back', id: task.id, note };
  return { type: 'task/advance', id: task.id };
}
