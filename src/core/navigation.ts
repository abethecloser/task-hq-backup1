/** Page status is presentation only. Every authenticated workspace member can navigate to every page,
 * except the management Team overview, which shows only to the people core/team.ts allows. */
export type PageStatus = 'live' | 'preview';

export const APP_PAGE_IDS = [
  'home', 'reports', 'all-tasks', 'inbox', 'tools', 'company-work', 'needs-attention', 'leads',
  'executive', 'people', 'feedback', 'activity', 'settings', 'agents', 'relationships', 'calendar', 'workbook', 'archive', 'team',
] as const;
export type AppPageId = typeof APP_PAGE_IDS[number];

/** Pages whose current interface is explicitly a preview rather than a complete live feature. */
export const PAGE_STATUS: Readonly<Record<AppPageId, PageStatus>> = {
  home: 'live', 'all-tasks': 'live', calendar: 'live', inbox: 'live', 'needs-attention': 'live',
  'company-work': 'live', people: 'live', reports: 'live', activity: 'live', settings: 'live', executive: 'live', archive: 'live', team: 'live',
  workbook: 'preview', tools: 'preview', leads: 'preview', relationships: 'preview', feedback: 'preview', agents: 'preview',
};

export function pageStatus(view: string): PageStatus {
  return APP_PAGE_IDS.includes(view as AppPageId) ? PAGE_STATUS[view as AppPageId] : 'preview';
}

/** Retired page ids that open another page. Reports is its own page again (company reports), so none today. */
export const PAGE_ALIASES: Readonly<Partial<Record<AppPageId, AppPageId>>> = {};

export function canonicalPage<T extends string>(view: T): T | AppPageId {
  return PAGE_ALIASES[view as AppPageId] ?? view;
}

/** Pages shown in everyday navigation: live, and not an alias of another page. */
export const EVERYDAY_PAGES: readonly AppPageId[] = APP_PAGE_IDS.filter(id => PAGE_STATUS[id] === 'live' && !PAGE_ALIASES[id]);
/** Archived modules: out of navigation, but their pages, data and history are untouched and still open by
 * address (#/leads, #/relationships, #/agents). Remove an id here to restore it. */
export const ARCHIVED_PAGES: readonly AppPageId[] = ['leads', 'relationships', 'agents'];
/** Preview pages stay reachable, in a separate group, so unfinished modules don't crowd daily work. */
export const PREVIEW_PAGES: readonly AppPageId[] = APP_PAGE_IDS.filter(id => PAGE_STATUS[id] === 'preview' && !ARCHIVED_PAGES.includes(id));
