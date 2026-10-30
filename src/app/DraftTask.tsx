// The task canvas in its Draft state. The task page itself renders a draft task (built with the
// engine's own blankTask): the same layout, fields, checklist, roles and controls as an active task.
// The page's edits are task/update actions; here they shape the draft instead of the server. Create
// sends the canonical task/create, and the page becomes the saved task. Nothing else is stored.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, NewTask, Task } from '../core/contract.ts';
import { blankTask } from '../core/seed.ts';
import { hasRole } from '../core/selectors.ts';
import { localDate } from '../core/time.ts';
import type { DispatchResult } from '../adapter/store.ts';
import type { Quest } from '../ui/useQuest.ts';
import { TaskPage } from './TaskPage.tsx';

export const DRAFT_ID = 'draft-task';
const key = (tenant: string, actor: string) => `quest.taskDraft.${tenant}.${actor}`;
export function hasTaskDraft(tenant: string, actor: string) { try { return !!sessionStorage.getItem(key(tenant, actor)); } catch { return false; } }
export function discardTaskDraft(tenant: string, actor: string) { try { sessionStorage.removeItem(key(tenant, actor)); } catch { /* storage unavailable */ } }

/** The fields task/create accepts, taken from the draft. */
function toNewTask(task: Task): NewTask {
  return {
    title: task.title.trim(), description: task.description, projectId: task.projectId, owner: task.owner, nextOwner: task.nextOwner,
    decisionOwner: task.decisionOwner, approver: task.approver, waitingOn: task.waitingOn, watchers: task.watchers, priority: task.priority,
    due: task.due, nextAction: task.nextAction, dependsOn: task.dependsOn,
    ...(task.dueTime ? { dueTime: task.dueTime } : {}), ...(task.type ? { type: task.type } : {}), ...(task.tags?.length ? { tags: task.tags } : {}),
  };
}

export function DraftTask({ quest, due, projectId, onCancel, onCreated }: {
  quest: Quest; due?: string; projectId?: string; onCancel: () => void; onCreated: (id: string) => void;
}) {
  const { state, actor, now, dispatch } = quest;
  const storageKey = key(state.workspace.tenantId, actor);
  const [draft, setDraft] = useState<Task>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Task | null; if (saved?.id === DRAFT_ID) return { ...saved, ...(due ? { due } : {}), ...(projectId ? { projectId } : {}) }; } catch { /* fresh draft */ }
    // Managers delegate, so their drafts start unassigned; everyone else starts as the owner.
    const delegates = hasRole(state, actor, ['manager']);
    return blankTask(DRAFT_ID, { title: '', owner: delegates ? '' : actor, due: due ?? localDate(now), projectId: projectId ?? '', priority: 'normal' }, actor, now);
  });
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* storage unavailable */ } }, [storageKey, draft]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The page sees the draft as a task in the workspace; its task/update calls edit the draft.
  const draftState = useMemo(() => ({ ...state, tasks: [draft, ...state.tasks] }), [state, draft]);
  const draftQuest: Quest = useMemo(() => ({
    ...quest, state: draftState,
    dispatch: async (action: Action): Promise<DispatchResult> => {
      if (action.type === 'task/update' && action.id === DRAFT_ID) {
        setDraft(current => ({ ...current, ...action.changes }));
        return { ok: true, state: draftState, message: '', eventId: null, undoable: false };
      }
      return { ok: false, state: draftState, error: 'Create the task first.' };
    },
  }), [quest, draftState]);

  async function create() {
    const task = latest.current;
    if (!task.title.trim() || busy) { setError(task.title.trim() ? '' : 'Give the task a name.'); return; }
    setBusy(true); setError('');
    const result = await dispatch({ type: 'task/create', task: toNewTask(task) });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    discardTaskDraft(state.workspace.tenantId, actor);
    onCreated(result.state.tasks[0]!.id);
  }
  function cancel() { discardTaskDraft(state.workspace.tenantId, actor); onCancel(); }

  return <TaskPage quest={draftQuest} task={draft} canCreate={false} onClose={cancel} onOpen={() => undefined} onCreate={() => undefined}
    draft={{ onCreate: () => void create(), busy, error, ready: !!draft.title.trim() }} />;
}
