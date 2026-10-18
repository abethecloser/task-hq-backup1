// Persistent workspace sidebar: a 56px Instrument Rail that is always visible, plus
// a resizable secondary panel beside it. On desktop the panel reflows the main
// content (the shell reserves its width) and never covers it. On mobile the panel
// is a dismissible drawer. Open state, width and read notifications are saved per
// person in localStorage; they are presentation preferences, not backend records.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { NOTIFICATION_LABELS } from './notifications.ts';
import type { Notification, NotificationSection } from './notifications.ts';

const MOBILE_QUERY = '(max-width: 760px)';
export const PANEL_MIN = 232;
export const PANEL_MAX = 420;
export const PANEL_DEFAULT = 288;
const READ_LIMIT = 300;
const storageKey = (actor: string) => `quest.sidebar.v1.${actor}`;

interface Prefs { open: boolean; width: number; read: string[] }
const clampWidth = (value: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(value)));

function loadPrefs(actor: string): Prefs {
  const fallback: Prefs = { open: false, width: PANEL_DEFAULT, read: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(actor)) ?? 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      open: raw.open === true,
      width: typeof raw.width === 'number' ? clampWidth(raw.width) : PANEL_DEFAULT,
      read: Array.isArray(raw.read) ? raw.read.filter((id: unknown): id is string => typeof id === 'string') : [],
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
  /** Short, role-appropriate line shown under the section in the panel. */
  info?: string;
}

type PanelSection = NotificationSection | 'all-tasks' | 'company-work';
const PANEL_SECTIONS: { id: PanelSection; label: string }[] = [
  { id: 'my-work', label: 'My Work' },
  { id: 'all-tasks', label: 'All Tasks' },
  { id: 'needs-attention', label: 'Needs Attention' },
  { id: 'leads', label: 'Speed to Lead' },
  { id: 'executive', label: 'Executive Desk' },
  { id: 'company-work', label: 'Company Work' },
];
const NOTES_SHOWN = 4;

function unreadIn(notes: Notification[], read: Set<string>, section?: string) {
  return notes.filter(note => (!section || note.section === section) && !read.has(note.id)).length;
}

function Badge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return <span className="unread-badge" role="img" aria-label={`${count} unread in ${label}`}>{count > 99 ? '99+' : count}</span>;
}

export function Sidebar({ control, items, brand, onSelect, create, footer, notifications, executive, executiveInfo, onOpenNotification }: {
  control: SidebarControl;
  items: SidebarItem[];
  brand: ReactNode;
  onSelect: (id: string) => void;
  create: { enabled: boolean; onCreate: () => void };
  footer: ReactNode;
  notifications: Notification[];
  /** Whether this person has an Executive Desk (decision authority). */
  executive: boolean;
  executiveInfo: string;
  onOpenNotification: (note: Notification) => void;
}) {
  const { read, isMobile } = control;
  const panel = useRef<HTMLElement>(null);
  const notesHeading = useRef<HTMLHeadingElement>(null);
  const dragging = useRef(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const totalUnread = unreadIn(notifications, read);
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

  const itemById = new Map(items.map(item => [item.id, item]));
  const moreItems = items.filter(item => !PANEL_SECTIONS.some(section => section.id === item.id));

  function openNote(note: Notification) {
    control.markRead([note.id]);
    onOpenNotification(note);
    control.afterNavigate();
  }

  function focusNotifications() {
    control.show();
    requestAnimationFrame(() => notesHeading.current?.focus());
  }

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

  function renderNotes(section: PanelSection) {
    const notes = notifications.filter(note => note.section === section);
    if (!notes.length) return null;
    const expandedList = showAll[section] || notes.length <= NOTES_SHOWN;
    const shown = expandedList ? notes : notes.slice(0, NOTES_SHOWN);
    return (
      <ul className="note-list">
        {shown.map(note => {
          const unread = !read.has(note.id);
          return (
            <li key={note.id}>
              <button type="button" className={`note-item sev-${note.severity} ${unread ? 'is-unread' : ''}`} onClick={() => openNote(note)}>
                <span className="note-kind">
                  <i className="note-dot" aria-hidden="true" />
                  {NOTIFICATION_LABELS[note.kind]}
                  <em className={unread ? 'note-state is-new' : 'note-state'}>{unread ? 'Unread' : 'Open'}</em>
                </span>
                <span className="note-title">{note.title}</span>
                <span className="note-detail">{note.detail}</span>
              </button>
            </li>
          );
        })}
        {notes.length > NOTES_SHOWN && (
          <li><button type="button" className="note-more" aria-expanded={expandedList} onClick={() => setShowAll(current => ({ ...current, [section]: !expandedList }))}>
            {expandedList ? 'Show fewer' : `Show ${notes.length - NOTES_SHOWN} more`}
          </button></li>
        )}
      </ul>
    );
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
            const name = `${item.label}${item.count ? `, ${item.count}${item.hot ? ' need attention' : ''}` : ''}${unread ? `, ${unread} unread` : ''}${item.locked ? ' — locked during Critical Focus' : ''}`;
            return (
              <button key={item.id} type="button" className={`nav-item ${item.active ? 'is-active' : ''} ${item.locked ? 'is-locked' : ''}`}
                disabled={item.locked} aria-current={item.active ? 'page' : undefined} aria-label={name}
                {...hintFor(item.label, item.locked ? 'Locked during Critical Focus' : [item.info?.replace(/\.$/, ''), unread ? `${unread} unread` : ''].filter(Boolean).join(' · ') || undefined)}
                onClick={() => { setHint(null); onSelect(item.id); control.afterNavigate(); }}>
                <span className="nav-icon">
                  {item.icon}
                  {item.locked ? <i className="nav-pip is-locked" aria-hidden="true" />
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
          <button type="button" className="nav-item rail-bell" onClick={focusNotifications}
            aria-label={`Notifications${totalUnread ? `, ${totalUnread} unread` : ''}`} {...hintFor('Notifications', totalUnread ? `${totalUnread} unread` : 'All read')}>
            <span className="nav-icon">
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4" /></svg>
              {totalUnread > 0 && <span className="rail-unread" aria-hidden="true">{totalUnread > 9 ? '9+' : totalUnread}</span>}
            </span>
          </button>
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
          <section className="panel-notes" aria-labelledby="quest-notes-title">
            <div className="panel-notes-head">
              <h2 id="quest-notes-title" ref={notesHeading} tabIndex={-1}>Notifications</h2>
              <button type="button" className="link" disabled={!totalUnread} onClick={() => control.markRead(notifications.map(note => note.id))}>Mark all read</button>
            </div>
            <p className="panel-summary" aria-live="polite"><b>{totalUnread}</b> unread · <b>{notifications.length}</b> unresolved</p>
            {!notifications.length && <p className="panel-empty">Nothing is waiting on you.</p>}
          </section>

          {isMobile && (
            <button type="button" className="nav-create panel-create" disabled={!create.enabled} onClick={() => { create.onCreate(); control.afterNavigate(); }}>
              <span aria-hidden="true">+</span> New task
            </button>
          )}

          {PANEL_SECTIONS.map(section => {
            if (section.id === 'executive' && !executive) return null;
            const item = itemById.get(section.id);
            if (section.id !== 'executive' && !item) return null;
            const unread = unreadIn(notifications, read, section.id);
            const head = (
              <>
                <span className="panel-section-name">{section.label}</span>
                <Badge count={unread} label={section.label} />
                {item?.count !== undefined && !item.locked && <span className={`panel-count ${item.hot ? 'is-hot' : ''}`}>{item.count}</span>}
              </>
            );
            return (
              <section key={section.id} className="panel-section" aria-label={section.label}>
                {item
                  ? <button type="button" className={`panel-section-head ${item.active ? 'is-active' : ''}`} disabled={item.locked} aria-current={item.active ? 'page' : undefined}
                      onClick={() => { onSelect(item.id); control.afterNavigate(); }}>{head}</button>
                  : <div className="panel-section-head is-static">{head}</div>}
                <p className="panel-info">{item ? (item.locked ? 'Locked during Critical Focus.' : item.info) : executiveInfo}</p>
                {renderNotes(section.id)}
              </section>
            );
          })}

          {moreItems.length > 0 && (
            <nav className="panel-more" aria-label="More">
              {moreItems.map(item => (
                <button key={item.id} type="button" className={item.active ? 'is-active' : ''} disabled={item.locked} aria-current={item.active ? 'page' : undefined}
                  onClick={() => { onSelect(item.id); control.afterNavigate(); }}>
                  {item.icon}<span>{item.label}</span>
                  {item.count ? <span className="panel-count">{item.count}</span> : null}
                </button>
              ))}
            </nav>
          )}
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
