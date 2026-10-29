// Home's Today | This week scope. "This week" reuses the task list's existing due filter (today through the
// next 7 days), so a section and the list it links to agree. Problems stay visible in both periods.
import type { Task } from './contract.ts';
import type { RiskItem } from './dashboard.ts';
import { addDays, localDate } from './time.ts';

export type HomePeriod = 'today' | 'week';
export const HOME_PERIODS: HomePeriod[] = ['today', 'week'];
export const HOME_PERIOD_LABELS: Record<HomePeriod, string> = { today: 'Today', week: 'This week' };

/** The last due date in scope: today, or the task list's "This week" (next 7 days). */
export function periodDueLimit(now: number, period: HomePeriod) {
  return period === 'today' ? localDate(now) : addDays(now, 7);
}

/** Up next: work due within the period or already late, plus anything in motion or stuck (being worked,
 * in review, blocked, Ultra). Undated, untouched work only appears in This week. */
export function inHomePeriod(task: Task, period: HomePeriod, now: number): boolean {
  if (task.ultra || task.status === 'working' || task.status === 'review' || task.status === 'blocked') return true;
  if (!task.due) return period === 'week';
  return task.due <= periodDueLimit(now, period);
}

/** Reasons that keep a task at risk whatever the period. */
const ALWAYS_AT_RISK = new Set(['Overdue', 'Blocked', 'Waiting on a dependency', 'Stalled', 'Ultra Priority']);

/** At risk: real problems always show; a "due soon" warning only when its deadline falls inside the period. */
export function riskInPeriod(item: RiskItem, period: HomePeriod, now: number): boolean {
  return item.reasons.some(reason => ALWAYS_AT_RISK.has(reason)) || (!!item.task.due && item.task.due <= periodDueLimit(now, period));
}

export const HOME_PERIOD_KEY = 'quest-dashboard-period';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function loadHomePeriod(store: Store): HomePeriod {
  try { return store.getItem(HOME_PERIOD_KEY) === 'week' ? 'week' : 'today'; } catch { return 'today'; }
}
export function saveHomePeriod(store: Store, period: HomePeriod) {
  try { store.setItem(HOME_PERIOD_KEY, period); } catch { /* storage unavailable: this page only */ }
}
