// A personal, rearrangeable dashboard of modules. The page supplies its modules (what each one is and
// draws); this component owns only the layout: order, size, which are shown, editing and saving.
// Built for Home first; another page can reuse it by passing its own modules and page id.
import { useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { ARRANGEMENT_LABELS, HEIGHTS, HEIGHT_LABELS, PRESETS, PRESET_LABELS, SIZE_LABELS, addItem, heightOf, layoutOf, moveItem, normalizeLayout, removeItem, resizeItem, sameLayout, setArrangement, setHeight } from '../../core/dashboard-layout.ts';
import type { Arrangement, DashboardLayout, LayoutItem, ModuleHeight, ModuleSize, ModuleSpec, PresetId } from '../../core/dashboard-layout.ts';
import { useLayoutStore } from './useLayoutStore.ts';

/** Packed rows are this fine (px; CSS grid-auto-rows wins), so a module's span tracks its real height; the gutter matches the columns. */
const ROW_UNIT = 2, GUTTER = 14;

export interface DashboardModule extends ModuleSpec {
  name: string;
  /** One line for the Add module library. */
  description: string;
  /** Draws the module. `layout` lets a module leave out parts another visible module already shows. */
  render: (context: { size: ModuleSize; layout: DashboardLayout }) => ReactNode;
}

export function Dashboard({ pageId, scope, actor, modules, defaultItems, presets = PRESETS, presetLabels = PRESET_LABELS }: {
  pageId: string; scope: string; actor: string;
  /** Modules this person can use here (anything they can't see is simply not passed). */
  modules: DashboardModule[];
  defaultItems: LayoutItem[];
  presets?: Record<string, LayoutItem[]>; presetLabels?: Record<string, string>;
}) {
  const store = useLayoutStore(pageId, scope, actor, modules);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const editing = draft !== null;
  const layout = draft ?? store.layout;
  const spec = (id: string) => modules.find(item => item.id === id)!;
  const available = modules.filter(item => !layout.items.some(entry => entry.id === item.id));
  const live = useRef<HTMLParagraphElement>(null);
  const announce = (text: string) => setNotice(text);
  const grid = useRef<HTMLDivElement>(null);
  const arrangement: Arrangement = layout.arrangement ?? 'packed';

  // Packed: each module spans as many fine grid rows as its own height (plus one gutter). Placement
  // stays in the person's order (no dense backfill), so what you read, tab through and arranged agree,
  // while later modules still rise into the space under short neighbours.
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>(':scope > .dash-item')];
    if (arrangement !== 'packed') { for (const item of items) item.style.gridRowEnd = ''; return; }
    const fit = () => {
      const unit = parseFloat(getComputedStyle(node).gridAutoRows) || ROW_UNIT;
      for (const item of items) item.style.gridRowEnd = `span ${Math.max(1, Math.ceil((item.getBoundingClientRect().height + GUTTER) / unit))}`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [layout, arrangement, editing]);

  const move = (id: string, to: number) => { setDraft(current => moveItem(current ?? store.layout, id, to)); };
  function onKey(event: KeyboardEvent, id: string, index: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = event.key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(layout.items.length - 1, index + 1);
    move(id, to);
    announce(`${spec(id).name} moved to position ${to + 1} of ${layout.items.length}.`);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dash-handle="${id}"]`)?.focus());
  }
  function onDragOver(event: DragEvent, id: string) {
    if (!dragging || dragging === id) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Wide modules sit alone in their row, so above/below reads better; narrow ones sit side by side.
    const after = box.width > box.height * 1.6 ? event.clientY > box.top + box.height / 2 : event.clientX > box.left + box.width / 2;
    setDrop(current => (current?.id === id && current.after === after ? current : { id, after }));
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (dragging && drop) {
      const without = layout.items.filter(item => item.id !== dragging);
      const at = without.findIndex(item => item.id === drop.id) + (drop.after ? 1 : 0);
      move(dragging, at);
      announce(`${spec(dragging).name} moved.`);
    }
    setDragging(null); setDrop(null);
  }
  async function save() {
    const next = draft!;
    // Saving the default arrangement clears the preference, so future default improvements apply.
    const isDefault = sameLayout(next, normalizeLayout(null, modules, defaultItems));
    const ok = await store.save(isDefault ? null : next);
    if (ok) { setDraft(null); announce('Dashboard saved.'); } else announce('Couldn’t save your dashboard. Your changes are still here; try again.');
  }

  return (
    <div className={`dash ${editing ? 'is-editing' : ''}`}>
      <div className="dash-bar">
        {!editing
          ? <button type="button" className="btn btn-ghost btn-sm dash-edit" onClick={() => { setDraft(store.layout); setNotice(''); }}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z" /></svg>Edit dashboard
            </button>
          : <div className="dash-tools" role="toolbar" aria-label="Edit dashboard">
              <b className="dash-tools-title">Editing your dashboard</b>
              <label className="dash-tool"><span className="sr-only">Start from a layout</span>
                <select value="" onChange={event => { const id = event.target.value as PresetId; if (!id) return; setDraft(normalizeLayout({ version: 1, items: presets[id] }, modules, defaultItems)); announce(`${presetLabels[id]} layout loaded. Save to keep it.`); }}>
                  <option value="">Start from a layout…</option>
                  {Object.keys(presets).map(id => <option key={id} value={id}>{presetLabels[id]}</option>)}
                </select>
              </label>
              <label className="dash-tool"><span className="sr-only">Add a module</span>
                <select value="" disabled={!available.length} onChange={event => { const item = modules.find(entry => entry.id === event.target.value); if (!item) return; setDraft(addItem(layout, item)); announce(`${item.name} added at the end.`); }}>
                  <option value="">{available.length ? `Add module (${available.length})…` : 'All modules shown'}</option>
                  {available.map(item => <option key={item.id} value={item.id}>{item.name} — {item.description}</option>)}
                </select>
              </label>
              <span className="seg dash-arrange" role="group" aria-label="Arrangement">
                {(['packed', 'aligned'] as Arrangement[]).map(value => <button key={value} type="button" aria-pressed={arrangement === value}
                  title={value === 'packed' ? 'Modules fill the space under shorter neighbours' : 'Cards in a row share one height'}
                  onClick={() => { setDraft(setArrangement(layout, value)); announce(`${ARRANGEMENT_LABELS[value]} arrangement.`); }}>{ARRANGEMENT_LABELS[value]}</button>)}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(layoutOf(normalizeLayout(null, modules, defaultItems).items)); announce('Default layout restored. Save to keep it.'); }}>Restore default</button>
              <span className="dash-tools-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(null); announce('Changes discarded.'); }}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={store.status === 'saving'} onClick={() => void save()}>{store.status === 'saving' ? 'Saving…' : 'Save'}</button>
              </span>
            </div>}
        <p ref={live} className={`dash-notice ${notice ? '' : 'sr-only'}`} role="status" aria-live="polite">{notice}</p>
      </div>

      <div ref={grid} className={`dash-grid is-${arrangement}`} onDragOver={event => { if (dragging) event.preventDefault(); }} onDrop={onDrop}>
        {layout.items.map((item, index) => {
          const module = spec(item.id);
          const body = module.render({ size: item.size, layout });
          const height = heightOf(item);
          if (!editing) return <div key={item.id} className={`dash-item size-${item.size} h-${height}`} data-module={item.id}><div className="dash-cell">{body}</div></div>;
          return (
            <div key={item.id} data-module={item.id}
              className={`dash-item size-${item.size} h-${height} is-edit ${dragging === item.id ? 'is-dragging' : ''} ${drop?.id === item.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
              onDragOver={event => onDragOver(event, item.id)} onDragLeave={() => setDrop(current => (current?.id === item.id ? null : current))}>
              <div className="dash-item-bar">
                <button type="button" className="dash-handle" draggable data-dash-handle={item.id}
                  aria-label={`Move ${module.name}. Position ${index + 1} of ${layout.items.length}. Use the up and down arrow keys, or drag.`}
                  onDragStart={event => { setDragging(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); const card = (event.currentTarget as HTMLElement).closest('.dash-item'); if (card) event.dataTransfer.setDragImage(card, 24, 16); }}
                  onDragEnd={() => { setDragging(null); setDrop(null); }} onKeyDown={event => onKey(event, item.id, index)}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg>
                </button>
                <span className="dash-item-name">{module.name}</span>
                <span className="dash-item-actions">
                  <button type="button" className="icon-btn" aria-label={`Move ${module.name} earlier`} disabled={index === 0} onClick={() => move(item.id, index - 1)}>↑</button>
                  <button type="button" className="icon-btn" aria-label={`Move ${module.name} later`} disabled={index === layout.items.length - 1} onClick={() => move(item.id, index + 1)}>↓</button>
                  {module.sizes.length > 1 && <span className="seg dash-sizes" role="group" aria-label={`${module.name} width`}>
                    {module.sizes.map(size => <button key={size} type="button" aria-pressed={item.size === size} title={`Width: ${SIZE_LABELS[size]}`} onClick={() => setDraft(resizeItem(layout, item.id, size, module))}>{size === 'xl' ? 'Full' : size.toUpperCase()}</button>)}
                  </span>}
                  <select className="dash-height" aria-label={`${module.name} height`} title="Height" value={height} onChange={event => setDraft(setHeight(layout, item.id, event.target.value as ModuleHeight))}>
                    {HEIGHTS.map(value => <option key={value} value={value}>{HEIGHT_LABELS[value]}</option>)}
                  </select>
                  <button type="button" className="icon-btn dash-hide" aria-label={`Hide ${module.name}`} onClick={() => { setDraft(removeItem(layout, item.id)); announce(`${module.name} hidden. Add it back from Add module.`); }}>×</button>
                </span>
              </div>
              {/* The module stays visible but can't be clicked while arranging, so a drag never opens a task. */}
              <div className="dash-cell" inert>{body}</div>
            </div>
          );
        })}
        {editing && layout.items.length === 0 && <p className="dash-empty">No modules shown. Add one from <b>Add module</b>, or start from a layout.</p>}
      </div>
    </div>
  );
}
