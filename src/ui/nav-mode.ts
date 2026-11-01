// Navigation dock (preview): which destinations live in the dock and which in the rail / phone menu.
// Pure, so the split is testable and every destination stays reachable exactly once per surface.

export type NavMode = 'classic' | 'dock';
export const NAV_MODE_KEY = 'taskhq.nav';

/** Left of Home, Home (centre anchor), right of Home. */
export const DOCK_LEFT = ['all-tasks', 'company-work'] as const;
export const DOCK_HOME = 'home';
export const DOCK_RIGHT = ['calendar', 'inbox'] as const;
export const DOCK_IDS: string[] = [...DOCK_LEFT, DOCK_HOME, ...DOCK_RIGHT];

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
 * Splits the navigation list. Dock: exactly the five primary destinations. Rail (wide screens) and the
 * phone menu: everything else — contextual shortcuts and workspace utilities — so no surface repeats the dock.
 */
export function splitNavigation<T extends { id: string }>(items: T[]) {
  const dock = DOCK_IDS.filter(id => items.some(item => item.id === id));
  const rail = items.filter(item => !DOCK_IDS.includes(item.id));
  return { dock, rail };
}
