// Navigation dock (the default; `?nav=classic` rolls back): the one primary navigation, on every screen size.
// Exactly five destinations — Tasks, Projects, HOME (the centre anchor), Calendar, Inbox.
// One adaptive surface (see ui/nav-dock.css): a compact floating capsule when the work area is spacious,
// widening into flush, integrated bottom navigation as room shrinks. In the capsule, with a fine pointer,
// icons magnify with pointer proximity (neighbours a little) and spring back. Touch: steady, no hover.
// It owns no navigation state: items, counts and actions come from the app's one `navigation` list.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';

export interface DockItem { id: string; label: string; icon: ReactNode; count?: number; countLabel?: string; hot?: boolean; active: boolean }

/** Pointer distance (px) over which neighbours respond, and the largest scale (Home grows less: it is already larger). */
const RANGE = 120, MAX = 1.34, MAX_HOME = 1.14;
const FINE = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

export function NavDock({ items, onSelect, mobile }: {
  /** In order; the item with id `home` is the anchor. */
  items: DockItem[];
  onSelect: (id: string) => void;
  mobile: boolean;
}) {
  const bar = useRef<HTMLUListElement>(null);
  const frame = useRef(0);
  const [magnify, setMagnify] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(FINE).matches);
  useEffect(() => {
    const query = matchMedia(FINE);
    const change = () => setMagnify(query.matches);
    query.addEventListener('change', change);
    return () => { query.removeEventListener('change', change); cancelAnimationFrame(frame.current); };
  }, []);
  const active = magnify && !mobile;
  // Size the dock from the page column's real width (not 100vw, which includes a visible scrollbar).
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const shell = nav.current?.closest<HTMLElement>('.shell'), main = shell?.querySelector<HTMLElement>(':scope > .main');
    if (!shell || !main) return;
    const measure = () => {
      const box = main.getBoundingClientRect();
      const left = box.left, width = main.clientWidth;
      shell.style.setProperty('--nd-avail', `${width}px`);
      shell.style.setProperty('--nd-center', `${left + width / 2}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); shell.style.removeProperty('--nd-avail'); shell.style.removeProperty('--nd-center'); };
  }, [mobile]);

  // Scale each tile by how close the pointer is to its centre (a smooth cosine falloff).
  function track(event: PointerEvent<HTMLUListElement>) {
    // Magnify only in the compact capsule; the integrated (wide) bar stays steady.
    if (!active || event.pointerType !== 'mouse' || (bar.current?.offsetWidth ?? 0) > 480) return;
    const x = event.clientX;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      for (const tile of bar.current?.querySelectorAll<HTMLElement>('.nd-tile') ?? []) {
        const box = tile.getBoundingClientRect();
        const distance = Math.abs(x - (box.left + box.width / 2));
        const near = distance >= RANGE ? 0 : Math.cos((distance / RANGE) * (Math.PI / 2));
        const max = tile.closest('.nd-home') ? MAX_HOME : MAX;
        tile.style.setProperty('--nd-scale', (1 + (max - 1) * near).toFixed(3));
      }
    });
  }
  function rest() {
    cancelAnimationFrame(frame.current);
    for (const tile of bar.current?.querySelectorAll<HTMLElement>('.nd-tile') ?? []) tile.style.removeProperty('--nd-scale');
  }
  // Arrow keys move between destinations (Tab still reaches each one).
  function keys(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = [...(bar.current?.querySelectorAll<HTMLButtonElement>('.nd-item') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = event.key === 'ArrowRight' ? (at + 1) % buttons.length : event.key === 'ArrowLeft' ? (at - 1 + buttons.length) % buttons.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    buttons[to]!.focus();
  }

  return (
    <nav ref={nav} className={`nav-dock ${mobile ? 'is-mobile' : 'is-float'} ${active ? 'can-magnify' : ''}`} aria-label="Primary">
      <ul ref={bar} className="nd-bar" onPointerMove={track} onPointerLeave={rest} onKeyDown={keys}>
        {items.map(item => {
          const home = item.id === 'home';
          const badge = item.id === 'inbox' && item.count ? (item.count > 99 ? '99+' : String(item.count)) : '';
          return (
            <li key={item.id} className={home ? 'nd-home' : undefined}>
              <button type="button" className={`nd-item ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined}
                aria-label={item.count && item.id === 'inbox' ? `${item.label}, ${item.count} ${item.countLabel ?? ''}`.trim() : item.label}
                onClick={() => { rest(); onSelect(item.id); }}>
                <span className="nd-tile" aria-hidden="true">{item.icon}{badge && <b className={`nd-badge ${item.hot ? 'is-hot' : ''}`}>{badge}</b>}</span>
                <span className="nd-label" aria-hidden="true">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
