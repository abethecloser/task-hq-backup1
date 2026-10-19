// Temporary restricted navigation. The server decides who may open which section
// (public.my_navigation, backed by private.full_navigation_users and
// private.restricted_sections); this module only applies that answer in the UI.
// It fails closed: without a valid server answer, every restrictable section is restricted.
// Reopen a section for everyone by deleting its row on the server; no client change needed.

export interface NavigationAccess {
  /** Allowlisted account: every section stays open. */
  full: boolean;
  /** View ids that are under construction for everyone else. */
  restricted: string[];
}

export const UNDER_CONSTRUCTION = 'Under construction :)';

/** The approved experience: always open, whatever the server lists. */
export const ALWAYS_OPEN: readonly string[] = ['home', 'all-tasks'];

/** Every other view in the app (src/app/App.tsx `View`), restricted when the server can't be asked. */
export const RESTRICTABLE: readonly string[] = [
  'inbox', 'search', 'tools', 'needs-attention', 'leads', 'executive', 'company-work',
  'relationships', 'people', 'reports', 'activity', 'feedback', 'settings', 'agents',
];

export const CLOSED: NavigationAccess = { full: false, restricted: [...RESTRICTABLE] };

export function canNavigate(access: NavigationAccess, view: string): boolean {
  return ALWAYS_OPEN.includes(view) || access.full || !access.restricted.includes(view);
}

/** The server's answer, or CLOSED when it is missing or malformed. */
export function parseNavigation(data: unknown): NavigationAccess {
  if (!data || typeof data !== 'object') return CLOSED;
  const { full, restricted } = data as { full?: unknown; restricted?: unknown };
  if (typeof full !== 'boolean' || !Array.isArray(restricted) || !restricted.every(item => typeof item === 'string')) return CLOSED;
  return { full, restricted };
}
