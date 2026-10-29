import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useDropdown } from '../ui/useDropdown.tsx';
import { firstName, person } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { SPARK } from './AskTasks.tsx';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
import { useWorkday } from '../shifts/Workday.tsx';
import { splitFilters } from '../core/task-filters.ts';

// The top bar names the current section and carries the global search and notifications.
// Task filters (the registry lenses plus Completed) appear only inside Tasks: a short set stays
// visible, the rest sit under More, and a narrow bar uses one labeled dropdown instead.
export interface TopTab { id: string; label: string; count?: number; hot: boolean; active: boolean }

export interface TopSection { id: string; label: string; active: boolean; count?: number; hot?: boolean }

export function TopBar({ quest, demo, focused, unread, askOpen, notifOpen, title, mode, tabs, onTab, search, onAsk, onBell, onMenu, menuOpen, calendarAccess, sections, onSection, onCreate }: {
  calendarAccess?: ReactNode;
  /** The primary sections, as a top navigation. Wide screens only; phones use the tab bar. */
  sections?: TopSection[]; onSection?: (id: string) => void;
  /** The New task quick action; omitted when this person can't create work. */
  onCreate?: () => void;
  quest: Quest; demo: boolean; focused: boolean; unread: number;
  askOpen: boolean; notifOpen: boolean; /** The current section's name. */ title: string;
  /** Task filters; only passed while Tasks is the page. */ tabs?: TopTab[];
  /** Optional workspace grouping control. It does not change page availability. */
  mode?: { current: 'work' | 'manage'; onChange: (next: 'work' | 'manage') => void };
  onTab: (id: string) => void; /** The app-wide search field (TopSearch). */ search: ReactNode; onAsk: () => void; onBell: () => void; onMenu: () => void; menuOpen: boolean;
}) {
  // Side panels open below the bar, so it never moves: publish where the bar ends.
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = bar.current;
    if (!node) return;
    const publish = () => document.documentElement.style.setProperty('--topbar-h', `${node.getBoundingClientRect().bottom}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    window.addEventListener('scroll', publish, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('scroll', publish); };
  }, []);
  return (
    <header ref={bar} className={`topbar ${sections ? 'has-sections' : ''} ${tabs ? 'has-sub' : ''}`}>
      <button type="button" className="icon-btn menu-btn" aria-label="Open navigation" aria-controls="quest-sidebar" aria-expanded={menuOpen} onClick={onMenu}><TopIcon d="M4 6h16M4 12h16M4 18h16" /></button>
      {calendarAccess}
      {demo && <span className="demo-flag" title="Synthetic people and data on this device. Not company work.">Demo · synthetic</span>}
      {mode && (
        <div className="mode-switch" role="group" aria-label="Workspace">
          <button type="button" className={mode.current === 'work' ? 'is-on' : ''} aria-pressed={mode.current === 'work'} onClick={() => mode.onChange('work')}>Work</button>
          <button type="button" className={mode.current === 'manage' ? 'is-on' : ''} aria-pressed={mode.current === 'manage'} onClick={() => mode.onChange('manage')}>Manage</button>
        </div>
      )}
      <span className="topbar-title">{title}</span>
      {sections && onSection && <nav className="top-nav" aria-label="Sections">
        {sections.map(item => <button key={item.id} type="button" className={`top-nav-item ${item.active ? 'is-active' : ''}`} aria-current={item.active ? 'page' : undefined} onClick={() => onSection(item.id)}>
          {item.label}{!!item.count && <span className={item.hot ? 'is-hot' : ''}>{item.count > 99 ? '99+' : item.count}</span>}
        </button>)}
      </nav>}
      <div className="topbar-right">
        {focused && <span className="focus-chip">Critical Focus</span>}
        {/* A fixed slot: the field expands inside it (or as a popover on narrow bars), so nothing beside it moves. */}
        <div className="top-search-slot">{search}</div>
        {!focused && <button type="button" className={`top-icon ${askOpen ? 'is-on' : ''}`} aria-label="Ask your tasks" title={askOpen ? 'Close Ask your tasks drawer' : 'Open Ask your tasks drawer'} aria-controls="right-edge-drawer" data-edge="ask" aria-expanded={askOpen} onClick={onAsk}><TopIcon d={SPARK} /></button>}
        <button type="button" className={`top-icon ${notifOpen ? 'is-on' : ''}`} title={notifOpen ? 'Close notifications drawer' : 'Open notifications drawer'} aria-controls="right-edge-drawer" data-edge="updates" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={notifOpen} onClick={onBell}>
          <TopIcon d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
          {unread > 0 && <span className="rail-unread" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <UserChip quest={quest} />
        {/* New task closes the row: the primary action sits at the far right. */}
        {onCreate && <button type="button" className="btn btn-primary top-create" onClick={onCreate} title="New task (N)" aria-label="New task"><TopIcon d="M12 5v14M5 12h14" /><span>New task</span></button>}
      </div>
      {tabs && <div className="topbar-sub"><TaskFilters tabs={tabs} onTab={onTab} /></div>}
    </header>
  );
}

/** The signed-in person's initial, for the account buttons. */
export function AccountMark({ quest }: { quest: Quest }) {
  return <span className="user-chip-mark" aria-hidden="true">{firstName(quest.state, quest.actor, '?').slice(0, 1).toUpperCase()}</span>;
}

/** Live: who you are, password, workspace and sign-out. Demo: who you're working as. */
export function AccountMenu({ quest, close }: { quest: Quest; close: () => void }) {
  const live = useLive();
  const workday = useWorkday();
  const { state, actor, setActor } = quest;
  const me = person(state, actor);
  const role = live ? ROLE_LABELS[live.role] : me?.title ?? '';
  return live
    ? <>
        <p className="menu-note">{me?.name && me.name !== live.email ? <><b>{me.name}</b><br />{live.email}</> : live.email}<br />{role} of {live.org.name}</p>
        {workday && <button type="button" role="menuitem" onClick={() => { close(); workday.open(); }}>{workday.shift ? <>Check out<small>On shift since {new Date(workday.shift.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</small></> : <>Check in<small>Not on shift</small></>}</button>}
        <button type="button" role="menuitem" onClick={() => { close(); location.hash = '#/auth/reset'; }}>Change password</button>
        {live.canSwitch && <button type="button" role="menuitem" onClick={() => { close(); live.onLeaveWorkspace(); }}>{live.isPlatformAdmin ? 'Platform console' : 'Switch workspace'}</button>}
        <button type="button" role="menuitem" onClick={() => { close(); live.onSignOut(); }}>Sign out</button>
      </>
    : <>
        <p className="menu-note">Working as (demo person)</p>
        {state.people.map(item => (
          <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === actor} className={item.id === actor ? 'is-on' : ''} onClick={() => { close(); setActor(item.id); }}>
            {item.name}<small>{item.title}</small>
          </button>
        ))}
      </>;
}

/** Phones only: on wider screens the account sits at the foot of the rail. */
function UserChip({ quest }: { quest: Quest }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const { state, actor } = quest;
  const me = person(state, actor);
  const role = live ? ROLE_LABELS[live.role] : me?.title ?? '';
  return (
    <Popover open={open} setOpen={setOpen} align="end" rootClass="account-pop" triggerClass="user-chip" triggerLabel={`${me?.name ?? 'Account'} · ${role}`}
      trigger={<><AccountMark quest={quest} /><span className="user-chip-text"><b>{firstName(state, actor, 'You')}</b><small>{role}</small></span><TopIcon d="M6 9l6 6 6-6" small /></>}>
      <AccountMenu quest={quest} close={() => setOpen(false)} />
    </Popover>
  );
}

function Popover({ open, setOpen, trigger, triggerClass, triggerLabel, align = 'start', rootClass = '', children }: {
  open: boolean; setOpen: (next: boolean) => void; trigger: ReactNode; triggerClass: string; triggerLabel?: string; align?: 'start' | 'end'; rootClass?: string; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => button.current, content: () => menu.current, region: () => root.current });
  return (
    <div className={`top-pop ${rootClass}`} ref={root}>
      <button ref={button} type="button" className={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-label={triggerLabel} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div ref={menu} className={`top-menu align-${align}`} role="menu">{children}</div>}
    </div>
  );
}

function TopIcon({ d, small = false }: { d: string; small?: boolean }) {
  return <svg className={`icon ${small ? 'icon-sm' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

function TaskFilters({ tabs, onTab }: { tabs: TopTab[]; onTab: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { primary, more, activeInMore } = splitFilters(tabs);
  const tabButton = (tab: TopTab) => (
    <button key={tab.id} type="button" className={`top-tab ${tab.active ? 'is-active' : ''}`} aria-current={tab.active ? 'true' : undefined} onClick={() => onTab(tab.id)}>
      {tab.label}{tab.count !== undefined && <span className={tab.hot ? 'is-hot' : ''}>{tab.count}</span>}
    </button>
  );
  return (
    <>
      <nav className="task-filters" aria-label="Task filters">
        {primary.map(tabButton)}
        {more.length > 0 && (
          <Popover open={open} setOpen={setOpen} align="start" rootClass="filter-more" triggerClass={`top-tab filter-more-btn ${activeInMore ? 'is-active' : ''}`}
            triggerLabel={activeInMore ? `More filters, showing ${activeInMore.label}` : 'More filters'}
            trigger={<>{activeInMore ? activeInMore.label : 'More'}{activeInMore?.count !== undefined && <span className={activeInMore.hot ? 'is-hot' : ''}>{activeInMore.count}</span>}<TopIcon d="M6 9l6 6 6-6" small /></>}>
            {more.map(tab => (
              <button key={tab.id} type="button" role="menuitemradio" aria-checked={tab.active} className={tab.active ? 'is-on' : ''} onClick={() => { setOpen(false); onTab(tab.id); }}>
                {tab.label}{tab.count !== undefined && <small>{tab.count}</small>}
              </button>
            ))}
          </Popover>
        )}
      </nav>
      <label className="filter-select"><span>Filter</span>
        <select value={tabs.find(tab => tab.active)?.id ?? 'all'} onChange={event => onTab(event.target.value)}>
          {[...primary, ...more].map(tab => <option key={tab.id} value={tab.id}>{tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}</option>)}
        </select>
      </label>
    </>
  );
}
