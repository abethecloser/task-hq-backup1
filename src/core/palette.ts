// Command palette model: one ranked list of things a person can do or open from the keyboard.
// Pure and local. It only describes targets; the interface performs them through the existing
// navigation (hash routes) and engine, so it adds no permissions or write path of its own.
import type { QuestState, Task } from './contract.ts';
import { canCreateTask } from './permissions.ts';
import { EVERYDAY_PAGES } from './navigation.ts';
import type { AppPageId } from './navigation.ts';

export type PaletteTarget =
  | { kind: 'page'; page: AppPageId }
  | { kind: 'task'; id: string }
  | { kind: 'create' };

export interface PaletteItem {
  id: string;
  group: 'Actions' | 'Go to' | 'Tasks';
  label: string;
  /** Secondary text: owner and status for a task, the shortcut for an action. */
  hint: string;
  target: PaletteTarget;
  /** Extra words the label should also be found by. */
  keywords?: string;
}

export const PAGE_LABELS: Readonly<Partial<Record<AppPageId, string>>> = {
  home: 'My Work', 'all-tasks': 'Tasks', calendar: 'Calendar', inbox: 'Inbox', 'needs-attention': 'Needs Attention',
  'company-work': 'Projects', people: 'People & Access', reports: 'Reports', activity: 'Activity', settings: 'Settings',
  executive: 'Owner overview', archive: 'Archive', team: 'Team',
};

const MAX_TASKS = 200;

export function paletteItems(state: QuestState, actor: string, now: number, opts: { canOpenPage?: (page: AppPageId) => boolean } = {}): PaletteItem[] {
  const items: PaletteItem[] = [];
  if (canCreateTask(state, actor, now)) items.push({ id: 'create', group: 'Actions', label: 'New task', hint: 'N', target: { kind: 'create' }, keywords: 'add capture create' });
  for (const page of EVERYDAY_PAGES) {
    const label = PAGE_LABELS[page];
    if (!label || (opts.canOpenPage && !opts.canOpenPage(page))) continue;
    items.push({ id: `page:${page}`, group: 'Go to', label, hint: 'Page', target: { kind: 'page', page } });
  }
  const open = state.tasks.filter((task: Task) => !task.archivedAt && task.status !== 'done');
  open.sort((a, b) => Number(b.owner === actor) - Number(a.owner === actor) || a.title.localeCompare(b.title));
  for (const task of open.slice(0, MAX_TASKS)) {
    const owner = state.people.find(person => person.id === task.owner)?.name ?? 'Unassigned';
    items.push({ id: `task:${task.id}`, group: 'Tasks', label: task.title, hint: `${owner} · ${task.status}`, target: { kind: 'task', id: task.id }, keywords: `${task.nextAction} ${owner}` });
  }
  return items;
}

/** Subsequence score: lower is better, null means no match. Prefix and word-start matches win. */
function score(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const exact = t.indexOf(query);
  if (exact === 0) return 0;
  if (exact > 0) return t[exact - 1] === ' ' ? 1 : 2;
  let at = 0;
  for (const ch of query) { at = t.indexOf(ch, at); if (at < 0) return null; at += 1; }
  return 5;
}

export function rankPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter(item => item.group !== 'Tasks').concat(items.filter(item => item.group === 'Tasks').slice(0, 8)).slice(0, limit);
  const scored: { item: PaletteItem; rank: number; index: number }[] = [];
  items.forEach((item, index) => {
    const direct = score(item.label, q);
    const loose = direct === null ? score(item.keywords ?? '', q) : null;
    const rank = direct ?? (loose === null ? null : 10 + loose);
    if (rank !== null) scored.push({ item, rank, index });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, limit).map(entry => entry.item);
}
