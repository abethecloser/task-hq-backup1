// The task views shown at the top of Tasks. A short, fixed set stays visible; the rest sit in a
// "More" menu so the bar never overflows. The active view is always visible: when it lives in
// More, the More button takes its name. Presentation only; the views themselves are the
// registry lenses plus Completed.

export interface FilterTab { id: string; label: string; count?: number; hot: boolean; active: boolean }

/** Visible, in this order. Everything else goes under More, in its original order. */
export const PRIMARY_FILTERS = ['all', 'today', 'overdue', 'urgent'] as const;

export interface FilterSplit { primary: FilterTab[]; more: FilterTab[]; activeInMore: FilterTab | null }

export function splitFilters(tabs: FilterTab[]): FilterSplit {
  const primary = PRIMARY_FILTERS.map(id => tabs.find(tab => tab.id === id)).filter((tab): tab is FilterTab => !!tab);
  const more = tabs.filter(tab => !PRIMARY_FILTERS.includes(tab.id as typeof PRIMARY_FILTERS[number]));
  return { primary, more, activeInMore: more.find(tab => tab.active) ?? null };
}
