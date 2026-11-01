// Navigation dock (preview, `?nav=dock`): one persistent primary navigation for every screen size.
// Wide screens: a floating dock centred on the work area — labelled icons with a gentle hover lift,
// Home as the centre anchor, then Collaboration (opens the existing communications panel) and More.
// Phones: the same items as a full-width bottom bar with visible labels and safe-area padding.
// It owns no navigation state: items, counts and actions come from the app's one `navigation` list.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface DockItem { id: string; label: string; icon: ReactNode; count?: number; countLabel?: string; hot?: boolean; active: boolean }

export function NavDock({ left, home, right, more, onSelect, collab, mobile }: {
  left: DockItem[]; home?: DockItem; right: DockItem[];
  /** Secondary destinations, listed in the More menu. */
  more: DockItem[];
  onSelect: (id: string) => void;
  /** The communications panel (wide screens, on routes that have it). */
  collab?: { open: boolean; unread: number; onToggle: () => void };
  mobile: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); root.current?.querySelector<HTMLElement>('.nd-more')?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [menu]);
  const go = (id: string) => { setMenu(false); onSelect(id); };
  const moreActive = more.some(item => item.active);
  const moreHot = more.some(item => item.hot);

  const button = (item: DockItem, anchor = false) => (
    <li key={item.id}>
      <button type="button" className={`nd-item ${anchor ? 'nd-home' : ''} ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined}
        aria-label={item.count ? `${item.label}, ${item.count} ${item.countLabel ?? ''}`.trim() : item.label} onClick={() => go(item.id)}>
        <span className="nd-icon">{item.icon}{item.count && item.id === 'inbox' ? <b className={`nd-badge ${item.hot ? 'is-hot' : ''}`}>{item.count > 99 ? '99+' : item.count}</b> : null}</span>
        <span className="nd-label">{item.label}</span>
      </button>
    </li>
  );

  return (
    <nav ref={root} className={`nav-dock ${mobile ? 'is-mobile' : 'is-float'}`} aria-label="Primary">
      <ul className="nd-bar">
        {left.map(item => button(item))}
        {home && button(home, true)}
        {right.map(item => button(item))}
        {!mobile && <li className="nd-sep" aria-hidden="true" />}
        {collab && <li>
          <button type="button" className={`nd-item ${collab.open ? 'is-active' : ''}`} aria-pressed={collab.open} aria-controls="collab-dock"
            aria-label={`Collaboration${collab.unread ? `, ${collab.unread} unread` : ''}`} onClick={() => { setMenu(false); collab.onToggle(); }}>
            <span className="nd-icon"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></svg>{collab.unread ? <i className="nd-dot" /> : null}</span>
            <span className="nd-label">Collab</span>
          </button>
        </li>}
        {more.length > 0 && <li className="nd-more-wrap">
          <button type="button" className={`nd-item nd-more ${moreActive ? 'is-active' : ''} ${menu ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={menu} aria-controls="nd-more-menu" onClick={() => setMenu(open => !open)}>
            <span className="nd-icon"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>{moreHot ? <i className="nd-dot" /> : null}</span>
            <span className="nd-label">More</span>
          </button>
          {menu && <div id="nd-more-menu" className="nd-menu" role="menu" aria-label="More destinations">
            {more.map(item => <button key={item.id} type="button" role="menuitem" className={item.active ? 'is-active' : ''} onClick={() => go(item.id)}>
              <span className="nd-icon">{item.icon}</span><span>{item.label}</span>{item.count ? <small className={item.hot ? 'is-hot' : ''}>{item.count}</small> : null}
            </button>)}
          </div>}
        </li>}
      </ul>
    </nav>
  );
}
