// Bottom dock sizing: four snap positions computed from the height available below the header,
// and the one saved preference (`quest-dock-height`). Pure, so the snapping rules are testable.
export type DockSnap = 'collapsed' | 'default' | 'half' | 'expanded';
export const DOCK_SNAPS: DockSnap[] = ['collapsed', 'default', 'half', 'expanded'];
export const DOCK_SNAP_LABELS: Record<DockSnap, string> = { collapsed: 'Collapsed', default: 'Default', half: 'Halfway', expanded: 'Expanded' };
/** The collapsed ribbon. */
export const DOCK_RAIL = 52;
/** The Wallboard keeps at least this much height, even with the dock fully expanded. */
export const DOCK_MIN_CENTER = 88;
export const DOCK_STORAGE_KEY = 'quest-dock-height';
const LEGACY_KEY = 'taskhq.collab-dock';

export interface DockPreference { snap: DockSnap; /** The last open position, restored by the toggle. */ last: Exclude<DockSnap, 'collapsed'> }
export const DOCK_DEFAULT_PREF: DockPreference = { snap: 'collapsed', last: 'default' };

/** Heights in px for a workspace `avail` px tall (viewport bottom minus the top of the center). Always ascending. */
export function snapHeights(avail: number): Record<DockSnap, number> {
  const expanded = Math.max(DOCK_RAIL + 3, Math.round(avail - DOCK_MIN_CENTER));
  const def = Math.min(expanded - 2, Math.max(DOCK_RAIL + 1, Math.min(420, Math.max(220, Math.round(avail * 0.33)))));
  const half = Math.min(expanded - 1, Math.max(def + 1, Math.round(avail * 0.5)));
  return { collapsed: DOCK_RAIL, default: def, half, expanded };
}

export function clampDock(height: number, avail: number) {
  const heights = snapHeights(avail);
  return Math.min(heights.expanded, Math.max(DOCK_RAIL, Math.round(height)));
}

export function nearestSnap(height: number, avail: number): DockSnap {
  const heights = snapHeights(avail);
  return DOCK_SNAPS.reduce((best, snap) => Math.abs(heights[snap] - height) < Math.abs(heights[best] - height) ? snap : best, 'collapsed' as DockSnap);
}

/** One step up or down the snap list (keyboard). */
export function stepSnap(snap: DockSnap, dir: 1 | -1): DockSnap {
  return DOCK_SNAPS[Math.min(DOCK_SNAPS.length - 1, Math.max(0, DOCK_SNAPS.indexOf(snap) + dir))]!;
}

export function withSnap(pref: DockPreference, snap: DockSnap): DockPreference {
  return { snap, last: snap === 'collapsed' ? pref.last : snap };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const isOpenSnap = (value: unknown): value is DockPreference['last'] => value === 'default' || value === 'half' || value === 'expanded';

export function loadDockPreference(store: Store): DockPreference {
  try {
    const raw = store.getItem(DOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DockPreference>;
      const last = isOpenSnap(parsed.last) ? parsed.last : 'default';
      return { snap: parsed.snap === 'collapsed' || isOpenSnap(parsed.snap) ? parsed.snap : 'collapsed', last };
    }
    // The earlier open/closed flag moves over once.
    const legacy = store.getItem(LEGACY_KEY);
    if (legacy) { store.removeItem(LEGACY_KEY); return legacy === 'open' ? { snap: 'default', last: 'default' } : DOCK_DEFAULT_PREF; }
  } catch { /* unreadable: start collapsed */ }
  return DOCK_DEFAULT_PREF;
}

export function saveDockPreference(store: Store, pref: DockPreference) {
  try { store.setItem(DOCK_STORAGE_KEY, JSON.stringify(pref)); } catch { /* storage unavailable: this page only */ }
}
