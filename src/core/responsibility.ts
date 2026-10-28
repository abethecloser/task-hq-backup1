// Who must act on a task right now, what they must do, who gets the work afterward and who
// reviews it. Derived only from the existing lifecycle and role fields (status, owner,
// approver, next-step owner, blocker, dependencies); it stores and decides nothing.
import type { QuestState, Task } from './contract.ts';
import { STATUS_LABELS } from './contract.ts';
import { nameOf } from './selectors.ts';

export type ResponsibilityInput = Pick<Task, 'status' | 'owner' | 'approver' | 'nextOwner' | 'nextAction' | 'blocker' | 'dependsOn'> & { id?: string };

export interface Responsibility {
  stateLabel: string;
  tone: 'idle' | 'act' | 'wait' | 'stop' | 'done';
  /** Person who must act now; '' when nobody can yet. */
  actor: string;
  /** Shown when `actor` is empty or the work is held up elsewhere. */
  actorNote: string;
  action: string;
  handoff: { id: string; text: string };
  approval: { id: string; text: string } | null;
}

export function responsibility(state: QuestState, task: ResponsibilityInput): Responsibility {
  const approver = task.approver;
  const handoff = task.nextOwner
    ? { id: task.nextOwner, text: `${nameOf(state, task.nextOwner)} receives it next` }
    : { id: '', text: 'No next-step owner chosen' };
  const stateLabel = STATUS_LABELS[task.status];
  const approval = approver
    ? { id: approver, text: task.status === 'review' ? 'Review needed now' : task.status === 'done' ? 'Approval path' : 'Reviews before it is complete' }
    : null;
  const base = { stateLabel, handoff, approval };
  const waitingOn = task.status === 'done' ? null : state.tasks.find(item => item.id !== task.id && task.dependsOn.includes(item.id) && item.status !== 'done');

  if (task.status === 'done') return { ...base, tone: 'done', actor: '', actorNote: 'Nothing left to do', action: 'Completed' };
  if (waitingOn) return { ...base, tone: 'wait', actor: waitingOn.owner, actorNote: `Waiting on “${waitingOn.title}”`, action: 'Starts once that work is done' };
  if (!task.owner) return { ...base, tone: 'stop', actor: '', actorNote: 'Nobody is assigned', action: 'Assign someone to start' };
  if (task.status === 'blocked') {
    const helper = task.blocker?.helper;
    return { ...base, tone: 'stop', actor: helper || task.owner, actorNote: helper ? 'Asked to help' : '', action: task.blocker?.note ? `Clear the blocker: ${task.blocker.note}` : 'Clear the blocker' };
  }
  if (task.status === 'review') return { ...base, tone: 'act', actor: approver || task.owner, actorNote: approver ? '' : 'No approver is set', action: 'Review, then approve or send back' };
  if (task.status === 'working') return { ...base, tone: 'act', actor: task.owner, actorNote: '', action: task.nextAction || (approver ? 'Finish the work and send it for review' : 'Finish the work') };
  return { ...base, tone: 'act', actor: task.owner, actorNote: '', action: task.nextAction || 'Start the work' };
}
