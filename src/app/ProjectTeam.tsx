import { useEffect, useMemo, useState } from 'react';
import { projectIntel } from '../core/project-intel.ts';
import { firstName, projectName } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';
import { LivingView } from './LivingView.tsx';

type PtView = 'standard' | 'living';
const VIEW_KEY = 'quest-overview-view';
const loadView = (): PtView => { try { return localStorage.getItem(VIEW_KEY) === 'living' ? 'living' : 'standard'; } catch { return 'standard'; } };

const STAGES = [['working', 'In progress'], ['review', 'In review'], ['blocked', 'Blocked'], ['ready', 'Not started'], ['done', 'Done']] as const;

/** Projects and Team Overview: task completion for a selection, the projects and people behind it, and what needs a hand next.
 * Standard (ring and lists) is the default; Living shows the same records as packed project bubbles. Both share one selection:
 * pick a project or person, pick another to switch, pick it again to clear. */
export function ProjectTeam({ quest, company, onOpen, focusTaskId = null, onClearFocus, onReports, only, omit = {} }: {
  quest: Quest; company: boolean; onOpen: (taskId: string) => void;
  /** Render one part on its own (a Home dashboard module). */
  only?: 'people' | 'needs-hand' | 'next-actions';
  /** Parts shown elsewhere on the dashboard, so the overview doesn't repeat them. */
  omit?: { people?: boolean; needsHand?: boolean; nextActions?: boolean };
  /** A task the dock is reading; its project is focused in Living until cleared. */
  focusTaskId?: string | null; onClearFocus?: () => void;
  /** Opens the full Reports page. */
  onReports?: () => void;
}) {
  const { state, actor, now } = quest;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [view, setViewState] = useState<PtView>(loadView);
  const setView = (next: PtView) => { setViewState(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ } };
  const focusTask = focusTaskId ? state.tasks.find(task => task.id === focusTaskId && (company || task.owner === actor)) : undefined;
  const focusProjectId = focusTask ? focusTask.projectId || '' : null;
  // A new dock focus replaces an older project pick so the focused project is what the overview shows.
  useEffect(() => { if (focusProjectId != null) setProjectId(null); }, [focusTaskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const global = useMemo(() => projectIntel(state, actor, now, company), [state, actor, now, company]);
  const intel = useMemo(() => projectIntel(state, actor, now, company, { projectId, person }), [state, actor, now, company, projectId, person]);
  const today = localDate(now);
  const selection = [projectId != null && (intel.projects.find(item => item.id === projectId)?.name ?? 'Project'), person && firstName(state, person)].filter(Boolean).join(' · ');
  const scope = company ? 'All work you can see' : 'Your work';
  const r = 46, circumference = 2 * Math.PI * r;
  const maxOpen = Math.max(1, ...intel.people.map(item => item.open));

  const peopleList = <>
          <p className="pt-label">Open work by person</p>
          {intel.people.length === 0 ? <p className="hd-quiet">Nobody has open work here.</p> : <ul className="pt-list">
            {intel.people.map(item => (
              <li key={item.person}>
                <button type="button" className={`pt-row ${person === item.person ? 'is-on' : ''}`} aria-pressed={person === item.person}
                  aria-label={`${item.name}: ${item.open} open — ${item.byStatus.working} in progress, ${item.byStatus.review} in review, ${item.byStatus.ready} not started, ${item.byStatus.blocked} blocked${item.waiting ? `, ${item.waiting} waiting on a dependency` : ''}${item.overdue ? `; ${item.overdue} overdue` : ''}`}
                  onClick={() => setPerson(person === item.person ? null : item.person)}>
                  <span className="pt-row-top"><span className="pt-name">{item.name}</span><b>{item.open}</b></span>
                  <span className="pt-stack" aria-hidden="true" style={{ width: `${Math.max(10, Math.round((item.open / maxOpen) * 100))}%` }}>
                    {(['working', 'review', 'ready', 'blocked'] as const).map(key => item.byStatus[key] > 0 && <i key={key} className={`s-${key}`} style={{ flexGrow: item.byStatus[key] }} />)}
                  </span>
                  {(item.overdue > 0 || item.blocked > 0 || item.waiting > 0) && <small>{[item.overdue ? <em key="o" className="is-late">{item.overdue} overdue</em> : null, item.blocked ? <em key="b" className="is-blocked">{item.blocked} blocked</em> : null, item.waiting ? <em key="w" className="is-blocked">{item.waiting} waiting</em> : null].filter(Boolean).map((part, index) => <span key={index}>{index > 0 && ' · '}{part}</span>)}</small>}
                </button>
              </li>
            ))}
          </ul>}
          <p className="hd-fine">Counts of assigned open tasks, not hours or capacity.</p>
  </>;
  const needsHand = <>
          <p className="pt-label">Needs a hand</p>
          {intel.attention.length === 0 ? <p className="hd-quiet">Nothing overdue or blocked here.</p> : <ul className="pt-mini">
            {intel.attention.slice(0, 3).map(({ task, reason }) => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)}>
              <strong>{task.title}</strong><small><em className={reason === 'Overdue' ? 'is-late' : 'is-blocked'}>{reason}</em> · {firstName(state, task.owner, 'Unassigned')}</small>
            </button></li>)}
          </ul>}
  </>;
  const nextActions = <>
          <p className="pt-label">Next actions</p>
          {intel.next.length === 0 ? <p className="hd-quiet">No open work ready to move.</p> : <ul className="pt-mini">
            {intel.next.map(task => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)}>
              <strong>{task.nextAction || task.title}</strong><small>{task.nextAction ? `${task.title} · ` : ''}{firstName(state, task.owner, 'Unassigned')}{task.due ? ` · due ${shortDate(task.due, today)}` : ''}{task.projectId ? ` · ${projectName(state, task.projectId)}` : ''}</small>
            </button></li>)}
          </ul>}
  </>;

  // One part on its own, as a Home module (same data, same interactions as inside the overview).
  if (only) {
    const titles = { people: 'Open work by person', 'needs-hand': 'Needs a hand', 'next-actions': 'Next actions' } as const;
    return (
      <section className="hd-panel pt pt-part" aria-label={titles[only]}>
        {only === 'people' ? (company ? peopleList : <p className="hd-quiet">Open work by person is shown to people who can see company work.</p>) : only === 'needs-hand' ? needsHand : nextActions}
      </section>
    );
  }

  return (
    <section className="hd-panel pt" aria-labelledby="pt-title">
      <div className="hd-head">
        <span className="hd-tile tone-act" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg></span>
        <div><h2 id="pt-title">Projects and Team Overview</h2><small>{selection ? `${selection} · ${intel.tasks.total} of ${global.tasks.total} tasks` : `${scope} · ${global.tasks.total} tasks`}</small></div>
        <div className="pt-head-end">
          {(projectId != null || person) && <button type="button" className="hd-more" onClick={() => { setProjectId(null); setPerson(null); }}>Clear selection</button>}
          <div className="seg pt-view" role="group" aria-label="Overview visualization">
            <button type="button" aria-pressed={view === 'standard'} onClick={() => setView('standard')}>Standard</button>
            <button type="button" aria-pressed={view === 'living'} onClick={() => setView('living')}>Living</button>
          </div>
        </div>
      </div>
      {view === 'living' && focusProjectId != null && projectId == null && <p className="pt-focus" role="status">
        <span>Focused from the dock: <b>{intel.projects.find(item => item.id === focusProjectId)?.name ?? 'No project'}</b> · {focusTask!.title}</span>
        {onClearFocus && <button type="button" className="link" onClick={onClearFocus}>Clear focus</button>}
      </p>}

      <div className={`pt-grid ${view === 'living' ? 'is-living' : ''}`}>
        {view === 'living' ? <div className="pt-living">
          <LivingView quest={quest} company={company} projectId={projectId} person={person} focusProjectId={focusProjectId}
            onProject={setProjectId} onPerson={setPerson} onOpen={onOpen} />
        </div> : <div className="pt-ring">
          <svg viewBox="0 0 120 120" role="img" aria-label={`Task completion: ${intel.tasks.percent}% — ${intel.tasks.done} of ${intel.tasks.total} tasks done${selection ? ` for ${selection}` : ''}.`}>
            <circle cx="60" cy="60" r={r} className="pt-track" />
            {intel.tasks.percent > 0 && <circle cx="60" cy="60" r={r} className="pt-value" strokeDasharray={`${(intel.tasks.percent / 100) * circumference} ${circumference}`} transform="rotate(-90 60 60)" />}
          </svg>
          <div className="pt-ring-label" aria-hidden="true"><b>{intel.tasks.percent}<i>%</i></b><small>tasks done</small></div>
          <p className="pt-ring-sub">{intel.tasks.done} of {intel.tasks.total} tasks</p>
          <ul className="pt-stages" aria-label="Tasks by stage">
            {STAGES.map(([key, label]) => <li key={key}><i className={`s-${key}`} aria-hidden="true" />{label}<b>{intel.stages[key]}</b></li>)}
          </ul>
          <p className="pt-projects-done"><b>{intel.projectsComplete.complete} of {intel.projectsComplete.total}</b> projects complete<small>A project is complete when every task in it is done.</small></p>
        </div>}

        <div className="pt-col">
          <p className="pt-label">Projects</p>
          {intel.projects.length === 0 ? <p className="hd-quiet">No tasks yet.</p> : <ul className="pt-list">
            {intel.projects.map(item => (
              <li key={item.id || 'none'}>
                <button type="button" className={`pt-row ${projectId === item.id ? 'is-on' : ''}`} aria-pressed={projectId === item.id}
                  aria-label={`${item.name}: ${item.percent}% of tasks done, ${item.done} of ${item.total}${item.overdue ? `, ${item.overdue} overdue` : ''}${item.blocked ? `, ${item.blocked} blocked` : ''}${item.waiting ? `, ${item.waiting} waiting on a dependency` : ''}`}
                  onClick={() => setProjectId(projectId === item.id ? null : item.id)}>
                  <span className="pt-row-top"><span className="pt-name">{item.name}</span><b>{item.percent}%</b></span>
                  <span className="pt-bar" aria-hidden="true"><span style={{ width: `${item.percent}%` }} /></span>
                  <small>{item.done}/{item.total} done{item.overdue ? <em className="is-late"> · {item.overdue} overdue</em> : null}{item.blocked ? <em className="is-blocked"> · {item.blocked} blocked</em> : null}{item.waiting ? <em className="is-blocked"> · {item.waiting} waiting</em> : null}</small>
                </button>
              </li>
            ))}
          </ul>}
        </div>

        {company && !omit.people && <div className="pt-col">
          {peopleList}
        </div>}
      </div>

      {!(omit.needsHand && omit.nextActions) && <div className="pt-actions">
        {!omit.needsHand && <div>
          {needsHand}
        </div>}
        {!omit.nextActions && <div>
          {nextActions}
        </div>}
      </div>}
      {onReports && <footer className="pt-foot"><button type="button" className="hd-more pt-reports" onClick={onReports}>View reports<svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button></footer>}
    </section>
  );
}
