// A personal, rearrangeable dashboard of modules. The page supplies its modules (what each one is and
// draws); this component owns only the layout: order, size, which are shown, editing and saving.
// Built for Home first; another page can reuse it by passing its own modules and page id.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { SPANS, addItem, fillRows, layoutOf, moveItem, normalizeLayout, removeItem, resizeItem, sameLayout } from '../../core/dashboard-layout.ts';
import type { DashboardLayout, LayoutItem, ModuleSize, ModuleSpec } from '../../core/dashboard-layout.ts';
import { useLayoutStore } from './useLayoutStore.ts';

/** One sizing behaviour, Auto: fixed heights and arrangement choices from earlier versions are read as
 * Auto and dropped when the layout is next saved. Width (Expand) and order are what a person controls. */
const autoOnly = (layout: DashboardLayout): DashboardLayout => layoutOf(layout.items.map(({ id, size }) => ({ id, size })));

function useBreakpoint(): 'desktop' | 'tablet' | 'phone' {
  const read = (): 'desktop' | 'tablet' | 'phone' => (typeof matchMedia === 'undefined' ? 'desktop' : matchMedia('(max-width: 760px)').matches ? 'phone' : matchMedia('(max-width: 1100px)').matches ? 'tablet' : 'desktop');
  const [value, setValue] = useState(read);
  useEffect(() => {
    const queries = [matchMedia('(max-width: 760px)'), matchMedia('(max-width: 1100px)')];
    const update = () => setValue(read());
    for (const query of queries) query.addEventListener('change', update);
    return () => { for (const query of queries) query.removeEventListener('change', update); };
  }, []);
  return value;
}

/** Packed rows are this fine (px; CSS grid-auto-rows wins), so a module's span tracks its real height; the gutter matches the columns. */
const ROW_UNIT = 2, GUTTER = 14;
/** Neighbours this close in height (px) line up; bigger differences pack, so no space is wasted. */
const BALANCE = 96;

export interface DashboardModule extends ModuleSpec {
  name: string;
  /** One line for the Add module library. */
  description: string;
  /** Draws the module. `layout` lets a module leave out parts another visible module already shows. */
  render: (context: { size: ModuleSize; layout: DashboardLayout }) => ReactNode;
}

export function Dashboard({ pageId, scope, actor, modules, defaultItems }: {
  pageId: string; scope: string; actor: string;
  /** Modules this person can use here (anything they can't see is simply not passed). */
  modules: DashboardModule[];
  defaultItems: LayoutItem[];
}) {
  const store = useLayoutStore(pageId, scope, actor, modules);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const editing = draft !== null;
  const layout = draft ?? autoOnly(store.layout);
  // Rows fill edge to edge in the person's order (same breakpoints as the CSS).
  const breakpoint = useBreakpoint();
  const spans = fillRows(layout.items.map(item => ({ id: item.id, span: SPANS[breakpoint][item.size] })));
  const spec = (id: string) => modules.find(item => item.id === id)!;
  const available = modules.filter(item => !layout.items.some(entry => entry.id === item.id));
  const live = useRef<HTMLParagraphElement>(null);
  const announce = (text: string) => setNotice(text);
  const grid = useRef<HTMLDivElement>(null);
  // Adaptive placement, chosen for the person: modules keep their order; each spans its natural
  // height on fine rows, so later modules rise into space under shorter neighbours (no dense backfill,
  // so reading, Tab and arranged order agree). Neighbours that start together and differ by less than
  // BALANCE share the taller height, so near-equal cards line up instead of leaving ragged edges or
  // slivers too small to use. Saved 'aligned' arrangements from earlier versions read the same way.
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const items = [...node.querySelectorAll<HTMLElement>(':scope > .dash-item')];
    const fit = () => {
      const unit = parseFloat(getComputedStyle(node).gridAutoRows) || ROW_UNIT;
      const span = (height: number) => `span ${Math.max(1, Math.ceil((height + GUTTER) / unit))}`;
      for (const item of items) item.style.minHeight = '';
      const natural = items.map(item => item.getBoundingClientRect().height);
      items.forEach((item, index) => { item.style.gridRowEnd = span(natural[index]!); });
      const rows = new Map<number, number[]>();
      items.forEach((item, index) => {
        const top = item.offsetTop;
        const row = [...rows.keys()].find(key => Math.abs(key - top) <= unit) ?? top;
        rows.set(row, [...(rows.get(row) ?? []), index]);
      });
      for (const members of rows.values()) {
        if (members.length < 2) continue;
        const tallest = Math.max(...members.map(index => natural[index]!));
        for (const index of members) if (tallest - natural[index]! <= BALANCE) { items[index]!.style.minHeight = `${tallest}px`; items[index]!.style.gridRowEnd = span(tallest); }
      }
    };
    fit();
    // Watch the content, not the card (balancing changes the card's height, never its content).
    const observer = new ResizeObserver(fit);
    for (const item of items) for (const part of item.querySelectorAll(':scope > .dash-cell, :scope > .dash-item-bar')) observer.observe(part);
    return () => observer.disconnect();
  }, [layout, editing, breakpoint]);

  const move = (id: string, to: number) => { setDraft(current => moveItem(current ?? autoOnly(store.layout), id, to)); };
  // Touch and pen: the handle drags with the finger (HTML drag-and-drop is mouse-only on most phones).
  const touch = useRef<{ id: string; pointer: number } | null>(null);
  function dropTargetAt(x: number, y: number, id: string) {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('.dash-grid > .dash-item');
    if (!card || card.dataset.module === id) return null;
    const box = card.getBoundingClientRect();
    const after = box.width > box.height * 1.6 ? y > box.top + box.height / 2 : x > box.left + box.width / 2;
    return { id: card.dataset.module!, after };
  }
  const touchHandlers = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse') return;
      touch.current = { id, pointer: event.pointerId };
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
      setDragging(id);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (touch.current?.pointer !== event.pointerId) return;
      setDrop(dropTargetAt(event.clientX, event.clientY, id));
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (touch.current?.pointer !== event.pointerId) return;
      const target = dropTargetAt(event.clientX, event.clientY, id);
      touch.current = null;
      if (target) {
        const without = layout.items.filter(item => item.id !== id);
        move(id, without.findIndex(item => item.id === target.id) + (target.after ? 1 : 0));
        announce(`${spec(id).name} moved.`);
      }
      setDragging(null); setDrop(null);
    },
    // A mouse drag also fires pointercancel when HTML drag-and-drop takes over; only a touch drag ends here.
    onPointerCancel: () => { if (!touch.current) return; touch.current = null; setDragging(null); setDrop(null); },
  });
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
    const next = autoOnly(draft!);
    // Saving the default arrangement clears the preference, so future default improvements apply.
    const isDefault = sameLayout(next, normalizeLayout(null, modules, defaultItems));
    const ok = await store.save(isDefault ? null : next);
    if (ok) { setDraft(null); announce('Dashboard saved.'); } else announce('Couldn’t save your dashboard. Your changes are still here; try again.');
  }

  return (
    <div className={`dash ${editing ? 'is-editing' : ''}`}>
      <div className="dash-bar">
        {!editing
          ? <button type="button" className="btn btn-ghost btn-sm dash-edit" onClick={() => { setDraft(autoOnly(store.layout)); setNotice(''); }}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z" /></svg>Edit dashboard
            </button>
          : <div className="dash-tools" role="toolbar" aria-label="Edit dashboard">
              <b className="dash-tools-title">Editing your dashboard</b>
              <label className="dash-tool"><span className="sr-only">Add a module</span>
                <select value="" disabled={!available.length} onChange={event => { const item = modules.find(entry => entry.id === event.target.value); if (!item) return; setDraft(addItem(layout, item)); announce(`${item.name} added at the end.`); }}>
                  <option value="">{available.length ? `Add module (${available.length})…` : 'All modules shown'}</option>
                  {available.map(item => <option key={item.id} value={item.id}>{item.name} — {item.description}</option>)}
                </select>
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(layoutOf(normalizeLayout(null, modules, defaultItems).items)); announce('Default layout restored. Save to keep it.'); }}>Restore default</button>
              <span className="dash-tools-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(null); announce('Changes discarded.'); }}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={store.status === 'saving'} onClick={() => void save()}>{store.status === 'saving' ? 'Saving…' : 'Save'}</button>
              </span>
            </div>}
        <p ref={live} className={`dash-notice ${notice ? '' : 'sr-only'}`} role="status" aria-live="polite">{notice}</p>
      </div>

      <div ref={grid} className="dash-grid is-adaptive" onDragOver={event => { if (dragging) event.preventDefault(); }} onDrop={onDrop}>
        {layout.items.map((item, index) => {
          const module = spec(item.id);
          const body = module.render({ size: item.size, layout });
          // Expand gives the module the next width up; when it's wider than its default, Collapse returns it.
          const larger = module.sizes[module.sizes.indexOf(item.size) + 1];
          const expanded = module.sizes.indexOf(item.size) > module.sizes.indexOf(module.defaultSize);
          const expand = expanded ? module.defaultSize : larger;
          if (!editing) return <div key={item.id} className={`dash-item size-${item.size}`} data-module={item.id} style={{ gridColumn: `span ${spans[item.id]}` }}><div className="dash-cell">{body}</div></div>;
          return (
            <div key={item.id} data-module={item.id} style={{ gridColumn: `span ${spans[item.id]}` }}
              className={`dash-item size-${item.size} is-edit ${dragging === item.id ? 'is-dragging' : ''} ${drop?.id === item.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
              onDragOver={event => onDragOver(event, item.id)} onDragLeave={() => setDrop(current => (current?.id === item.id ? null : current))}>
              <div className="dash-item-bar">
                <button type="button" className="dash-handle" draggable data-dash-handle={item.id}
                  aria-label={`Move ${module.name}. Position ${index + 1} of ${layout.items.length}. Use the up and down arrow keys, or drag.`}
                  onDragStart={event => { setDragging(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); const card = (event.currentTarget as HTMLElement).closest('.dash-item'); if (card) event.dataTransfer.setDragImage(card, 24, 16); }}
                  onDragEnd={() => { setDragging(null); setDrop(null); }} onKeyDown={event => onKey(event, item.id, index)} {...touchHandlers(item.id)}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg>
                </button>
                <span className="dash-item-name">{module.name}</span>
                <span className="dash-item-actions">
                  {expand && <button type="button" className="btn btn-ghost btn-sm dash-expand" aria-pressed={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${module.name}`} onClick={() => { setDraft(resizeItem(layout, item.id, expand, module)); announce(`${module.name} ${expanded ? 'collapsed' : 'expanded'}.`); }}>
                    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={expanded ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} /></svg>{expanded ? 'Collapse' : 'Expand'}
                  </button>}
                  <button type="button" className="icon-btn dash-hide" aria-label={`Hide ${module.name}`} title="Hide" onClick={() => { setDraft(removeItem(layout, item.id)); announce(`${module.name} hidden. Add it back from Add module.`); }}>×</button>
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
