// Persistent workspace sidebar: a 56px Instrument Rail that is always visible, plus
// a resizable pullout beside it. On desktop the pullout reflows the main content (the
// shell reserves its width) and never covers it. On mobile it is a dismissible drawer.
// The rail navigates; the pullout is live awareness (Inbox · Attention · Activity — see
// Awareness.tsx). On mobile the rail is hidden, so the drawer also carries navigation.
// Open state, width, tab, read items and snoozes are saved per person in localStorage;
// they are presentation preferences on this device, not backend records.
import { UNDER_CONSTRUCTION } from '../core/navigation.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { Snooze } from '../core/awareness.ts';
import type { Notification } from './notifications.ts';
import { useDropdown } from '../ui/useDropdown.tsx';

const MOBILE_QUERY = '(max-width: 760px)';
export const PANEL_MIN = 232;
export const PANEL_MAX = 420;
export const PANEL_DEFAULT = 288;
const READ_LIMIT = 300;
const storageKey = (actor: string) => `quest.sidebar.v1.${actor}`;

export type AwarenessTab = 'inbox' | 'attention' | 'activity';
const TABS: AwarenessTab[] = ['inbox', 'attention', 'activity'];
interface Prefs { open: boolean; width: number; read: string[]; tab: AwarenessTab; snoozes: Snooze[] }
const clampWidth = (value: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(value)));

function loadPrefs(actor: string): Prefs {
  const fallback: Prefs = { open: false, width: PANEL_DEFAULT, read: [], tab: 'inbox', snoozes: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(actor)) ?? 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      open: raw.open === true,
      width: typeof raw.width === 'number' ? clampWidth(raw.width) : PANEL_DEFAULT,
      read: Array.isArray(raw.read) ? raw.read.filter((id: unknown): id is string => typeof id === 'string') : [],
      tab: TABS.includes(raw.tab) ? raw.tab : 'inbox',
      snoozes: Array.isArray(raw.snoozes) ? raw.snoozes.filter((item: unknown): item is Snooze => !!item && typeof (item as Snooze).id === 'string' && typeof (item as Snooze).until === 'number').slice(-100) : [],
    };
  } catch { return fallback; }
}

function savePrefs(actor: string, prefs: Prefs) {
  try { localStorage.setItem(storageKey(actor), JSON.stringify(prefs)); } catch { /* storage unavailable: preferences last for this page only */ }
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export function useSidebar(actor: string) {
  const isMobile = useIsMobile();
  const [owner, setOwner] = useState(actor);
  const [prefs, setPrefs] = useState(() => loadPrefs(actor));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resizing, setResizing] = useState(false);

  // Switching the working person loads that person's own preferences.
  if (owner !== actor) { setOwner(actor); setPrefs(loadPrefs(actor)); }
  useEffect(() => { if (!isMobile) setMobileOpen(false); }, [isMobile]);

  const update = useCallback((change: (current: Prefs) => Prefs) => {
    setPrefs(current => { const next = change(current); savePrefs(actor, next); return next; });
  }, [actor]);

  const expanded = isMobile ? mobileOpen : prefs.open;
  const collapse = useCallback(() => setMobileOpen(false), []);

  return {
    isMobile,
    expanded,
    open: prefs.open,
    width: prefs.width,
    resizing,
    mobileOpen,
    read: new Set(prefs.read),
    tab: prefs.tab,
    snoozes: prefs.snoozes,
    setTab(tab: AwarenessTab) { update(current => ({ ...current, tab })); },
    /** Opens the pullout on a tab (the rail bell opens Inbox). */
    showTab(tab: AwarenessTab) {
      if (isMobile) setMobileOpen(true);
      update(current => ({ ...current, tab, open: isMobile ? current.open : true }));
    },
    snooze(id: string, until: number) { update(current => ({ ...current, snoozes: [...current.snoozes.filter(item => item.id !== id && item.until > Date.now()), { id, until }] })); },
    /** Closes the mobile drawer. The desktop panel stays as the person left it. */
    collapse,
    toggle() { if (isMobile) setMobileOpen(open => !open); else update(current => ({ ...current, open: !current.open })); },
    show() { if (isMobile) setMobileOpen(true); else update(current => (current.open ? current : { ...current, open: true })); },
    openMobile: () => setMobileOpen(true),
    closeMobile: () => setMobileOpen(false),
    afterNavigate() { if (isMobile) setMobileOpen(false); },
    setWidth(value: number, persist = true) {
      const width = clampWidth(value);
      if (persist) update(current => ({ ...current, width }));
      else setPrefs(current => ({ ...current, width }));
    },
    setResizing,
    markRead(ids: string[]) {
      update(current => {
        const missing = ids.filter(id => !current.read.includes(id));
        return missing.length ? { ...current, read: [...current.read, ...missing].slice(-READ_LIMIT) } : current;
      });
    },
    /** Inline style for the shell: reserves the panel's width so content reflows. */
    shellStyle: { '--panel-offset': !isMobile && prefs.open ? `${prefs.width}px` : '0px' } as CSSProperties,
  };
}

export type SidebarControl = ReturnType<typeof useSidebar>;

export interface SidebarItem {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number;
  hot?: boolean;
  active: boolean;
  locked: boolean;
  /** Temporarily under construction for this account: shown muted, stays focusable, never navigates. */
  restricted?: boolean;
  /** Short, role-appropriate line shown under the section in the panel. */
  info?: string;
}

function unreadIn(notes: Notification[], read: Set<string>, section?: string) {
  return notes.filter(note => (!section || note.section === section) && !read.has(note.id)).length;
}

export function Sidebar({ control, items, brand, onSelect, create, footer, notifications, awareness, settings }: {
  control: SidebarControl;
  items: SidebarItem[];
  brand: ReactNode;
  onSelect: (id: string) => void;
  create: { enabled: boolean; onCreate: () => void };
  footer: ReactNode;
  /** Task notifications, for per-section unread pips on the rail. */
  notifications: Notification[];
  /** The pullout body: Inbox · Attention · Activity. */
  awareness: ReactNode;
  /** The settings menu at the foot of the rail; `close` dismisses it after a choice. */
  settings: (close: () => void) => ReactNode;
}) {
  const { read, isMobile } = control;
  const panel = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const panelHidden = isMobile ? !control.mobileOpen : !control.open;
  // Rail labels: shown instantly on hover or keyboard focus, beside the icon. Rendered
  // outside the rail (position: fixed) so its scroll container never clips them.
  const [hint, setHint] = useState<{ label: string; detail?: string; top: number } | null>(null);
  const hintFor = (label: string, detail?: string) => ({
    onMouseEnter: (event: { currentTarget: HTMLElement }) => { const box = event.currentTarget.getBoundingClientRect(); setHint({ label, detail, top: box.top + box.height / 2 }); },
    onFocus: (event: { currentTarget: HTMLElement }) => { const box = event.currentTarget.getBoundingClientRect(); setHint({ label, detail, top: box.top + box.height / 2 }); },
    onMouseLeave: () => setHint(null),
    onBlur: () => setHint(null),
  });

  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    if (panelHidden) node.setAttribute('inert', ''); else node.removeAttribute('inert');
  }, [panelHidden]);

  useEffect(() => {
    if (isMobile && control.mobileOpen) panel.current?.querySelector<HTMLElement>('.panel-close')?.focus();
  }, [isMobile, control.mobileOpen]);

  function onResizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 48 : 16;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = control.width - step;
    else if (event.key === 'ArrowRight') next = control.width + step;
    else if (event.key === 'Home') next = PANEL_MIN;
    else if (event.key === 'End') next = PANEL_MAX;
    else if (event.key === 'Enter') next = PANEL_DEFAULT;
    if (next === null) return;
    event.preventDefault();
    control.setWidth(next);
  }

  function onResizeDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    control.setResizing(true);
  }
  function onResizeMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const rail = document.querySelector('.rail')?.getBoundingClientRect().width ?? 56;
    control.setWidth(event.clientX - rail, false);
  }
  function onResizeUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    control.setResizing(false);
    control.setWidth(control.width);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <>
      {isMobile && control.mobileOpen && <button type="button" className="scrim nav-scrim" aria-label="Close navigation" onClick={control.closeMobile} />}

      {hint && !isMobile && (
        <div className="rail-hint" aria-hidden="true" style={{ top: hint.top }}>
          <b>{hint.label}</b>{hint.detail && <small>{hint.detail}</small>}
        </div>
      )}
      <aside className="rail" aria-label="Instrument Rail">
        <div className="sidebar-brand">{brand}</div>
        <nav className="nav" aria-label="Task-HQ sections">
          {items.map(item => {
            const unread = unreadIn(notifications, read, item.id);
            // Critical Focus locking takes precedence over the temporary under-construction state.
            const muted = !item.locked && !!item.restricted;
            const name = muted ? `${item.label}, under construction` : `${item.label}${item.count ? `, ${item.count}${item.hot ? ' need attention' : ''}` : ''}${unread ? `, ${unread} unread` : ''}${item.locked ? ' — locked during Critical Focus' : ''}`;
            return (
              <button key={item.id} type="button" className={`nav-item ${item.active ? 'is-active' : ''} ${item.locked ? 'is-locked' : ''} ${muted ? 'is-restricted' : ''}`}
                disabled={item.locked} aria-disabled={muted || undefined} aria-current={item.active ? 'page' : undefined} aria-label={name}
                {...hintFor(item.label, item.locked ? 'Locked during Critical Focus' : muted ? UNDER_CONSTRUCTION : [item.info?.replace(/\.$/, ''), unread ? `${unread} unread` : ''].filter(Boolean).join(' · ') || undefined)}
                onClick={() => { setHint(null); onSelect(item.id); control.afterNavigate(); }}>
                <span className="nav-icon">
                  {item.icon}
                  {item.locked ? <i className="nav-pip is-locked" aria-hidden="true" />
                    : muted ? null
                    : unread > 0 ? <span className="rail-unread" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
                    : item.hot && <i className="nav-pip" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </nav>
        <button type="button" className="nav-create" disabled={!create.enabled} aria-label="New task"
          {...hintFor('New task', create.enabled ? 'Shortcut: N' : 'Locked during Critical Focus')} onClick={create.onCreate}>
          <span className="nav-icon" aria-hidden="true">+</span>
        </button>
        <div className="sidebar-foot">
          <RailSettings hint={hintFor('Settings', 'Account, look and workspace')}>{settings}</RailSettings>
          <button type="button" className="nav-toggle" onClick={control.toggle} aria-controls="quest-sidebar" aria-expanded={control.open}
            aria-label={control.open ? 'Collapse sidebar' : 'Expand sidebar'} {...hintFor(control.open ? 'Collapse sidebar' : 'Expand sidebar')}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={control.open ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
          </button>
        </div>
      </aside>

      <aside id="quest-sidebar" ref={panel} className="workspace-panel" aria-label="Workspace sidebar" aria-hidden={panelHidden || undefined}
        data-state={panelHidden ? 'collapsed' : 'expanded'} data-resizing={control.resizing || undefined}
        style={isMobile ? undefined : { width: control.width }}
        onKeyDown={event => { if (isMobile && event.key === 'Escape') { event.stopPropagation(); control.closeMobile(); } }}>
        <div className="panel-head">
          <span className="panel-title">Task-<b>HQ</b></span>
          <button type="button" className="icon-btn panel-close" aria-label={isMobile ? 'Close navigation' : 'Collapse sidebar'} onClick={isMobile ? control.closeMobile : control.toggle}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={isMobile ? 'M6 6l12 12M18 6 6 18' : 'M15 6l-6 6 6 6'} /></svg>
          </button>
        </div>

        <div className="panel-scroll">
          {isMobile && (
            <nav className="panel-nav" aria-label="Task-HQ sections">
              <button type="button" className="nav-create panel-create" disabled={!create.enabled} onClick={() => { create.onCreate(); control.afterNavigate(); }}>
                <span aria-hidden="true">+</span> New task
              </button>
              {items.map(item => (
                <button key={item.id} type="button" className={`${item.active ? 'is-active' : ''} ${!item.locked && item.restricted ? 'is-restricted' : ''}`} disabled={item.locked} aria-current={item.active ? 'page' : undefined}
                  aria-disabled={(!item.locked && item.restricted) || undefined} title={!item.locked && item.restricted ? UNDER_CONSTRUCTION : undefined}
                  onClick={() => { onSelect(item.id); if (!item.restricted) control.afterNavigate(); }}>
                  {item.icon}<span>{item.label}</span>
                  {!item.locked && item.restricted ? <small className="panel-soon">Under construction :)</small>
                    : item.count ? <span className={`panel-count ${item.hot ? 'is-hot' : ''}`}>{item.count}</span> : null}
                </button>
              ))}
            </nav>
          )}
          {awareness}
        </div>

        <div className="panel-foot">{footer}</div>

        {!isMobile && (
          <div className="panel-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabIndex={0}
            aria-controls="quest-sidebar" aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={control.width}
            title="Drag or use arrow keys to resize. Enter resets."
            onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp}
            onKeyDown={onResizeKey} onDoubleClick={() => control.setWidth(PANEL_DEFAULT)} />
        )}
      </aside>
    </>
  );
}

/** Settings, at the foot of the rail. The menu is fixed beside the button so the rail's scroll never clips it. */
type HintHandlers = { onMouseEnter: (event: { currentTarget: HTMLElement }) => void; onFocus: (event: { currentTarget: HTMLElement }) => void; onMouseLeave: () => void; onBlur: () => void };
function RailSettings({ hint, children }: { hint: HintHandlers; children: (close: () => void) => ReactNode }) {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);
  useDropdown({ open: !!at, onClose: close, trigger: () => button.current, content: () => menu.current });
  function toggle() {
    const box = button.current?.getBoundingClientRect();
    setAt(at || !box ? null : { left: box.right + 8, bottom: Math.max(8, window.innerHeight - box.bottom) });
  }
  return (
    <>
      <button ref={button} type="button" className={`nav-item rail-settings ${at ? 'is-active' : ''}`} aria-label="Settings" aria-haspopup="menu" aria-expanded={!!at} onClick={toggle} {...hint}>
        <span className="nav-icon">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </span>
      </button>
      {at && <div ref={menu} className="top-menu rail-settings-menu" role="menu" aria-label="Settings" style={{ left: at.left, bottom: at.bottom }}>{children(close)}</div>}
    </>
  );
}
