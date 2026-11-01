// Personal dashboard layouts: which modules a person shows, in what order and at what size. Pure data,
// separate from what each module does (the registry in app/HomeModules.tsx). A saved layout is
// always passed through normalizeLayout, so missing, old or malformed preferences fall back safely.
export type ModuleSize = 's' | 'm' | 'l' | 'xl';
export const SIZE_LABELS: Record<ModuleSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Full width' };
/** Height is separate from width. Auto follows the content; the others are fixed heights that scroll inside, never clip. */
export type ModuleHeight = 'auto' | 'compact' | 'standard' | 'tall';
export const HEIGHTS: ModuleHeight[] = ['auto', 'compact', 'standard', 'tall'];
export const HEIGHT_LABELS: Record<ModuleHeight, string> = { auto: 'Auto', compact: 'Compact', standard: 'Standard', tall: 'Tall' };
/** Packed fills the space under short modules (in order); Aligned gives cards in a row matching heights. */
export type Arrangement = 'packed' | 'aligned';
export const ARRANGEMENT_LABELS: Record<Arrangement, string> = { packed: 'Packed', aligned: 'Aligned rows' };

/** What the layout needs to know about a module; the app's registry adds name, component and config. */
export interface ModuleSpec { id: string; sizes: ModuleSize[]; defaultSize: ModuleSize }
export interface LayoutItem { id: string; size: ModuleSize; height?: ModuleHeight }
export interface DashboardLayout { version: 1; items: LayoutItem[]; arrangement?: Arrangement }

export type PresetId = 'balanced' | 'operations' | 'visual';
export const PRESET_LABELS: Record<PresetId, string> = { balanced: 'Balanced (default)', operations: 'Operations first', visual: 'Visual first' };

/** The dashboard as it has always looked (the Balanced preset); existing people see exactly this until they change it. */
export const DEFAULT_ITEMS: LayoutItem[] = [
  { id: 'welcome', size: 'xl' }, { id: 'performance', size: 'xl' }, { id: 'up-next', size: 'm' }, { id: 'at-risk', size: 'm' },
  { id: 'projects', size: 'l' }, { id: 'culture', size: 's' },
  { id: 'needs-hand', size: 'm' }, { id: 'next-actions', size: 'm' }, { id: 'reports', size: 'm' },
];
export const PRESETS: Record<PresetId, LayoutItem[]> = {
  balanced: DEFAULT_ITEMS,
  operations: [
    { id: 'at-risk', size: 'm' }, { id: 'needs-hand', size: 'm' }, { id: 'up-next', size: 'm' }, { id: 'next-actions', size: 'm' },
    { id: 'projects', size: 'xl' }, { id: 'performance', size: 'xl' },
  ],
  visual: [
    { id: 'culture', size: 'm' }, { id: 'video', size: 'm' }, { id: 'moments', size: 'm' }, { id: 'projects', size: 'l' },
    { id: 'activity', size: 's' }, { id: 'up-next', size: 'm' },
  ],
};

export const layoutOf = (items: LayoutItem[], arrangement: Arrangement = 'packed'): DashboardLayout => ({ version: 1, items: items.map(item => ({ ...item })), arrangement });
export const heightOf = (item: LayoutItem): ModuleHeight => item.height ?? 'auto';

/** Keeps only known, available modules, once each, at a size they support; anything unusable is dropped. */
export function normalizeLayout(raw: unknown, specs: ModuleSpec[], fallback: LayoutItem[] = DEFAULT_ITEMS): DashboardLayout {
  const known = new Map(specs.map(spec => [spec.id, spec]));
  const clean = (items: unknown[]): LayoutItem[] => {
    const seen = new Set<string>();
    const out: LayoutItem[] = [];
    for (const entry of items) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, size, height } = entry as { id?: unknown; size?: unknown; height?: unknown };
      const spec = typeof id === 'string' ? known.get(id) : undefined;
      if (!spec || seen.has(spec.id)) continue;
      seen.add(spec.id);
      const item: LayoutItem = { id: spec.id, size: spec.sizes.includes(size as ModuleSize) ? size as ModuleSize : spec.defaultSize };
      // Auto is the default and isn't stored, so layouts saved before heights existed read the same.
      if (HEIGHTS.includes(height as ModuleHeight) && height !== 'auto') item.height = height as ModuleHeight;
      out.push(item);
    }
    return out;
  };
  const valid = raw && typeof raw === 'object' && (raw as DashboardLayout).version === 1 && Array.isArray((raw as DashboardLayout).items);
  const saved = valid ? clean((raw as DashboardLayout).items) : null;
  const arrangement: Arrangement = valid && (raw as DashboardLayout).arrangement === 'aligned' ? 'aligned' : 'packed';
  // A saved layout that kept nothing usable is treated as no layout at all.
  return layoutOf(saved && saved.length ? saved : clean(fallback), saved && saved.length ? arrangement : 'packed');
}

export function moveItem(layout: DashboardLayout, id: string, to: number): DashboardLayout {
  const from = layout.items.findIndex(item => item.id === id);
  if (from < 0) return layout;
  const items = [...layout.items];
  const [moved] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(to, items.length)), 0, moved!);
  return { ...layout, items };
}
export const resizeItem = (layout: DashboardLayout, id: string, size: ModuleSize, spec: ModuleSpec): DashboardLayout =>
  spec.sizes.includes(size) ? { ...layout, items: layout.items.map(item => (item.id === id ? { ...item, size } : item)) } : layout;
export const setHeight = (layout: DashboardLayout, id: string, height: ModuleHeight): DashboardLayout =>
  ({ ...layout, items: layout.items.map(item => (item.id !== id ? item : height === 'auto' ? { id: item.id, size: item.size } : { ...item, height })) });
export const setArrangement = (layout: DashboardLayout, arrangement: Arrangement): DashboardLayout => ({ ...layout, arrangement });
export const removeItem = (layout: DashboardLayout, id: string): DashboardLayout => ({ ...layout, items: layout.items.filter(item => item.id !== id) });
export const addItem = (layout: DashboardLayout, spec: ModuleSpec): DashboardLayout =>
  layout.items.some(item => item.id === spec.id) ? layout : { ...layout, items: [...layout.items, { id: spec.id, size: spec.defaultSize }] };
export const sameLayout = (a: DashboardLayout, b: DashboardLayout) => JSON.stringify(a.items) === JSON.stringify(b.items) && (a.arrangement ?? 'packed') === (b.arrangement ?? 'packed');

/** Saved layouts in a person's own account metadata: orgId → pageId → layout. */
export type SavedLayouts = Record<string, Record<string, unknown>>;
/** Sets (or clears, with null) one org's one page, leaving every other entry exactly as it was. */
export function withSavedLayout(all: unknown, orgId: string, pageId: string, next: DashboardLayout | null): SavedLayouts {
  const base: SavedLayouts = all && typeof all === 'object' && !Array.isArray(all) ? { ...(all as SavedLayouts) } : {};
  const pages = { ...(base[orgId] && typeof base[orgId] === 'object' ? base[orgId] : {}) };
  if (next) pages[pageId] = next; else delete pages[pageId];
  base[orgId] = pages;
  return base;
}

/** Columns each width takes at a breakpoint: desktop 12-column, tablet halves/full, phone one column. */
export const SPANS: Record<'desktop' | 'tablet' | 'phone', Record<ModuleSize, number>> = {
  desktop: { s: 4, m: 6, l: 8, xl: 12 },
  tablet: { s: 6, m: 6, l: 12, xl: 12 },
  phone: { s: 12, m: 12, l: 12, xl: 12 },
};
/**
 * Rows in the person's order, each filled edge to edge: modules go into a row while they fit; a row
 * with spare columns shares them out in proportion to each module's width. Order never changes and
 * no row is left with a hole at its end, so the system, not the person, owns the geometry.
 */
export function fillRows(items: { id: string; span: number }[], columns = 12): Record<string, number> {
  const out: Record<string, number> = {};
  const rows: { id: string; span: number }[][] = [];
  let row: { id: string; span: number }[] = [], used = 0;
  for (const item of items) {
    const span = Math.min(columns, Math.max(1, item.span));
    if (row.length && used + span > columns) { rows.push(row); row = []; used = 0; }
    row.push({ id: item.id, span }); used += span;
  }
  if (row.length) rows.push(row);
  for (const members of rows) {
    const total = members.reduce((sum, member) => sum + member.span, 0);
    let given = 0;
    members.forEach((member, index) => {
      const span = index === members.length - 1 ? columns - given : Math.max(1, Math.round(member.span * columns / total));
      out[member.id] = span; given += span;
    });
  }
  return out;
}
