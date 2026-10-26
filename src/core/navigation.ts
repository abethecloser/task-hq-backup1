/** Page status is presentation only. Every authenticated workspace member can navigate to every page. */
export type PageStatus = 'live' | 'preview';

export const APP_PAGE_IDS = [
  'home', 'reports', 'all-tasks', 'inbox', 'tools', 'company-work', 'needs-attention', 'leads',
  'executive', 'people', 'feedback', 'activity', 'settings', 'agents', 'relationships', 'calendar', 'workbook',
] as const;
export type AppPageId = typeof APP_PAGE_IDS[number];

/** Pages whose current interface is explicitly a preview rather than a complete live feature. */
export const PAGE_STATUS: Readonly<Record<AppPageId, PageStatus>> = {
  home: 'live', 'all-tasks': 'live', calendar: 'live', inbox: 'live', 'needs-attention': 'live',
  'company-work': 'live', people: 'live', reports: 'live', activity: 'live', settings: 'live', executive: 'live',
  workbook: 'preview', tools: 'preview', leads: 'preview', relationships: 'preview', feedback: 'preview', agents: 'preview',
};

export function pageStatus(view: string): PageStatus {
  return APP_PAGE_IDS.includes(view as AppPageId) ? PAGE_STATUS[view as AppPageId] : 'preview';
}
