// Home dashboard: read-only summaries computed from records Task-HQ already holds.
// Nothing here dispatches. `company` says whether the viewer may see company-wide work
// (the same gate as Company Work); without it every panel narrows to the viewer's own tasks.
import type { QuestEvent, QuestState, Task } from './contract.ts';
import { blockingDeps, compareTasks, firstName, isOpen, isOverdue, isStalled, myTasks, taskById } from './selectors.ts';
import { DAY, localDate } from './time.ts';

export type Period = 'today' | 'week' | 'month';

/** Local midnight that starts the period: today, this Monday, or the 1st of the month. */
export function periodStart(now: number, period: Period) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (period === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (period === 'month') date.setDate(1);
  return date.getTime();
}

/** First instant after the period. */
export function periodEnd(now: number, period: Period) {
  const date = new Date(periodStart(now, period));
  if (period === 'today') date.setDate(date.getDate() + 1);
  if (period === 'week') date.setDate(date.getDate() + 7);
  if (period === 'month') date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

/** The same span immediately before this one. */
function previousStart(now: number, period: Period) {
  const start = periodStart(now, period);
  return periodStart(start - 1, period);
}

const owned = (state: QuestState, actor: string) => state.tasks.filter(task => task.owner === actor);
const waiting = (state: QuestState, task: Task) => task.status === 'blocked' || (isOpen(task) && blockingDeps(state, task).length > 0);
const completedIn = (tasks: Task[], from: number, to: number) => tasks.filter(task => task.status === 'done' && task.completedAt !== null && task.completedAt >= from && task.completedAt < to);

export interface Performance {
  completed: number;
  /** Completed minus the previous period; null when neither period has any. */
  completedDelta: number | null;
  open: number;
  /** Created minus completed this period: positive means the pile grew. */
  openDelta: number | null;
  due: number;
  blocked: number;
}

/** The viewer's own numbers for the period (owner, plus approvals waiting on them for open work). */
export function performance(state: QuestState, actor: string, now: number, period: Period): Performance {
  const mine = owned(state, actor);
  const start = periodStart(now, period), end = periodEnd(now, period), before = previousStart(now, period);
  const completed = completedIn(mine, start, end).length;
  const previous = completedIn(mine, before, start).length;
  const created = mine.filter(task => task.createdAt >= start && task.createdAt < end).length;
  const open = myTasks(state, actor, now);
  const first = localDate(start), last = localDate(end - 1);
  return {
    completed,
    completedDelta: completed || previous ? completed - previous : null,
    open: open.length,
    openDelta: created || completed ? created - completed : null,
    due: open.filter(task => task.due !== '' && task.due >= first && task.due <= last).length,
    blocked: open.filter(task => waiting(state, task)).length,
  };
}

export interface DayProgress { total: number; done: number; pending: number; percent: number }

/** Today's plate: the viewer's tasks due today, plus anything of theirs finished today. */
export function todayProgress(state: QuestState, actor: string, now: number): DayProgress {
  const today = localDate(now), start = periodStart(now, 'today'), end = periodEnd(now, 'today');
  const plate = owned(state, actor).filter(task => task.due === today || (task.completedAt !== null && task.completedAt >= start && task.completedAt < end));
  const done = plate.filter(task => task.status === 'done').length;
  return { total: plate.length, done, pending: plate.length - done, percent: plate.length ? Math.round((done / plate.length) * 100) : 0 };
}

export interface RiskItem { task: Task; reasons: string[] }

/** Open work that is overdue, blocked or waiting on a dependency, in progress but stalled,
 * or high priority and due within two days. Each task appears once, with every reason. */
export function atRisk(state: QuestState, actor: string, now: number, company: boolean): RiskItem[] {
  const soon = localDate(now + 2 * DAY);
  return state.tasks
    .filter(task => isOpen(task) && (company || task.owner === actor))
    .sort(compareTasks(now))
    .map(task => {
      const urgent = task.ultra || task.priority === 'high';
      const deps = task.status !== 'blocked' && blockingDeps(state, task).length > 0;
      // Only started work counts as stalled; an untouched backlog item is not at risk by itself.
      const stalled = task.status === 'working' && isStalled(state, task, now);
      const reasons = [
        isOverdue(task, now) && 'Overdue',
        task.status === 'blocked' && 'Blocked',
        deps && 'Waiting on a dependency',
        stalled && 'Stalled',
        urgent && !isOverdue(task, now) && task.due !== '' && task.due <= soon && 'Due soon',
        task.ultra ? 'Ultra Priority' : task.priority === 'high' && 'high priority',
      ].filter((reason): reason is string => !!reason);
      const risky = isOverdue(task, now) || task.status === 'blocked' || deps || stalled || (urgent && task.due !== '' && task.due <= soon);
      return risky ? { task, reasons } : null;
    })
    .filter((item): item is RiskItem => !!item);
}

export interface StatusMix { total: number; done: number; working: number; notStarted: number; percent: number }

/** The viewer's own tasks by stage. Blocked and in-review count as in progress. */
export function statusMix(state: QuestState, actor: string): StatusMix {
  const mine = owned(state, actor);
  const done = mine.filter(task => task.status === 'done').length;
  const notStarted = mine.filter(task => task.status === 'ready').length;
  const working = mine.length - done - notStarted;
  return { total: mine.length, done, working, notStarted, percent: mine.length ? Math.round((done / mine.length) * 100) : 0 };
}

export interface Workload {
  person: string; name: string; open: number; late: number;
  /** Open work by stage. Counts of assigned tasks, not capacity or hours. */
  byStatus: { ready: number; working: number; blocked: number; review: number };
  /** Overdue or blocked/waiting: the items that need someone to step in. */
  attention: number;
}

/** Open and overdue work per person, busiest first. People with nothing open are left out. */
export function teamWorkload(state: QuestState, now: number): Workload[] {
  return state.people
    .filter(item => item.role !== 'reviewer')
    .map(item => {
      const open = state.tasks.filter(task => isOpen(task) && task.owner === item.id);
      const by = (status: Task['status']) => open.filter(task => task.status === status).length;
      return {
        person: item.id, name: firstName(state, item.id), open: open.length, late: open.filter(task => isOverdue(task, now)).length,
        byStatus: { ready: by('ready'), working: by('working'), blocked: by('blocked'), review: by('review') },
        attention: open.filter(task => isOverdue(task, now) || waiting(state, task)).length,
      };
    })
    .filter(item => item.open > 0)
    .sort((a, b) => b.open - a.open || b.late - a.late || a.name.localeCompare(b.name));
}

const involved = (task: Task, actor: string) => [task.owner, task.approver, task.nextOwner, task.decisionOwner, ...task.watchers].includes(actor);

/** Comments other people left on tasks the viewer is part of, newest first. */
export function commentsFor(state: QuestState, actor: string, limit = 5): { event: QuestEvent; task: Task }[] {
  return state.events
    .filter(event => event.actionType === 'task/comment' && !event.undone && event.actor !== actor && event.taskId)
    .map(event => ({ event, task: taskById(state, event.taskId!) }))
    .filter((item): item is { event: QuestEvent; task: Task } => !!item.task && involved(item.task, actor))
    .sort((a, b) => b.event.at - a.event.at)
    .slice(0, limit);
}

/** Latest team activity. Without company access, only events on the viewer's own tasks. */
export function recentActivity(state: QuestState, actor: string, company: boolean, limit = 8): QuestEvent[] {
  return state.events
    .filter(event => !event.undone && event.kind !== 'system')
    .filter(event => {
      if (company) return true;
      const task = event.taskId ? taskById(state, event.taskId) : undefined;
      return event.actor === actor || (!!task && involved(task, actor));
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export interface CalendarDay { day: number; date: string; due: number; today: boolean }

/** The current month, Monday first. Leading blanks are null. `due` counts the viewer's open tasks due that day. */
export function monthGrid(state: QuestState, actor: string, now: number): (CalendarDay | null)[] {
  const first = new Date(periodStart(now, 'month'));
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = localDate(now);
  const dueOn = new Map<string, number>();
  for (const task of myTasks(state, actor, now)) if (task.due) dueOn.set(task.due, (dueOn.get(task.due) ?? 0) + 1);
  const cells: (CalendarDay | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null);
  for (let day = 1; day <= days; day++) {
    const date = localDate(new Date(first.getFullYear(), first.getMonth(), day, 12).getTime());
    cells.push({ day, date, due: dueOn.get(date) ?? 0, today: date === today });
  }
  return cells;
}

/** A plain-language summary of the period, built only from records. */
export function digest(state: QuestState, actor: string, now: number, period: 'today' | 'week', company: boolean): string[] {
  const start = periodStart(now, period);
  const span = period === 'today' ? 'Today' : 'This week';
  const scope = company ? state.tasks : state.tasks.filter(task => involved(task, actor));
  const done = completedIn(scope, start, now + 1);
  const created = scope.filter(task => task.createdAt >= start);
  const handoffs = state.events.filter(event => event.kind === 'handoff' && !event.undone && event.at >= start
    && (company || (!!event.taskId && !!taskById(state, event.taskId) && involved(taskById(state, event.taskId)!, actor))));
  const overdue = scope.filter(task => isOverdue(task, now));
  const lines = [`${span}: ${count(done.length, 'task')} completed, ${created.length} created${handoffs.length ? `, ${count(handoffs.length, 'handoff')}` : ''}.`];
  if (overdue.length) lines.push(`${count(overdue.length, 'task is', 'tasks are')} overdue${company ? ' across the team' : ' on your work'}.`);
  if (company) {
    const busiest = teamWorkload(state, now)[0];
    if (busiest) lines.push(`${busiest.name} carries the most open work: ${busiest.open} open${busiest.late ? `, ${busiest.late} late` : ''}.`);
  }
  const mine = performance(state, actor, now, period === 'today' ? 'today' : 'week');
  if (mine.blocked) lines.push(`${count(mine.blocked, 'of yours is', 'of yours are')} blocked or waiting on someone.`);
  return lines;
}

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "just now", "12m ago", "21h ago", "3d ago". */
export function ago(at: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Home v1.1: strip metrics, collaboration, activity, calendar heat and system insights ──

export interface HomeMetrics { active: number; completedToday: number; overdue: number; blocked: number }

/** The four strip numbers, all on the viewer's own plate (the same scope as `performance`). */
export function homeMetrics(state: QuestState, actor: string, now: number): HomeMetrics {
  const open = myTasks(state, actor, now);
  const today = performance(state, actor, now, 'today');
  return { active: open.length, completedToday: today.completed, overdue: open.filter(task => isOverdue(task, now)).length, blocked: today.blocked };
}

/** A channel @mention, as the universal inbox already resolved it. */
export interface MentionSource { id: string; from: string; title: string; detail: string; at: number; channelId?: string; messageId?: string; taskId?: string }

export interface CollabItem {
  id: string;
  /** comment: on work you're part of · mention: names you · reply: follows your own comment on a task. */
  kind: 'comment' | 'mention' | 'reply';
  from: string;
  text: string;
  /** Task title or channel name. */
  context: string;
  at: number;
  unread: boolean;
  taskId?: string;
  channelId?: string;
  messageId?: string;
}

const COMMENT_PREFIX = /^.*? commented: /;

/** True when the text @-mentions this person by full or first name. */
function mentions(text: string, name: string) {
  const first = name.split(/\s+/)[0] ?? '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [name, first].filter(Boolean).some(value => new RegExp(`(^|[\\s(])@${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}

/** Comments, direct mentions and replies for the viewer, newest first. Task comments need the viewer to be
 * part of the task (or company access); channel mentions come from the inbox and keep its read state. */
export function collaboration(state: QuestState, actor: string, company: boolean, channel: MentionSource[], read: Set<string>, limit = 6): CollabItem[] {
  const me = state.people.find(item => item.id === actor);
  if (!me) return [];
  const commented = new Map<string, number>();
  for (const event of state.events) {
    if (event.actionType !== 'task/comment' || event.undone || event.actor !== actor || !event.taskId) continue;
    commented.set(event.taskId, Math.min(commented.get(event.taskId) ?? Infinity, event.at));
  }
  const items: CollabItem[] = [];
  for (const event of state.events) {
    if (event.actionType !== 'task/comment' || event.undone || event.actor === actor || !event.taskId) continue;
    const task = taskById(state, event.taskId);
    if (!task) continue;
    const text = event.text.replace(COMMENT_PREFIX, '');
    const part = involved(task, actor);
    const kind = mentions(text, me.name) ? 'mention' : (commented.get(task.id) ?? Infinity) < event.at ? 'reply' : part ? 'comment' : null;
    if (!kind || !(part || company)) continue;
    items.push({ id: event.id, kind, from: event.actor, text, context: task.title, at: event.at, unread: false, taskId: task.id });
  }
  for (const item of channel) {
    items.push({ id: item.id, kind: 'mention', from: item.from, text: item.detail, context: item.title, at: item.at, unread: !read.has(item.id), taskId: item.taskId, channelId: item.channelId, messageId: item.messageId });
  }
  return items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Event kinds worth showing as team activity; feedback, policy, grants and system notes are noise here. */
const ACTIVITY_KINDS = new Set(['task', 'handoff', 'unlock', 'help', 'approval', 'ultra', 'lead']);
const ACTIVITY_WINDOW = 10 * 60_000;

/** Meaningful recent activity, newest first. Repeats by the same person on the same record within
 * ten minutes collapse to the newest one. Same access rule as `recentActivity`. */
export function teamActivity(state: QuestState, actor: string, company: boolean, limit = 6): QuestEvent[] {
  const out: QuestEvent[] = [];
  const latest = new Map<string, number>();
  for (const event of recentActivity(state, actor, company, Infinity)) {
    if (!ACTIVITY_KINDS.has(event.kind)) continue;
    const key = `${event.actor}:${event.taskId ?? event.leadId ?? event.id}`;
    const newer = latest.get(key);
    if (newer !== undefined && newer - event.at <= ACTIVITY_WINDOW) continue;
    latest.set(key, event.at);
    out.push(event);
    if (out.length === limit) break;
  }
  return out;
}

export interface HeatDay extends CalendarDay {
  /** Open work due that day that is overdue (past days only). */
  overdue: number;
  /** Open work due that day that is blocked or waiting on a dependency. */
  blocked: number;
  /** 0–4: due-date load from records. It describes deadlines, never a person's performance. */
  heat: 0 | 1 | 2 | 3 | 4;
}

/** Open tasks in the viewer's calendar scope: their own plate, or all open work with company access. */
export function calendarTasks(state: QuestState, actor: string, now: number, company: boolean): Task[] {
  return company ? state.tasks.filter(isOpen).sort(compareTasks(now)) : myTasks(state, actor, now);
}

/** A month (offset from the current one), Monday first, with due-date load per day. */
export function heatGrid(state: QuestState, actor: string, now: number, company: boolean, offset = 0): { label: string; cells: (HeatDay | null)[] } {
  const start = new Date(periodStart(now, 'month'));
  const first = new Date(start.getFullYear(), start.getMonth() + offset, 1, 12);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = localDate(now);
  const byDate = new Map<string, Task[]>();
  for (const task of calendarTasks(state, actor, now, company)) if (task.due) byDate.set(task.due, [...(byDate.get(task.due) ?? []), task]);
  const cells: (HeatDay | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null);
  for (let day = 1; day <= days; day++) {
    const date = localDate(new Date(first.getFullYear(), first.getMonth(), day, 12).getTime());
    const due = byDate.get(date) ?? [];
    const blocked = due.filter(task => waiting(state, task)).length;
    const overdue = due.filter(task => isOverdue(task, now)).length;
    const load = due.length + blocked;
    cells.push({ day, date, due: due.length, today: date === today, overdue, blocked, heat: load === 0 ? 0 : load === 1 ? 1 : load <= 3 ? 2 : load <= 5 ? 3 : 4 });
  }
  return { label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), cells };
}

/** Open tasks due on a date, in the calendar's scope and the usual task order. */
export function dueOn(state: QuestState, actor: string, now: number, company: boolean, date: string): Task[] {
  return calendarTasks(state, actor, now, company).filter(task => task.due === date);
}

export interface SystemInsight {
  id: string;
  tone: 'stop' | 'warn' | 'info';
  title: string;
  detail: string;
  /** Where the evidence lives. */
  target?: { taskId: string } | { owner: string } | { date: string } | { lens: 'overdue' | 'all'; owner?: 'none'; status?: 'blocked' };
}

/** Deterministic observations from records. Future AI analysis may add to this list; it never replaces it. */
export function systemInsights(state: QuestState, actor: string, now: number, company: boolean): SystemInsight[] {
  const scope = (company ? state.tasks : state.tasks.filter(task => involved(task, actor))).filter(isOpen);
  const out: SystemInsight[] = [];
  const today = localDate(now);
  const week = localDate(periodStart(now, 'week')), lastWeek = localDate(previousStart(now, 'week'));

  // Rising overdue: open work that went past due this week vs. open work that went past due the week before.
  const thisWeek = scope.filter(task => task.due && task.due >= week && task.due < today).length;
  const before = scope.filter(task => task.due && task.due >= lastWeek && task.due < week).length;
  if (thisWeek > before && thisWeek > 0) out.push({ id: 'overdue-rising', tone: 'stop', title: 'Overdue work is rising', detail: `${count(thisWeek, 'open task')} went past due this week, against ${before} from the week before that are still open.`, target: { lens: 'overdue' } });

  // Concentrated assignments: one person holds at least 40% of the open assigned work.
  if (company) {
    const assigned = scope.filter(task => task.owner);
    const top = teamWorkload(state, now)[0];
    if (top && assigned.length >= 5 && new Set(assigned.map(task => task.owner)).size > 1 && top.open / assigned.length >= 0.4) {
      out.push({ id: 'concentrated', tone: 'warn', title: 'Assignments are concentrated', detail: `${top.name} holds ${top.open} of ${assigned.length} open assigned tasks (${Math.round((top.open / assigned.length) * 100)}%). This counts tasks, not hours or capacity.`, target: { owner: top.person } });
    }
  }

  // Repeated blockers: the same task blocked twice in 30 days, or several tasks waiting on the same outside party.
  const helpBy = new Map<string, number>();
  for (const event of state.events) {
    if (event.actionType !== 'task/request-help' || event.undone || !event.taskId || now - event.at > 30 * DAY) continue;
    helpBy.set(event.taskId, (helpBy.get(event.taskId) ?? 0) + 1);
  }
  for (const task of scope) {
    const times = helpBy.get(task.id) ?? 0;
    if (times >= 2) out.push({ id: `reblocked-${task.id}`, tone: 'warn', title: 'Blocked repeatedly', detail: `“${task.title}” has been blocked ${times} times in the last 30 days.`, target: { taskId: task.id } });
  }
  const outside = new Map<string, Task[]>();
  for (const task of scope) if (task.waitingOn.trim()) outside.set(task.waitingOn.trim().toLowerCase(), [...(outside.get(task.waitingOn.trim().toLowerCase()) ?? []), task]);
  for (const tasks of outside.values()) {
    if (tasks.length >= 2) out.push({ id: `waiting-${tasks[0]!.id}`, tone: 'warn', title: 'Shared outside dependency', detail: `${count(tasks.length, 'open task')} are waiting on ${tasks[0]!.waitingOn.trim()}.`, target: { taskId: tasks[0]!.id } });
  }

  // Unassigned work.
  const unowned = scope.filter(task => !task.owner).length;
  if (unowned) out.push({ id: 'unassigned', tone: 'warn', title: 'Unassigned work', detail: `${count(unowned, 'open task')} ${unowned === 1 ? 'has' : 'have'} no owner.`, target: { lens: 'all', owner: 'none' } });

  // Deadline clusters: three or more open tasks due on one day in the next seven days.
  const soon = localDate(now + 7 * DAY);
  const dueDays = new Map<string, number>();
  for (const task of scope) if (task.due && task.due >= today && task.due <= soon) dueDays.set(task.due, (dueDays.get(task.due) ?? 0) + 1);
  for (const [date, n] of [...dueDays].sort(([a], [b]) => a.localeCompare(b))) {
    if (n >= 3) out.push({ id: `cluster-${date}`, tone: 'info', title: 'Deadline cluster', detail: `${count(n, 'open task')} due ${date === today ? 'today' : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`, target: { date } });
  }
  return out;
}
