// Owner overview landing and the company-wide overdue list. Pure: no storage, no network.
import type { QuestState, Task } from './contract.ts';
import { isOverdue, person } from './selectors.ts';
import { DAY, localDate } from './time.ts';

/** The address names no page: blank, `#`, or `#/`. `#/home` and every other page are not empty. */
export function hashNamesNoPage(hash: string): boolean {
  const path = (hash.split('?')[0] ?? '').trim();
  return path === '' || path === '#' || path === '#/';
}

/**
 * An organization owner who opens the app with no page in the address lands on Owner overview.
 * Demo entry links (`?demo=1`, `/demo`, `#/demo`) already choose My Work, so they stay there.
 * Admins, supervisors, members, and reviewers stay on My Work. A named page such as `#/home` is kept.
 */
export function ownerLandsOnOverview(hash: string, search: string, pathname: string, isOwner: boolean): boolean {
  if (!isOwner) return false;
  if (new URLSearchParams(search).get('demo') === '1') return false;
  if (/^\/demo\/?$/.test(pathname)) return false;
  if ((hash.split('?')[0] ?? '') === '#/demo') return false;
  return hashNamesNoPage(hash);
}

/** Every open overdue task in the company, longest overdue first. Finished and archived work is left out. */
export function companyOverdue(state: QuestState, now: number): Task[] {
  return state.tasks
    .filter(task => isOverdue(task, now))
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Whole calendar days from the due date to today. A past date is at least one day late. */
export function daysLate(due: string, now: number): number {
  const today = localDate(now);
  const dueMs = new Date(`${due}T12:00:00`).getTime();
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  if (!Number.isFinite(dueMs) || !Number.isFinite(todayMs)) return 1;
  return Math.max(1, Math.round((todayMs - dueMs) / DAY));
}

export function daysLateLabel(due: string, now: number): string {
  const days = daysLate(due, now);
  return `${days} ${days === 1 ? 'day' : 'days'} late`;
}

/**
 * A name safe to show on a row. A real name is returned in full.
 * An email address is never shown, including a shortened one: the part before @ becomes a name,
 * and a blank or unreadable address becomes the empty label.
 */
export function readablePersonName(name: string | undefined | null, empty = 'Unassigned'): string {
  const raw = (name ?? '').trim();
  if (!raw) return empty;
  if (!raw.includes('@')) return raw;
  const local = (raw.split('@')[0] ?? '').replace(/[._+-]+/g, ' ').replace(/\d+/g, ' ').trim();
  const words = local.split(/\s+/).filter(Boolean);
  if (!words.length) return empty;
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

/** Owner column for a task. Missing people and email-shaped names fall back without showing the address. */
export function assigneeLabel(state: QuestState, id: string): string {
  if (!id) return 'Unassigned';
  return readablePersonName(person(state, id)?.name);
}
