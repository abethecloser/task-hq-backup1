// What the UI offers for tasks, as pure predicates the screens import. Each must agree
// with the engine's own answer (apply), which is what the server runs; parity.test.ts
// checks every person × task × action against an engine dry-run.
import type { QuestState, Task } from './contract.ts';
import { activeGrant, hasRole, inFocus, moveForwardPlan, person } from './selectors.ts';

/** The New task control is enabled. */
export function canCreateTask(state: QuestState, actor: string, now: number): boolean {
  if (person(state, actor)?.role === 'reviewer') return false;
  return !inFocus(state, actor) || activeGrant(state, actor, now)?.section === 'create-task';
}

/** Move Work Forward is shown and enabled for this person on this task. */
export function offersMoveForward(state: QuestState, task: Task, actor: string, now: number): boolean {
  if (person(state, actor)?.role === 'reviewer') return false;
  if (inFocus(state, actor) && state.focus?.taskId !== task.id && activeGrant(state, actor, now)?.section !== 'company-work') return false;
  return moveForwardPlan(state, task, actor).canAct;
}

/** Reopen is offered for completed work (owner, approver, coordinator or manager). */
export function canReopenTask(state: QuestState, task: Task, actor: string): boolean {
  if (task.status !== 'done' || person(state, actor)?.role === 'reviewer') return false;
  return task.owner === actor || task.approver === actor || hasRole(state, actor, ['manager', 'coordinator']);
}

/** Owner, due date and priority are read-only on Ultra Priority work for non-managers. */
export function lockedTaskFields(state: QuestState, task: Task, actor: string): boolean {
  return task.ultra && !hasRole(state, actor, ['manager']);
}
