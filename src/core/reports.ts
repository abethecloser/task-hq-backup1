// Company reports: counts from the task records the viewer may see, over a rolling range.
// Nothing is estimated. "Critical & High" is Ultra (critical) or High priority.
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { compareTasks, isOpen, isOverdue } from './selectors.ts';
import { DAY, localDate } from './time.ts';

export type ReportRange = 'week' | 'month' | 'quarter';
export const RANGE_DAYS: Record<ReportRange, number> = { week: 7, month: 30, quarter: 90 };
export const RANGE_LABELS: Record<ReportRange, string> = { week: 'Week', month: 'Month', quarter: 'Quarter' };

export interface CompanyReport {
  range: ReportRange;
  /** Tasks in scope (not archived). */
  total: number;
  criticalOpen: number;
  overdue: number;
  completed: number;
  /** Share of completions in range that finished on or before their due date; null with none dated. */
  onTimeRate: number | null;
  onTimeBasis: number;
  /** Mean days from creation to completion, for completions in range; null with none. */
  avgCycleDays: number | null;
  /** Completions per week, oldest first, the last 8 weeks ending now. */
  throughput: { start: number; label: string; count: number }[];
  /** Completions in range by who finished them. */
  byPerson: { person: string; count: number }[];
  /** Every task in scope by status (open stages and done). */
  byStatus: Record<TaskStatus, number>;
  /** Open Ultra/High work, most urgent first. */
  critical: Task[];
}

const critical = (task: Task) => task.ultra || task.priority === 'high';

export function companyReport(state: QuestState, actor: string, now: number, range: ReportRange, company: boolean): CompanyReport {
  const tasks = state.tasks.filter(task => !task.archivedAt && (company || task.owner === actor));
  const since = now - RANGE_DAYS[range] * DAY;
  const done = tasks.filter(task => task.status === 'done' && task.completedAt != null && task.completedAt >= since && task.completedAt <= now);
  const dated = done.filter(task => task.due);
  const onTime = dated.filter(task => localDate(task.completedAt!) <= task.due).length;
  const cycle = done.map(task => (task.completedAt! - task.createdAt) / DAY).filter(days => days >= 0);
  const people = new Map<string, number>();
  for (const task of done) { const who = task.completedBy || task.owner; if (who) people.set(who, (people.get(who) ?? 0) + 1); }
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = now - (7 - i) * 7 * DAY, start = end - 7 * DAY;
    return { start, label: new Date(start + DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: tasks.filter(task => task.completedAt != null && task.completedAt > start && task.completedAt <= end).length };
  });
  const byStatus = { ready: 0, working: 0, review: 0, blocked: 0, done: 0 } as Record<TaskStatus, number>;
  for (const task of tasks) byStatus[task.status] += 1;
  const open = tasks.filter(isOpen);
  return {
    range, total: tasks.length,
    criticalOpen: open.filter(critical).length,
    overdue: open.filter(task => isOverdue(task, now)).length,
    completed: done.length,
    onTimeRate: dated.length ? Math.round((onTime / dated.length) * 100) : null, onTimeBasis: dated.length,
    avgCycleDays: cycle.length ? Math.round((cycle.reduce((a, b) => a + b, 0) / cycle.length) * 10) / 10 : null,
    throughput: weeks,
    byPerson: [...people].map(([person, count]) => ({ person, count })).sort((a, b) => b.count - a.count || a.person.localeCompare(b.person)),
    byStatus,
    critical: open.filter(critical).sort(compareTasks(now)),
  };
}
