import { Select } from '../ui/Select.tsx';
// RIGHT ZONE — the Instrument Deck: compact operational signals, the due-date calendar
// and system insights, or collapsed when there is nothing to say. An open task is a
// full page in the canvas (TaskPage.tsx), never a side panel.
// Docked beside the canvas on wide screens (the canvas reflows); a drawer otherwise.
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { dailySignal } from '../core/executive.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { digest, dueOn, heatGrid, systemInsights } from '../core/dashboard.ts';
import type { SystemInsight } from '../core/dashboard.ts';
import { firstName, isOpen, isOverdue } from '../core/selectors.ts';
import { localDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';
import type { Notification } from './notifications.ts';
import { NOTIFICATION_LABELS } from './notifications.ts';
import { DueInput } from './TaskControls.tsx';
import { useDropdown } from '../ui/useDropdown.tsx';

export type DeckSection = 'signals' | 'calendar' | 'insights';
const DECK_SECTIONS: { id: DeckSection; label: string }[] = [{ id: 'signals', label: 'Signals' }, { id: 'calendar', label: 'Calendar' }, { id: 'insights', label: 'Insights' }];

/** Nothing selected: the Instrument Deck's contextual sections. Operational signals, the due-date
 * calendar and deterministic system insights, each linked to the work behind it. */
export function Signals({ quest, notifications, company, section, onSection, docked = true, onOpenNotification, onOpenTask, onLens, onRegistry, onClose, onExpandCalendar, onCreate }: {
  quest: Quest; notifications: Notification[]; company: boolean; section: DeckSection; onSection: (next: DeckSection) => void; docked?: boolean;
  onOpenNotification: (note: Notification) => void; onOpenTask: (id: string) => void;
  onLens: (lens: Lens, filter?: 'blocked' | 'unowned') => void; onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void; onClose: () => void;
  onExpandCalendar?: () => void; onCreate?: (due: string) => void;
}) {
  const { state, actor, now, backend } = quest;
  const [date, setDate] = useState(() => localDate(now));
  const open = state.tasks.filter(isOpen);
  const others = open.filter(task => task.owner && task.owner !== actor).length;
  const blocked = open.filter(task => task.status === 'blocked').length;
  const overdue = open.filter(task => isOverdue(task, now)).length;
  const unowned = open.filter(task => !task.owner).length;
  const sources = dailySignal(state, now).sources;
  const live = backend.kind === 'live';
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (!docked) panel.current?.querySelector<HTMLElement>('.deck-tabs [aria-selected="true"]')?.focus(); }, [docked]);
  return (
    <aside ref={panel} className={`context context-signals ${docked ? 'is-docked' : 'is-drawer'}`} role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-label="Instrument deck"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header className="context-head">
        <span className="context-label">Instrument deck</span>
        <span className={`ctx-verify ${live ? 'is-live' : ''}`} title={live ? 'Every change is checked again by the server before it is saved.' : 'Demo: every change is checked by the same rules engine, on this device.'}>{live ? 'Server-enforced' : 'Local · engine-checked'}</span>
        <button type="button" className="icon-btn" aria-label="Close instrument deck" onClick={onClose}>×</button>
      </header>
      <div className="deck-tabs" role="tablist" aria-label="Instrument deck sections">
        {DECK_SECTIONS.map(item => <button key={item.id} type="button" role="tab" id={`deck-${item.id}`} aria-selected={section === item.id} aria-controls="deck-panel" onClick={() => onSection(item.id)}>{item.label}</button>)}
      </div>
      <div className="context-body signals-body" id="deck-panel" role="tabpanel" aria-labelledby={`deck-${section}`}>
        {section === 'signals' && <>
          <section className="sig">
            <h4 className="ctx-label">Status</h4>
            <p className="sig-line"><i className={`sig-dot ${live ? 'is-live' : 'is-demo'}`} aria-hidden="true" />{live ? `Live · ${state.workspace.name}` : 'Demo · synthetic data'}</p>
            <p className="sig-note">{live ? `Revision ${state.rev}. Saved on the server; permissions checked there.` : 'Local to this device. Not company work.'}</p>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Needs you <span>{notifications.length}</span></h4>
            {notifications.length === 0 ? <p className="sig-note">Nothing is waiting on you.</p> : (
              <ul className="sig-list">{notifications.slice(0, 4).map(note => (
                <li key={note.id}><button type="button" className={`sig-item sev-${note.severity}`} onClick={() => onOpenNotification(note)}><small>{NOTIFICATION_LABELS[note.kind]}</small>{note.title}</button></li>
              ))}</ul>
            )}
          </section>
          <section className="sig">
            <h4 className="ctx-label">Moving without you</h4>
            <button type="button" className="sig-metric" onClick={() => onLens('all')}><b>{others}</b><span>open tasks owned by others</span></button>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Friction</h4>
            <div className="sig-metrics">
              <button type="button" className={`sig-metric ${blocked ? 'is-hot' : ''}`} onClick={() => onLens('all', 'blocked')}><b>{blocked}</b><span>blocked</span></button>
              <button type="button" className={`sig-metric ${overdue ? 'is-hot' : ''}`} onClick={() => onLens('overdue')}><b>{overdue}</b><span>overdue</span></button>
              <button type="button" className={`sig-metric ${unowned ? 'is-hot' : ''}`} onClick={() => onLens('all', 'unowned')}><b>{unowned}</b><span>no owner</span></button>
            </div>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Sources</h4>
            <ul className="sig-sources">{sources.map(source => <li key={source.id} title={source.note}><i className={`sig-dot ${source.status === 'connected' ? 'is-live' : ''}`} aria-hidden="true" />{source.label}<small>{source.status === 'connected' ? 'connected' : 'not connected'}</small></li>)}</ul>
          </section>
        </>}
        {section === 'calendar' && <DeckCalendar quest={quest} company={company} date={date} onDate={setDate} onOpenTask={onOpenTask} connected={sources.some(source => /calendar/i.test(source.label) && source.status === 'connected')} onExpand={onExpandCalendar} onCreate={onCreate} />}
        {section === 'insights' && <DeckInsights quest={quest} company={company} onOpenTask={onOpenTask} onRegistry={onRegistry}
          onDate={next => { setDate(next); onSection('calendar'); }} />}
      </div>
    </aside>
  );
}

/** Month or week of due dates, shaded by due-date load from records, with the chosen day's work below.
 * Hovering a day with work shows what's due; right-click (or the context-menu key) adds work to the day or moves what's due. */
export function DeckCalendar({ quest, company, date, onDate, onOpenTask, connected, variant = 'deck', onExpand, onCreate, day }: {
  quest: Quest; company: boolean; date: string; onDate: (date: string) => void; onOpenTask: (id: string) => void; connected: boolean;
  variant?: 'deck' | 'page'; onExpand?: () => void; onCreate?: (due: string) => void;
  /** Page only: the chosen day's list beside the calendar, shown on request. */
  day?: { open: boolean; setOpen: (open: boolean) => void };
}) {
  const { state, actor, now } = quest;
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [peek, setPeek] = useState<DayAt | null>(null);
  const [menu, setMenu] = useState<DayAt | null>(null);
  const today = localDate(now);
  const base = new Date(`${today}T12:00:00`), picked = new Date(`${date}T12:00:00`);
  const offset = (picked.getFullYear() - base.getFullYear()) * 12 + picked.getMonth() - base.getMonth();
  const grid = heatGrid(state, actor, now, company, offset);
  const shift = (dir: 1 | -1) => {
    const next = new Date(picked);
    if (mode === 'month') next.setMonth(next.getMonth() + dir, 1); else next.setDate(next.getDate() + dir * 7);
    onDate(localDate(next.getTime()));
  };
  const monday = new Date(picked); monday.setDate(picked.getDate() - ((picked.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, at) => { const day = new Date(monday); day.setDate(monday.getDate() + at); return localDate(day.getTime()); });
  const due = (day: string) => dueOn(state, actor, now, company, day);
  const dayTasks = due(date);
  const page = variant === 'page';
  // `day` is also the week loop's variable below.
  const pickDay = day;
  const dayEvents = (day: string, count: number) => ({
    onMouseEnter: (event: MouseEvent<HTMLElement>) => { if (count && !menu) setPeek(place(day, event.currentTarget.getBoundingClientRect())); },
    onMouseLeave: () => setPeek(null),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setPeek(null);
      onDate(day);
      setMenu(place(day, event.currentTarget.getBoundingClientRect(), { x: event.clientX, y: event.clientY }));
    },
  });
  return <>
    <section className={`sig deck-cal ${page ? 'is-page' : ''}`}>
      <div className="deck-cal-bar">
        <button type="button" className="icon-btn" aria-label={mode === 'month' ? 'Previous month' : 'Previous week'} onClick={() => shift(-1)}>‹</button>
        <strong>{mode === 'month' ? grid.label : `${dayLabel(week[0]!, { month: 'short', day: 'numeric' })} – ${dayLabel(week[6]!, { month: 'short', day: 'numeric' })}`}</strong>
        <button type="button" className="icon-btn" aria-label={mode === 'month' ? 'Next month' : 'Next week'} onClick={() => shift(1)}>›</button>
      </div>
      <div className="deck-cal-modes">
        <div className="seg" role="group" aria-label="Calendar view">
          <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month</button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Week</button>
        </div>
        <span className="deck-cal-actions">
          {date !== today && <button type="button" className="link" onClick={() => onDate(today)}>Today</button>}
          {day && <button type="button" className="btn btn-ghost btn-sm" aria-pressed={day.open} onClick={() => day.setOpen(!day.open)}>{day.open ? 'Hide day details' : 'Day details'}</button>}
          {onExpand && <button type="button" className="icon-btn deck-cal-expand" aria-label="Open the full calendar" title="Full calendar" onClick={onExpand}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>}
        </span>
      </div>
      {mode === 'month'
        ? <div className="deck-cal-grid" role="grid" aria-label={grid.label}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <div key={`d${index}`} className="dow" role="columnheader">{day}</div>)}
            {grid.cells.map((cell, index) => {
              if (!cell) return <div key={`b${index}`} aria-hidden="true" />;
              const work = page ? due(cell.date) : [];
              return <button key={cell.date} type="button" role="gridcell" className={`h${cell.heat} ${cell.today ? 'is-today' : ''} ${cell.overdue ? 'has-late' : ''}`} aria-selected={cell.date === date} aria-current={cell.today ? 'date' : undefined}
                aria-label={`${dayLabel(cell.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${cell.due ? `${cell.due} due${cell.blocked ? `, ${cell.blocked} blocked` : ''}${cell.overdue ? `, ${cell.overdue} overdue` : ''}` : 'nothing due'}`}
                onClick={() => { onDate(cell.date); pickDay?.setOpen(true); }} {...dayEvents(cell.date, cell.due)}>
                {page
                  ? <><span className="cal-num">{cell.day}</span>{work.slice(0, 3).map(task => <span key={task.id} className="cal-chip">{task.title}</span>)}{work.length > 3 && <small className="cal-more">+{work.length - 3} more</small>}</>
                  : cell.day}
              </button>;
            })}
          </div>
        : <ul className="deck-week">
            {week.map(day => {
              const work = due(day);
              return <li key={day}><button type="button" className={`${day === date ? 'is-on' : ''} ${day === today ? 'is-today' : ''}`} aria-pressed={day === date} onClick={() => { onDate(day); pickDay?.setOpen(true); }} {...dayEvents(day, work.length)}>
                <span>{dayLabel(day, { weekday: 'short' })} <b>{dayLabel(day, { day: 'numeric' })}</b></span><i style={{ ['--n' as string]: Math.min(work.length, 6) }} aria-hidden="true" /><small>{work.length ? `${work.length} due` : '—'}</small>
              </button></li>;
            })}
          </ul>}
      <p className="deck-cal-key"><span><i className="h1" /><i className="h2" /><i className="h3" /><i className="h4" /></span>Due-date load: open work due that day (blocked counts twice). Not a measure of anyone’s performance.</p>
    </section>
    {(!day || day.open) && <section className="sig deck-cal-day">
      <h4 className="ctx-label">{date === today ? 'Due today' : dayLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })} <span>{dayTasks.length}</span></h4>
      {dayTasks.length === 0 ? <p className="sig-note">Nothing {company ? '' : 'of yours '}is due this day.</p> : (
        <ul className="sig-list">{dayTasks.slice(0, page ? 30 : 8).map(task => (
          <li key={task.id}><button type="button" className={`sig-item ${task.ultra || isOverdue(task, now) ? 'sev-critical' : task.status === 'blocked' || task.priority === 'high' ? 'sev-high' : ''}`} onClick={() => onOpenTask(task.id)}>
            <small>{taskLine(quest, task)}</small>{task.title}
          </button></li>
        ))}</ul>
      )}
      <p className="sig-note">{connected ? 'Includes task due dates.' : 'Task due dates only. No calendar is connected, so meetings and events don’t appear yet.'}</p>
    </section>}
    {peek && !menu && <DayPeek quest={quest} at={peek} tasks={due(peek.date)} />}
    {menu && <DayMenu quest={quest} at={menu} tasks={due(menu.date)} onClose={() => setMenu(null)} onOpenTask={onOpenTask} onCreate={onCreate} />}
  </>;
}

/** The calendar as its own page: the same records and actions as the deck, with room for titles. */
export function CalendarPage({ quest, company, onOpenTask, onCreate }: { quest: Quest; company: boolean; onOpenTask: (id: string) => void; onCreate?: (due: string) => void }) {
  const [date, setDate] = useState(() => localDate(quest.now));
  const [dayOpen, setDayOpen] = useState(false);
  const connected = dailySignal(quest.state, quest.now).sources.some(source => /calendar/i.test(source.label) && source.status === 'connected');
  return (
    <div className="view calendar-page">
      <header className="view-head">
        <div>
          <p className="eyebrow">{company ? 'Due dates across the company' : 'Due dates on your work'}</p>
          <h1>Calendar</h1>
        </div>
        <p className="lede">Hover a day to see what’s due. Right-click a day to add work or move what’s due.</p>
      </header>
      <div className={`calendar-layout ${dayOpen ? 'is-day-open' : ''}`}>
        <DeckCalendar quest={quest} company={company} date={date} onDate={setDate} onOpenTask={onOpenTask} connected={connected} variant="page" onCreate={onCreate} day={{ open: dayOpen, setOpen: setDayOpen }} />
      </div>
    </div>
  );
}

type DayAt = { date: string; left: number; top: number };
const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', options);
const taskLine = (quest: Quest, task: Task) => [firstName(quest.state, task.owner), STATUS_LABELS[task.status], task.dueTime].filter(Boolean).join(' · ');

/** Beside the pointer for a right-click, under the day otherwise; always inside the window. */
function place(date: string, box: DOMRect, point?: { x: number; y: number }): DayAt {
  const fromPointer = !!point && (point.x > 0 || point.y > 0);
  const left = fromPointer ? point!.x : box.left, top = fromPointer ? point!.y : box.bottom + 6;
  return { date, left: Math.max(8, Math.min(left, window.innerWidth - 300)), top: Math.max(8, Math.min(top, window.innerHeight - 360)) };
}

function DayPeek({ quest, at, tasks }: { quest: Quest; at: DayAt; tasks: Task[] }) {
  return (
    <div className="cal-card cal-peek" role="tooltip" style={{ left: at.left, top: at.top }}>
      <strong>{dayLabel(at.date, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
      <ul>{tasks.slice(0, 5).map(task => <li key={task.id}>{task.title}<small>{taskLine(quest, task)}</small></li>)}</ul>
      {tasks.length > 5 && <small className="cal-more">+{tasks.length - 5} more</small>}
    </div>
  );
}

function DayMenu({ quest, at, tasks, onClose, onOpenTask, onCreate }: {
  quest: Quest; at: DayAt; tasks: Task[]; onClose: () => void; onOpenTask: (id: string) => void; onCreate?: (due: string) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  useDropdown({ open: true, onClose, trigger: () => null, content: () => card.current });
  useEffect(() => { card.current?.querySelector<HTMLElement>('button, input')?.focus(); }, []);
  return (
    <div ref={card} className="cal-card cal-menu" role="menu" aria-label={dayLabel(at.date, { weekday: 'long', month: 'long', day: 'numeric' })} style={{ left: at.left, top: at.top }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <strong>{dayLabel(at.date, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
      {onCreate && <button type="button" role="menuitem" className="cal-menu-new" onClick={() => { onClose(); onCreate(at.date); }}>+ New task due this day</button>}
      {tasks.length === 0
        ? <p className="sig-note">Nothing is due this day.</p>
        : <ul>{tasks.slice(0, 8).map(task => (
            <li key={task.id}>
              <button type="button" role="menuitem" className="cal-menu-task" onClick={() => { onClose(); onOpenTask(task.id); }}>{task.title}<small>{taskLine(quest, task)}</small></button>
              <DueInput quest={quest} task={task} overdue={isOverdue(task, quest.now)} />
            </li>
          ))}</ul>}
      {tasks.length > 8 && <small className="cal-more">+{tasks.length - 8} more in the day list</small>}
    </div>
  );
}

/** Deterministic observations plus the period digest. AI analysis, when added, joins this list and never replaces it. */
function DeckInsights({ quest, company, onOpenTask, onRegistry, onDate }: { quest: Quest; company: boolean; onOpenTask: (id: string) => void; onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void; onDate: (date: string) => void }) {
  const { state, actor, now } = quest;
  const [span, setSpan] = useState<'today' | 'week'>('week');
  const minute = Math.floor(now / 60000) * 60000;
  const items = systemInsights(state, actor, minute, company);
  const summary = digest(state, actor, minute, span, company);
  const go = (item: SystemInsight) => {
    const target = item.target;
    if (!target) return;
    if ('taskId' in target) onOpenTask(target.taskId);
    else if ('date' in target) onDate(target.date);
    else if ('lens' in target) onRegistry(target.lens, { scope: company ? 'company' : 'mine', ...(target.owner ? { owner: target.owner } : {}), ...(target.status ? { status: target.status } : {}) });
    else onRegistry('all', { scope: 'company', owner: target.owner });
  };
  return <>
    <section className="sig">
      <h4 className="ctx-label">Observations <span>{items.length}</span></h4>
      {items.length === 0 ? <p className="sig-note">No rising overdue work, concentrated assignments, repeated blockers, unassigned work or deadline clusters right now.</p> : (
        <ul className="sig-list">{items.map(item => (
          <li key={item.id}><button type="button" className={`sig-item ${item.tone === 'stop' ? 'sev-critical' : item.tone === 'warn' ? 'sev-high' : ''}`} onClick={() => go(item)} disabled={!item.target}>
            <small>{item.title}</small>{item.detail}
          </button></li>
        ))}</ul>
      )}
    </section>
    <section className="sig">
      <div className="deck-cal-modes">
        <h4 className="ctx-label">{span === 'today' ? 'Daily digest' : 'Weekly digest'}</h4>
        <div className="seg" role="group" aria-label="Digest period">
          <button type="button" aria-pressed={span === 'today'} onClick={() => setSpan('today')}>Today</button>
          <button type="button" aria-pressed={span === 'week'} onClick={() => setSpan('week')}>Week</button>
        </div>
      </div>
      <div className="deck-digest" aria-live="polite">{summary.map(line => <p key={line}>{line}</p>)}</div>
    </section>
    <p className="sig-note">Rules over Task-HQ records{company ? '' : ' you’re part of'}. Counts describe work, not people’s performance.</p>
  </>;
}

/** Whether the signals panel has anything worth showing. */
export function hasSignals(quest: Quest, notifications: Notification[]) {
  const { state, now } = quest;
  return notifications.length > 0 || state.tasks.some(task => isOpen(task) && (task.status === 'blocked' || isOverdue(task, now) || !task.owner));
}
