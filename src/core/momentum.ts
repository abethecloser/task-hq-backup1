import type { QuestState } from './contract.ts';
import { periodStart } from './dashboard.ts';
import { blockingDeps, canEnter, inFocus, isOverdue, myTasks, person } from './selectors.ts';
import { localDate } from './time.ts';

export interface MomentumSession { startedAt: number; previousAt: number | null; visit: number }
export type MomentumKind = 'unavailable' | 'overdue' | 'blocked' | 'completed' | 'returning' | 'busy' | 'clear' | 'weekend' | 'morning' | 'afternoon' | 'evening';
const MESSAGES: Record<MomentumKind, string[]> = {
  unavailable: ['A clear start changes everything.', "Let’s see what’s taking shape.", 'There’s room to move.'],
  overdue: ['A little clarity can change the day.', 'One good decision can shift the day.', 'The next step is worth a look.'],
  blocked: ['Some progress starts with a conversation.', 'A clearer path is worth finding.', 'One good decision can shift the day.'],
  completed: ['Look at what moved.', 'A little progress changes the picture.', 'The day is taking shape.'],
  returning: ['Right where you left off.', 'The picture has moved a little.', 'Let’s see what’s taking shape.'],
  busy: ['A clear next step makes room.', 'One thing at a time has its place.', 'There’s a thread worth following.'],
  clear: ['There’s room to move.', 'A little space can be useful.', 'Room for a fresh thought.'],
  weekend: ['A little room to take stock.', 'At your own pace.', 'Space for a different rhythm.'],
  morning: ['A clear start changes everything.', 'The next step is already taking shape.', 'Let’s see what’s taking shape.'],
  afternoon: ['The day is still taking shape.', 'There’s room to move.', 'One good decision can shift the day.'],
  evening: ['A moment to see the whole picture.', 'A little clarity for what comes next.', 'Room to take stock.'],
};
const count = (n: number, singular: string, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;
const hash = (value: string) => [...value].reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0);

/** Pure, local, deterministic copy. Only authorized loaded records can contribute. */
export function momentumGreeting(state: QuestState | null, actor: string, now: number, session: MomentumSession, company = false) {
  const date = new Date(now), hour = date.getHours();
  const time = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const me = state && person(state, actor);
  // Current schema stores display names in Person.name. Never derive a hero name from email.
  const displayName = me?.name.trim() ?? '';
  const name = displayName.includes('@') ? '' : displayName.split(/\s+/)[0] ?? '';
  const prefix = name ? `${name}, ` : '';
  let kind: MomentumKind = 'unavailable';
  let support = `${prefix}your workspace is here when you’re ready.`;
  if (state && me && me.role !== 'reviewer') {
    const restricted = inFocus(state, actor) && !canEnter(state, actor, 'company-work', now);
    const companyAllowed = company && !restricted;
    const open = myTasks(state, actor, now).filter(task => !restricted || task.id === state.focus?.taskId);
    const owned = state.tasks.filter(task => task.owner === actor && (!restricted || task.id === state.focus?.taskId));
    const overdue = open.filter(task => isOverdue(task, now)).length;
    const blocked = open.filter(task => task.status === 'blocked' || blockingDeps(state, task).length > 0).length;
    const today = periodStart(now, 'today');
    const done = owned.filter(task => task.status === 'done' && task.completedAt !== null && task.completedAt >= today && task.completedAt <= now).length;
    const since = session.previousAt;
    const oldest = state.events.reduce((at, event) => Math.min(at, event.at), Infinity);
    // Once history reaches its cap, only claim coverage if the checkpoint is retained.
    const reliable = since !== null && Number.isFinite(since) && since < session.startedAt && since > 0 && (state.events.length < 400 || oldest <= since);
    const taskIds = new Set((companyAllowed ? state.tasks : owned).map(task => task.id));
    const changes = reliable ? new Set(state.events.filter(event => !event.undone && !!event.taskId && taskIds.has(event.taskId)
      && event.at > since! && event.at <= session.startedAt && ['task', 'handoff', 'unlock', 'help', 'approval', 'ultra'].includes(event.kind)).map(event => event.id)).size : 0;
    if (overdue) { kind = 'overdue'; support = `${prefix}${count(overdue, 'task')} on your plate ${overdue === 1 ? 'is' : 'are'} past due${blocked ? `; ${count(blocked, 'task')} ${blocked === 1 ? 'is' : 'are'} blocked or waiting` : ''}.`; }
    else if (blocked) { kind = 'blocked'; support = `${prefix}${count(blocked, 'task')} on your plate ${blocked === 1 ? 'is' : 'are'} blocked or waiting on a dependency.`; }
    else if (done) { kind = 'completed'; support = `${prefix}${count(done, 'task')} you own ${done === 1 ? 'was' : 'were'} completed today${open.length ? `; ${open.length} remain open on your plate` : ''}.`; }
    else if (changes) { kind = 'returning'; support = `${prefix}${count(changes, 'recorded task change')} ${companyAllowed ? 'in your workspace' : 'on your work'} since your previous session.`; }
    else if (!open.length) { kind = 'clear'; support = `${prefix}no open tasks or approvals are on your plate right now.`; }
    else if (open.length >= 8) { kind = 'busy'; support = `${prefix}${count(open.length, 'open task')} and approvals are on your plate.`; }
    else { kind = weekend ? 'weekend' : time.toLowerCase() as MomentumKind; support = `${prefix}${count(open.length, 'open task')} ${open.length === 1 ? 'is' : 'are'} on your plate${weekend ? ' this weekend' : ''}.`; }
  }
  const variants = MESSAGES[kind];
  const index = (hash(`${state?.workspace.tenantId ?? ''}:${actor}:${kind}`) + Math.max(0, Math.floor(session.visit))) % variants.length;
  return { id: `${kind}:${index}`, kind, primary: variants[index]!, support,
    eyebrow: `${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)} · ${time}${weekend ? ' · Weekend' : ''}`,
    date: localDate(now) };
}
