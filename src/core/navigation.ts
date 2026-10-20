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
  /** Sections reopened per organization by the caller's role there (e.g. People & Roles for owners). */
  byOrg?: Record<string, string[]>;
}

export const UNDER_CONSTRUCTION = 'Under construction :)';

/** The approved experience: always open, whatever the server lists. */
export const ALWAYS_OPEN: readonly string[] = ['home', 'all-tasks', 'calendar'];

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
  const { full, restricted, by_org: byOrg } = data as { full?: unknown; restricted?: unknown; by_org?: unknown };
  if (typeof full !== 'boolean' || !Array.isArray(restricted) || !restricted.every(item => typeof item === 'string')) return CLOSED;
  const reopened: Record<string, string[]> = {};
  if (byOrg && typeof byOrg === 'object' && !Array.isArray(byOrg)) {
    for (const [org, sections] of Object.entries(byOrg)) if (Array.isArray(sections)) reopened[org] = sections.filter((item): item is string => typeof item === 'string');
  }
  return { full, restricted, byOrg: reopened };
}

/** The access that applies inside one organization: its role-reopened sections are open. */
export function forOrg(access: NavigationAccess, orgId: string): NavigationAccess {
  const reopened = access.byOrg?.[orgId] ?? [];
  return reopened.length ? { ...access, restricted: access.restricted.filter(view => !reopened.includes(view)) } : access;
}

// ── Work / Manage ──────────────────────────────────────────────────────────
// A permanent permission, separate from the temporary restriction above: Work is daily
// execution for everyone; Manage (oversight and administration) exists only for roles that
// coordinate or observe. The server enforces every action either way; this only shapes the UI.

/** Views that belong to Manage. Everything else is Work. */
export const MANAGE_VIEWS: readonly string[] = ['company-work', 'people', 'reports', 'executive', 'activity', 'feedback', 'settings', 'agents'];

export const isManageView = (view: string) => MANAGE_VIEWS.includes(view);

/** Organization roles that get the Manage workspace. Developer / Observer keeps its read-only view of it. */
export function canManage(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'supervisor' || role === 'reviewer';
}
