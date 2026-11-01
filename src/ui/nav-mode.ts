// Navigation dock (preview): which destinations live in the dock, in More, and in the slim rail.
// Pure, so the split is testable and every destination stays reachable exactly once per surface.

export type NavMode = 'classic' | 'dock';
export const NAV_MODE_KEY = 'taskhq.nav';

/** Left of Home, Home (centre anchor), right of Home. */
export const DOCK_LEFT = ['all-tasks', 'company-work'] as const;
export const DOCK_HOME = 'home';
export const DOCK_RIGHT = ['calendar', 'inbox'] as const;
export const DOCK_IDS: string[] = [...DOCK_LEFT, DOCK_HOME, ...DOCK_RIGHT];
/** Workspace utilities: the slim rail keeps these on wide screens (Settings is the rail's gear). */
export const RAIL_UTILITIES = ['people', 'settings'];

/** `?nav=dock` turns the preview on and remembers it; `?nav=classic` turns it off. */
export function readNavMode(search: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): NavMode {
  const asked = new URLSearchParams(search).get('nav');
  if (asked === 'dock' || asked === 'classic') {
    try { storage?.setItem(NAV_MODE_KEY, asked); } catch { /* private mode: this visit only */ }
    return asked;
  }
  try { return storage?.getItem(NAV_MODE_KEY) === 'dock' ? 'dock' : 'classic'; } catch { return 'classic'; }
}

/**
 * Splits the navigation list. Dock: the five anchors. More: everything else that is a place to go
 * (on wide screens the rail's utilities stay in the rail, so More never repeats them). Rail: utilities only.
 */
export function splitNavigation<T extends { id: string }>(items: T[], mobile: boolean) {
  const has = (id: string) => items.some(item => item.id === id);
  const dock = DOCK_IDS.filter(has);
  const rail = mobile ? [] : items.filter(item => RAIL_UTILITIES.includes(item.id));
  const more = items.filter(item => !DOCK_IDS.includes(item.id) && (mobile || !RAIL_UTILITIES.includes(item.id)));
  return { dock, more, rail };
}
