import { useRef, useState } from 'react';
import { UNDER_CONSTRUCTION } from '../core/navigation.ts';
import type { ReactNode } from 'react';
import { useDropdown } from '../ui/useDropdown.tsx';
import { firstName, person } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { SPARK } from './AskTasks.tsx';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';

// Primary destinations share one persistent, horizontally scrollable navigation.
// Task tabs reuse the registry lenses; other destinations keep their existing routes.
export interface TopTab { id: string; label: string; count?: number; hot: boolean; active: boolean; allowed: boolean; restricted?: boolean }

export function TopBar({ quest, demo, focused, unread, askOpen, tabs, onTab, onSearch, searchOpen = true, onAsk, onBell, onMenu, menuOpen }: {
  quest: Quest; demo: boolean; focused: boolean; unread: number;
  askOpen: boolean; tabs: TopTab[];
  onTab: (id: string) => void; onSearch: (text: string) => void; /** False while Search is under construction for this account. */ searchOpen?: boolean; onAsk: () => void; onBell: () => void; onMenu: () => void; menuOpen: boolean;
}) {
  const [query, setQuery] = useState('');
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" aria-label="Open navigation" aria-controls="quest-sidebar" aria-expanded={menuOpen} onClick={onMenu}><TopIcon d="M4 6h16M4 12h16M4 18h16" /></button>
      {demo && <span className="demo-flag" title="Synthetic people and data on this device. Not company work.">Demo · synthetic</span>}
      <nav className="top-nav top-tabs" aria-label="Primary navigation" tabIndex={0}>
        {tabs.map(tab => (
          <button key={tab.id} type="button" className={`top-tab ${tab.active ? 'is-active' : ''} ${tab.restricted ? 'is-restricted' : ''}`} aria-current={tab.active ? 'page' : undefined} disabled={!tab.allowed}
            aria-disabled={tab.restricted || undefined} aria-label={tab.restricted ? `${tab.label}, under construction` : undefined} title={tab.restricted ? UNDER_CONSTRUCTION : undefined} onClick={() => onTab(tab.id)}>
            {tab.label}{tab.count !== undefined && !tab.restricted && <span className={tab.hot ? 'is-hot' : ''}>{tab.count}</span>}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        {focused && <span className="focus-chip">Critical Focus</span>}
        <form className={`search-field top-search ${searchOpen ? '' : 'is-restricted'}`} role="search" title={searchOpen ? undefined : UNDER_CONSTRUCTION} onSubmit={event => { event.preventDefault(); if (query.trim()) { onSearch(query.trim()); setQuery(''); } }}>
          <TopIcon d="M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={searchOpen ? 'Search tasks, people, projects' : 'Search · under construction :)'} aria-label={searchOpen ? 'Search' : 'Search, under construction'} />
        </form>
        {!focused && <button type="button" className={`top-icon ${askOpen ? 'is-on' : ''}`} aria-label="Ask your tasks" aria-expanded={askOpen} onClick={onAsk}><TopIcon d={SPARK} /></button>}
        <button type="button" className="top-icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={onBell}>
          <TopIcon d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
          {unread > 0 && <span className="rail-unread" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
        </button>
        <UserChip quest={quest} />
      </div>
    </header>
  );
}

/** Demo: who you're working as. Live: workspace and sign-out. */
function UserChip({ quest }: { quest: Quest }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const { state, actor, setActor } = quest;
  const me = person(state, actor);
  const role = live ? ROLE_LABELS[live.role] : me?.title ?? '';
  return (
    <Popover open={open} setOpen={setOpen} align="end" triggerClass="user-chip" triggerLabel={`${me?.name ?? 'Account'} · ${role}`}
      trigger={<><span className="user-chip-mark" aria-hidden="true">{firstName(state, actor, '?').slice(0, 1).toUpperCase()}</span><span className="user-chip-text"><b>{firstName(state, actor, 'You')}</b><small>{role}</small></span><TopIcon d="M6 9l6 6 6-6" small /></>}>
      {live
        ? <>
            <p className="menu-note">{live.email}<br />{role} of {live.org.name}</p>
            {live.canSwitch && <button type="button" role="menuitem" onClick={() => { setOpen(false); live.onLeaveWorkspace(); }}>{live.isPlatformAdmin ? 'Platform console' : 'Switch workspace'}</button>}
            <button type="button" role="menuitem" onClick={() => { setOpen(false); live.onSignOut(); }}>Sign out</button>
          </>
        : <>
            <p className="menu-note">Working as (demo person)</p>
            {state.people.map(item => (
              <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === actor} className={item.id === actor ? 'is-on' : ''} onClick={() => { setOpen(false); setActor(item.id); }}>
                {item.name}<small>{item.title}</small>
              </button>
            ))}
          </>}
    </Popover>
  );
}

function Popover({ open, setOpen, trigger, triggerClass, triggerLabel, align = 'start', children }: {
  open: boolean; setOpen: (next: boolean) => void; trigger: ReactNode; triggerClass: string; triggerLabel?: string; align?: 'start' | 'end'; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDropdown({ open, onClose: () => setOpen(false), trigger: () => button.current, content: () => menu.current, region: () => root.current });
  return (
    <div className="top-pop" ref={root}>
      <button ref={button} type="button" className={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-label={triggerLabel} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div ref={menu} className={`top-menu align-${align}`} role="menu">{children}</div>}
    </div>
  );
}

function TopIcon({ d, small = false }: { d: string; small?: boolean }) {
  return <svg className={`icon ${small ? 'icon-sm' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}
