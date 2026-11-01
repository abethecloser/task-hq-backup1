// Personal dashboard layouts: which modules a person shows, in what order and at what size. Pure data,
// separate from what each module does (the registry in app/HomeModules.tsx). A saved layout is
// always passed through normalizeLayout, so missing, old or malformed preferences fall back safely.
export type ModuleSize = 's' | 'm' | 'l' | 'xl';
export const SIZE_LABELS: Record<ModuleSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Full width' };

/** What the layout needs to know about a module; the app's registry adds name, component and config. */
export interface ModuleSpec { id: string; sizes: ModuleSize[]; defaultSize: ModuleSize }
export interface LayoutItem { id: string; size: ModuleSize }
export interface DashboardLayout { version: 1; items: LayoutItem[] }

export type PresetId = 'balanced' | 'operations' | 'visual';
export const PRESET_LABELS: Record<PresetId, string> = { balanced: 'Balanced (default)', operations: 'Operations first', visual: 'Visual first' };

/** The dashboard as it has always looked (the Balanced preset); existing people see exactly this until they change it. */
export const DEFAULT_ITEMS: LayoutItem[] = [
  { id: 'welcome', size: 'xl' }, { id: 'performance', size: 'xl' }, { id: 'up-next', size: 'm' }, { id: 'at-risk', size: 'm' },
  { id: 'projects', size: 'l' }, { id: 'culture', size: 's' },
];
export const PRESETS: Record<PresetId, LayoutItem[]> = {
  balanced: DEFAULT_ITEMS,
  operations: [
    { id: 'at-risk', size: 'm' }, { id: 'needs-hand', size: 'm' }, { id: 'up-next', size: 'm' }, { id: 'people', size: 'm' },
    { id: 'projects', size: 'xl' }, { id: 'performance', size: 'xl' },
  ],
  visual: [
    { id: 'culture', size: 'm' }, { id: 'video', size: 'm' }, { id: 'moments', size: 'm' }, { id: 'projects', size: 'l' },
    { id: 'activity', size: 's' }, { id: 'up-next', size: 'm' },
  ],
};

export const layoutOf = (items: LayoutItem[]): DashboardLayout => ({ version: 1, items: items.map(item => ({ ...item })) });

/** Keeps only known, available modules, once each, at a size they support; anything unusable is dropped. */
export function normalizeLayout(raw: unknown, specs: ModuleSpec[], fallback: LayoutItem[] = DEFAULT_ITEMS): DashboardLayout {
  const known = new Map(specs.map(spec => [spec.id, spec]));
  const clean = (items: unknown[]): LayoutItem[] => {
    const seen = new Set<string>();
    const out: LayoutItem[] = [];
    for (const entry of items) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, size } = entry as { id?: unknown; size?: unknown };
      const spec = typeof id === 'string' ? known.get(id) : undefined;
      if (!spec || seen.has(spec.id)) continue;
      seen.add(spec.id);
      out.push({ id: spec.id, size: spec.sizes.includes(size as ModuleSize) ? size as ModuleSize : spec.defaultSize });
    }
    return out;
  };
  const saved = raw && typeof raw === 'object' && (raw as DashboardLayout).version === 1 && Array.isArray((raw as DashboardLayout).items) ? clean((raw as DashboardLayout).items) : null;
  // A saved layout that kept nothing usable is treated as no layout at all.
  return layoutOf(saved && saved.length ? saved : clean(fallback));
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
export const removeItem = (layout: DashboardLayout, id: string): DashboardLayout => ({ ...layout, items: layout.items.filter(item => item.id !== id) });
export const addItem = (layout: DashboardLayout, spec: ModuleSpec): DashboardLayout =>
  layout.items.some(item => item.id === spec.id) ? layout : { ...layout, items: [...layout.items, { id: spec.id, size: spec.defaultSize }] };
export const sameLayout = (a: DashboardLayout, b: DashboardLayout) => JSON.stringify(a.items) === JSON.stringify(b.items);
