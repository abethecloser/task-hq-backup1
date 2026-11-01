// Team overview (management): one card per workspace member — role, activity status, open /
// completed / due-soon counts, last completed and next expected action — and a detail panel with
// Overview, Activity, Work, Upcoming and Needs Attention. Everything is read from existing people,
// task and event records (core/team.ts); task rows open the task itself, so its own permissions apply.
// Access is decided by the caller (canSeeTeamOverview); this page never widens what the viewer's data holds.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import type { Task } from '../core/contract.ts';
import { ago } from '../core/dashboard.ts';
import { projectName } from '../core/selectors.ts';
import { COMPLETED_DAYS, DUE_SOON_DAYS, filterTeam, memberActivity, memberUpcoming, memberWork, teamCounts, teamOverview } from '../core/team.ts';
import type { MemberSummary, TeamFilter } from '../core/team.ts';
import { localDate, shortDate } from '../core/time.ts';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';

const FILTERS: { id: TeamFilter; label: string }[] = [
  { id: 'active', label: 'Active' }, { id: 'all', label: 'All' }, { id: 'attention', label: 'Needs Attention' }, { id: 'inactive', label: 'Inactive' },
];
type Tab = 'overview' | 'activity' | 'work' | 'upcoming' | 'attention';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity' }, { id: 'work', label: 'Work' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'attention', label: 'Needs Attention' },
];
const STAGE_ORDER = [['working', 'In progress'], ['review', 'In review'], ['blocked', 'Blocked'], ['ready', 'Not started']] as const;
const AUTHORITY: Record<string, string> = { owner: 'Owner', admin: 'Admin', supervisor: 'Supervisor', member: 'Member', reviewer: 'Reviewer' };
/** The panel sits beside the cards from this page width; below it opens as a sheet. */
const SIDE_PANEL_MIN = 1040;

export function Team({ quest, onOpenTask, onManagePeople }: { quest: Quest; onOpenTask: (id: string) => void; onManagePeople?: () => void }) {
  const { state, now } = quest;
  const team = useMemo(() => teamOverview(state, now), [state, now]);
  const counts = teamCounts(team);
  const [filter, setFilter] = useState<TeamFilter>(() => (counts.active ? 'active' : 'all'));
  const shown = filterTeam(team, filter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= SIDE_PANEL_MIN));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Beside the cards, the panel always shows someone (the first card until one is chosen).
  const selected = team.find(member => member.person.id === selectedId) ?? (wide ? shown[0] ?? null : null);
  const panelOpen = !!selected && (wide || sheetOpen);
  const choose = (id: string) => { setSelectedId(id); setSheetOpen(true); };

  return (
    <div ref={root} className={`view tm ${wide ? 'is-wide' : 'is-narrow'}`}>
      <header className="view-head tm-head">
        <div>
          <p className="tm-lede">People, activity and operational visibility.</p>
          <div className="tm-filters" role="group" aria-label="Show">
            {FILTERS.map(item => <button key={item.id} type="button" className={`tm-filter ${filter === item.id ? 'is-on' : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}<b>{counts[item.id]}</b>
            </button>)}
          </div>
        </div>
        {onManagePeople && <button type="button" className="btn btn-primary tm-manage" onClick={onManagePeople}>Manage people<svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>}
      </header>

      <div className="tm-body">
        {shown.length === 0
          ? <p className="hd-quiet tm-empty">{filter === 'attention' ? 'No one has overdue, blocked or waiting work right now.' : filter === 'inactive' ? `Everyone has open work or recent activity in the last 14 days.` : 'No people in this view.'}</p>
          : <ul className="tm-grid" aria-label="Team members">
            {shown.map(member => <li key={member.person.id}><MemberCard quest={quest} member={member} selected={panelOpen && selected?.person.id === member.person.id} onSelect={() => choose(member.person.id)} /></li>)}
          </ul>}
        {panelOpen && selected && <>
          {!wide && <button type="button" className="tm-scrim" aria-label="Close details" onClick={() => setSheetOpen(false)} />}
          <MemberPanel key={selected.person.id} quest={quest} member={selected} sheet={!wide} onClose={() => setSheetOpen(false)} onOpenTask={onOpenTask} />
        </>}
      </div>
    </div>
  );
}

function MemberCard({ quest, member, selected, onSelect }: { quest: Quest; member: MemberSummary; selected: boolean; onSelect: () => void }) {
  const { state, now } = quest;
  const today = localDate(now);
  const { person } = member;
  const next = member.nextUp;
  return (
    <button type="button" className={`tm-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} aria-label={`${person.name}, ${person.title}. ${member.active ? 'Active' : 'Inactive'}. ${member.open} open, ${member.completed} completed in ${COMPLETED_DAYS} days, ${member.dueSoon} due soon${member.attention.length ? `, ${member.attention.length} need attention` : ''}.`} onClick={onSelect}>
      <span className="tm-card-top">
        <Avatar state={state} id={person.id} size="lg" />
        <span className="tm-who"><strong>{person.name}</strong><small>{person.title || person.role}</small></span>
        <span className={`tm-status ${member.active ? 'is-active' : 'is-inactive'}`}>{member.active ? 'Active' : 'Inactive'}</span>
      </span>
      <span className="tm-stats" aria-hidden="true">
        <span title="Open tasks they own"><svg className="icon" viewBox="0 0 24 24"><path d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /></svg><b>{member.open}</b> Open</span>
        <span title={`Completed in the last ${COMPLETED_DAYS} days`}><svg className="icon" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg><b>{member.completed}</b> Completed</span>
        <span title={`Due in the next ${DUE_SOON_DAYS} days`}><svg className="icon" viewBox="0 0 24 24"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /></svg><b>{member.dueSoon}</b> Due soon</span>
      </span>
      {member.attention.length > 0 && <span className="tm-flag" aria-hidden="true">{member.overdue ? `${member.overdue} overdue · ` : ''}{member.attention.length} need{member.attention.length === 1 ? 's' : ''} attention</span>}
      <span className="tm-line"><small>Last completed</small><span>{member.lastCompleted ? <>{member.lastCompleted.title} <em>· {ago(member.lastCompleted.completedAt!, now)}</em></> : <em>Nothing completed yet</em>}</span></span>
      <span className="tm-line"><small>Next up</small><span>{next ? <>{next.nextAction || next.title}{next.due ? <em className={next.due < today ? 'is-late' : ''}> · {next.due < today ? 'overdue' : `due ${shortDate(next.due, today)}`}</em> : null}</> : <em>No open work</em>}</span></span>
      <StageBar member={member} />
    </button>
  );
}

/** Their open tasks by stage — real counts, not a capacity score. */
function StageBar({ member }: { member: MemberSummary }) {
  if (!member.open) return <span className="tm-bar is-empty" aria-hidden="true" />;
  return (
    <span className="tm-bar" aria-hidden="true" title={STAGE_ORDER.filter(([key]) => member.stages[key]).map(([key, label]) => `${member.stages[key]} ${label.toLowerCase()}`).join(' · ')}>
      {STAGE_ORDER.map(([key]) => member.stages[key] ? <i key={key} className={`s-${key}`} style={{ flexGrow: member.stages[key] }} /> : null)}
    </span>
  );
}

function MemberPanel({ quest, member, sheet, onClose, onOpenTask }: { quest: Quest; member: MemberSummary; sheet: boolean; onClose: () => void; onOpenTask: (id: string) => void }) {
  const { state, now } = quest;
  const { person } = member;
  const [tab, setTab] = useState<Tab>('overview');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!sheet) return;
    panel.current?.querySelector<HTMLElement>('.tm-close')?.focus();
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [sheet, onClose]);
  function tabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex(item => item.id === tab);
    const to = event.key === 'ArrowRight' ? (at + 1) % TABS.length : event.key === 'ArrowLeft' ? (at - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    setTab(TABS[to]!.id);
    panel.current?.querySelector<HTMLElement>(`#tm-tab-${TABS[to]!.id}`)?.focus();
  }

  return (
    <aside ref={panel} className={`tm-panel ${sheet ? 'is-sheet' : ''}`} aria-label={`${person.name} details`} role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined}>
      <header className="tm-panel-head">
        <Avatar state={state} id={person.id} size="lg" />
        <div><h2>{person.name}</h2><p>{person.title || person.role}{person.authority ? ` · ${AUTHORITY[person.authority]}` : ''}</p></div>
        {sheet && <button type="button" className="icon-btn tm-close" aria-label="Close details" onClick={onClose}>×</button>}
      </header>
      <div className="tm-tabs" role="tablist" aria-label={`${person.name}`} onKeyDown={tabKeys}>
        {TABS.map(item => <button key={item.id} id={`tm-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="tm-tabpanel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>
          {item.label}{item.id === 'attention' && member.attention.length ? <b>{member.attention.length}</b> : null}
        </button>)}
      </div>
      <div id="tm-tabpanel" role="tabpanel" aria-labelledby={`tm-tab-${tab}`} className="tm-tabpanel">
        {tab === 'overview' && <Overview quest={quest} member={member} onOpenTask={onOpenTask} />}
        {tab === 'activity' && <ActivityTab quest={quest} id={person.id} onOpenTask={onOpenTask} />}
        {tab === 'work' && <WorkTab quest={quest} id={person.id} onOpenTask={onOpenTask} />}
        {tab === 'upcoming' && <UpcomingTab quest={quest} id={person.id} onOpenTask={onOpenTask} />}
        {tab === 'attention' && (member.attention.length === 0
          ? <p className="hd-quiet">Nothing overdue, blocked or waiting on {person.name.split(' ')[0]}.</p>
          : <ul className="tm-tasks">{member.attention.map(({ task, reason }) => <TaskRow key={`${task.id}:${reason}`} quest={quest} task={task} tag={reason} hot={reason === 'Overdue' || reason === 'Blocked'} onOpen={onOpenTask} />)}</ul>)}
      </div>
    </aside>
  );
}

function Overview({ quest, member, onOpenTask }: { quest: Quest; member: MemberSummary; onOpenTask: (id: string) => void }) {
  const { state, now } = quest;
  const focus = member.nextUp;
  const projects = memberWork(state, member.person.id, now).map(group => ({ id: group.projectId, name: projectName(state, group.projectId) || 'No project', count: group.tasks.length }));
  return <>
    <section className="tm-block">
      <h3>Current focus</h3>
      {focus ? <button type="button" className="tm-focus" onClick={() => onOpenTask(focus.id)}><strong>{focus.nextAction || focus.title}</strong><small>{focus.nextAction ? `${focus.title} · ` : ''}{STATUS_LABELS[focus.status]}{focus.projectId ? ` · ${projectName(state, focus.projectId)}` : ''}</small></button>
        : <p className="hd-quiet">No open work assigned.</p>}
    </section>
    <section className="tm-block">
      <h3>Responsibilities</h3>
      <dl className="tm-facts">
        <div><dt>Open</dt><dd>{member.open}</dd></div>
        {STAGE_ORDER.map(([key, label]) => <div key={key}><dt><i className={`s-${key}`} aria-hidden="true" />{label}</dt><dd>{member.stages[key]}</dd></div>)}
        <div><dt>Due in {DUE_SOON_DAYS} days</dt><dd>{member.dueSoon}</dd></div>
        <div><dt>Overdue</dt><dd className={member.overdue ? 'is-late' : ''}>{member.overdue}</dd></div>
        <div><dt>Completed · {COMPLETED_DAYS} days</dt><dd>{member.completed}</dd></div>
      </dl>
    </section>
    {projects.length > 0 && <section className="tm-block"><h3>Projects</h3><ul className="tm-chips">{projects.map(item => <li key={item.id || 'none'}>{item.name}<b>{item.count}</b></li>)}</ul></section>}
    <p className="tm-meta">{member.lastActivityAt ? `Last activity ${ago(member.lastActivityAt, now)}` : 'No recorded activity yet'}{member.lastCompleted ? ` · last completed “${member.lastCompleted.title}”` : ''}</p>
  </>;
}

function ActivityTab({ quest, id, onOpenTask }: { quest: Quest; id: string; onOpenTask: (id: string) => void }) {
  const { state, now } = quest;
  const entries = memberActivity(state, id);
  if (!entries.length) return <p className="hd-quiet">No recorded activity yet.</p>;
  return (
    <ol className="tm-timeline">
      {entries.map((entry, index) => {
        const body = <><span className={`tm-dot ${entry.kind === 'done' || /complet/i.test(entry.text) ? 'is-done' : ''}`} aria-hidden="true" /><span><strong>{entry.text}</strong><small><time dateTime={new Date(entry.at).toISOString()}>{ago(entry.at, now)}</time>{entry.taskId && state.tasks.some(task => task.id === entry.taskId) ? ` · ${state.tasks.find(task => task.id === entry.taskId)!.title}` : ''}</small></span></>;
        return <li key={`${entry.at}:${index}`}>{entry.taskId && state.tasks.some(task => task.id === entry.taskId) ? <button type="button" onClick={() => onOpenTask(entry.taskId!)}>{body}</button> : <div>{body}</div>}</li>;
      })}
    </ol>
  );
}

function WorkTab({ quest, id, onOpenTask }: { quest: Quest; id: string; onOpenTask: (id: string) => void }) {
  const { state, now } = quest;
  const groups = memberWork(state, id, now);
  if (!groups.length) return <p className="hd-quiet">No open assignments.</p>;
  return <>{groups.map(group => <section key={group.projectId || 'none'} className="tm-block">
    <h3>{projectName(state, group.projectId) || 'No project'} <small>{group.tasks.length}</small></h3>
    <ul className="tm-tasks">{group.tasks.map(task => <TaskRow key={task.id} quest={quest} task={task} tag={task.owner === id ? STATUS_LABELS[task.status] : 'Their review'} onOpen={onOpenTask} />)}</ul>
  </section>)}</>;
}

function UpcomingTab({ quest, id, onOpenTask }: { quest: Quest; id: string; onOpenTask: (id: string) => void }) {
  const { state, now } = quest;
  const { dated, incoming } = memberUpcoming(state, id, now);
  if (!dated.length && !incoming.length) return <p className="hd-quiet">No dated work or incoming hand-offs.</p>;
  return <>
    {dated.length > 0 && <section className="tm-block"><h3>By date</h3><ul className="tm-tasks">{dated.map(task => <TaskRow key={task.id} quest={quest} task={task} showAction onOpen={onOpenTask} />)}</ul></section>}
    {incoming.length > 0 && <section className="tm-block"><h3>Coming to them next</h3><ul className="tm-tasks">{incoming.map(task => <TaskRow key={task.id} quest={quest} task={task} tag="Hand-off" onOpen={onOpenTask} />)}</ul></section>}
  </>;
}

function TaskRow({ quest, task, tag, hot, showAction, onOpen }: { quest: Quest; task: Task; tag?: string; hot?: boolean; showAction?: boolean; onOpen: (id: string) => void }) {
  const { state, now } = quest;
  const today = localDate(now);
  const late = task.due && task.status !== 'done' && task.due < today;
  return (
    <li><button type="button" className="tm-task" onClick={() => onOpen(task.id)}>
      <span><strong>{showAction && task.nextAction ? task.nextAction : task.title}</strong>
        <small>{showAction && task.nextAction ? `${task.title} · ` : ''}{task.projectId ? projectName(state, task.projectId) : 'No project'}{task.due ? <em className={late ? 'is-late' : ''}> · {late ? 'overdue' : 'due'} {shortDate(task.due, today)}{task.dueTime ? ` ${task.dueTime}` : ''}</em> : null}</small></span>
      {tag && <span className={`tm-tag ${hot ? 'is-hot' : ''}`}>{tag}</span>}
    </button></li>
  );
}
