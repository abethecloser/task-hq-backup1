// What the UI offers for tasks, as pure predicates the screens import. Each must agree
// with the engine's own answer (apply), which is what the server runs; parity.test.ts
// checks every person × task × action against an engine dry-run.
import type { QuestState, Task } from './contract.ts';
import { activeGrant, coordinates, inFocus, manages, moveForwardPlan, observes, person } from './selectors.ts';

/** The New task control is enabled. */
export function canCreateTask(state: QuestState, actor: string, now: number): boolean {
  if (observes(person(state, actor))) return false;
  return !inFocus(state, actor) || activeGrant(state, actor, now)?.section === 'create-task';
}

/** Move Work Forward is shown and enabled for this person on this task. */
export function offersMoveForward(state: QuestState, task: Task, actor: string, now: number): boolean {
  if (observes(person(state, actor))) return false;
  if (inFocus(state, actor) && state.focus?.taskId !== task.id && activeGrant(state, actor, now)?.section !== 'company-work') return false;
  return moveForwardPlan(state, task, actor).canAct;
}

/** Reopen is offered for completed work (owner, approver, or a supervisor, admin or owner). */
export function canReopenTask(state: QuestState, task: Task, actor: string): boolean {
  if (task.status !== 'done' || observes(person(state, actor))) return false;
  return task.owner === actor || task.approver === actor || coordinates(person(state, actor));
}

/** Owner, due date and priority are read-only on Ultra Priority work below Owner/Admin. */
export function lockedTaskFields(state: QuestState, task: Task, actor: string): boolean {
  return task.ultra && !manages(person(state, actor));
}

/** Editing a task's fields. Live members edit only their own tasks; Supervisor, Admin and Owner edit any. The demo keeps its work-role rules. */
export function canEditTask(state: QuestState, task: Task, actor: string): boolean {
  const me = person(state, actor);
  if (!me || observes(me)) return false;
  return !me.authority || coordinates(me) || task.owner === actor;
}

/** Choosing someone other than yourself as a task's owner (create or reassign). */
export function canAssignOthers(state: QuestState, actor: string): boolean {
  const me = person(state, actor);
  return !!me && !observes(me) && (!me.authority || coordinates(me));
}
