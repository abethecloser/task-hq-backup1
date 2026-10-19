import type { QuestState } from './contract.ts';
import { attentionFor } from './awareness.ts';
import { operationalMeasures } from './metrics.ts';
import { DEFAULT_QUERY, queryTasks } from './registry.ts';
import { canEnter, inFocus, person } from './selectors.ts';

export interface CompanySignal {
  id: string;
  source: 'condition' | 'event';
  taskId: string;
  text: string;
  detail: string;
  at?: number;
}

/** A projection of authorized records, never a fabricated notification or sync claim.
 * Current conditions and recorded changes remain explicitly distinct. */
export function companySignals(state: QuestState, actor: string, now: number) {
  const me = person(state, actor);
  if (!me || me.role === 'reviewer') return { summary: 'No operational signals available for this role.', items: [] as CompanySignal[] };
  const focus = inFocus(state, actor) && !canEnter(state, actor, 'company-work', now);
  const tasks = focus ? state.tasks.filter(task => task.id === state.focus?.taskId) : state.tasks;
  const ids = new Set(tasks.map(task => task.id));
  // Remove out-of-scope events before passing records to existing metrics and rules.
  const scoped = { ...state, tasks, events: state.events.filter(event => !!event.taskId && ids.has(event.taskId)), leads: focus ? [] : state.leads };
  const items: CompanySignal[] = [];
  const covered = new Set<string>();
  for (const item of attentionFor(scoped, now, actor).items) {
    if (!item.taskId || !ids.has(item.taskId) || covered.has(item.taskId)) continue;
    covered.add(item.taskId);
    items.push({ id: `condition:${item.id}`, source: 'condition', taskId: item.taskId, text: item.what, detail: item.next });
    if (items.length === 6) break;
  }
  const seenEvents = new Set<string>();
  const changedTasks = new Set<string>();
  for (const event of [...scoped.events].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))) {
    if (event.undone || event.at > now || now - event.at > 86_400_000 || seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    if (!event.taskId || changedTasks.has(event.taskId)) continue;
    // Keep only operational task events, not feedback, policy or access decisions.
    if (!['task', 'handoff', 'unlock', 'help', 'approval', 'ultra'].includes(event.kind)) continue;
    changedTasks.add(event.taskId);
    items.push({ id: `event:${event.id}`, source: 'event', taskId: event.taskId, text: event.text, detail: 'Recorded task event', at: event.at });
    if (changedTasks.size === 6) break;
  }
  const open = queryTasks(scoped, actor, now, DEFAULT_QUERY).length;
  const today = queryTasks(scoped, actor, now, { ...DEFAULT_QUERY, lens: 'today' }).length;
  const overdue = queryTasks(scoped, actor, now, { ...DEFAULT_QUERY, lens: 'overdue' }).length;
  const stalled = operationalMeasures(scoped, now, actor).measures.find(item => item.key === 'stalled-now')?.value ?? 0;
  return { summary: `${open} open · ${today} due today · ${overdue} overdue · ${stalled} stalled${focus ? ' · Focus task only' : ''}`, items: items.slice(0, 12) };
}
