// Turns a tool result's task requests into real tasks through the task engine, and closes the
// tasks a step made unnecessary. Shared by the app and the tests so both run the same path.
//
// Tasks are created with `task/create` and finished with `task/advance`, so the engine's
// ownership, dependency and approval rules apply exactly as they do anywhere else. If the
// engine refuses (e.g. someone else owns the task), the task is left open and reported.
import type { Action, QuestState } from '../contract.ts';
import type { TaskRequest, ToolAction } from './estimating.ts';

export type EngineDispatch = (action: Action) => Promise<{ ok: true; state: QuestState; eventId: string | null } | { ok: false; error: string }>;

export interface HookOutcome {
  created: { key: string; taskId: string; title: string }[];
  closed: string[];
  problems: string[];
  /** Link actions to record the created task ids on their tool records. */
  links: ToolAction[];
}

export async function runTaskHooks(requests: TaskRequest[], close: string[], dispatch: EngineDispatch): Promise<HookOutcome> {
  const outcome: HookOutcome = { created: [], closed: [], problems: [], links: [] };
  const byRecord = new Map<string, { kind: TaskRequest['kind']; id: string; links: Record<string, string> }>();
  for (const request of requests) {
    const res = await dispatch({ type: 'task/create', task: request.task });
    if (!res.ok) { outcome.problems.push(`“${request.task.title}” wasn’t created: ${res.error}`); continue; }
    const taskId = res.state.events.find(event => event.id === res.eventId)?.taskId;
    if (!taskId) { outcome.problems.push(`“${request.task.title}” may have been created but couldn’t be confirmed.`); continue; }
    outcome.created.push({ key: request.key, taskId, title: request.task.title });
    const entry = byRecord.get(`${request.kind}:${request.recordId}`) ?? { kind: request.kind, id: request.recordId, links: {} };
    entry.links[request.key] = taskId;
    byRecord.set(`${request.kind}:${request.recordId}`, entry);
  }
  for (const entry of byRecord.values()) outcome.links.push({ type: 'tasks/link', kind: entry.kind, id: entry.id, links: entry.links });
  for (const taskId of close) {
    // ready → working → done (or → review if the task has its own approver): at most three steps.
    for (let step = 0; step < 3; step += 1) {
      const res = await dispatch({ type: 'task/advance', id: taskId });
      if (!res.ok) { if (step === 0) outcome.problems.push(`A linked task was left open: ${res.error}`); break; }
      const task = res.state.tasks.find(item => item.id === taskId);
      if (!task || task.status === 'done' || task.status === 'review') { outcome.closed.push(taskId); break; }
    }
  }
  return outcome;
}
