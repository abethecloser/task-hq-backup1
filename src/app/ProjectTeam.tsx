import { useMemo, useState } from 'react';
import { projectIntel } from '../core/project-intel.ts';
import { firstName, projectName } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';

const STAGES = [['working', 'In progress'], ['review', 'In review'], ['blocked', 'Blocked'], ['ready', 'Not started'], ['done', 'Done']] as const;

/** Projects & team: task completion for a selection, the projects and people behind it, and what needs a hand next. */
export function ProjectTeam({ quest, company, onOpen }: { quest: Quest; company: boolean; onOpen: (taskId: string) => void }) {
  const { state, actor, now } = quest;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const intel = useMemo(() => projectIntel(state, actor, now, company, { projectId, person }), [state, actor, now, company, projectId, person]);
  const today = localDate(now);
  const selection = [projectId != null && (intel.projects.find(item => item.id === projectId)?.name ?? 'Project'), person && firstName(state, person)].filter(Boolean).join(' · ');
  const scope = company ? 'All work you can see' : 'Your work';
  const r = 46, circumference = 2 * Math.PI * r;
  const maxOpen = Math.max(1, ...intel.people.map(item => item.open));

  return (
    <section className="hd-panel pt" aria-labelledby="pt-title">
      <div className="hd-head">
        <span className="hd-tile tone-act" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg></span>
        <div><h2 id="pt-title">Projects &amp; team</h2><small>{selection || scope}</small></div>
        {(projectId != null || person) && <button type="button" className="hd-more" onClick={() => { setProjectId(null); setPerson(null); }}>Clear selection</button>}
      </div>

      <div className="pt-grid">
        <div className="pt-ring">
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
        </div>

        <div className="pt-col">
          <p className="pt-label">Projects</p>
          {intel.projects.length === 0 ? <p className="hd-quiet">No tasks yet.</p> : <ul className="pt-list">
            {intel.projects.map(item => (
              <li key={item.id || 'none'}>
                <button type="button" className={`pt-row ${projectId === item.id ? 'is-on' : ''}`} aria-pressed={projectId === item.id}
                  aria-label={`${item.name}: ${item.percent}% of tasks done, ${item.done} of ${item.total}${item.overdue ? `, ${item.overdue} overdue` : ''}${item.blocked ? `, ${item.blocked} blocked or waiting` : ''}`}
                  onClick={() => setProjectId(projectId === item.id ? null : item.id)}>
                  <span className="pt-row-top"><span className="pt-name">{item.name}</span><b>{item.percent}%</b></span>
                  <span className="pt-bar" aria-hidden="true"><span style={{ width: `${item.percent}%` }} /></span>
                  <small>{item.done}/{item.total} done{item.overdue ? <em className="is-late"> · {item.overdue} overdue</em> : null}{item.blocked ? <em className="is-blocked"> · {item.blocked} blocked</em> : null}</small>
                </button>
              </li>
            ))}
          </ul>}
        </div>

        {company && <div className="pt-col">
          <p className="pt-label">Open work by person</p>
          {intel.people.length === 0 ? <p className="hd-quiet">Nobody has open work here.</p> : <ul className="pt-list">
            {intel.people.map(item => (
              <li key={item.person}>
                <button type="button" className={`pt-row ${person === item.person ? 'is-on' : ''}`} aria-pressed={person === item.person}
                  aria-label={`${item.name}: ${item.open} open — ${item.byStatus.working} in progress, ${item.byStatus.review} in review, ${item.byStatus.ready} not started, ${item.byStatus.blocked} blocked${item.overdue ? `; ${item.overdue} overdue` : ''}`}
                  onClick={() => setPerson(person === item.person ? null : item.person)}>
                  <span className="pt-row-top"><span className="pt-name">{item.name}</span><b>{item.open}</b></span>
                  <span className="pt-stack" aria-hidden="true" style={{ width: `${Math.max(10, Math.round((item.open / maxOpen) * 100))}%` }}>
                    {(['working', 'review', 'ready', 'blocked'] as const).map(key => item.byStatus[key] > 0 && <i key={key} className={`s-${key}`} style={{ flexGrow: item.byStatus[key] }} />)}
                  </span>
                  {(item.overdue > 0 || item.blocked > 0) && <small>{item.overdue ? <em className="is-late">{item.overdue} overdue</em> : null}{item.overdue && item.blocked ? ' · ' : ''}{item.blocked ? <em className="is-blocked">{item.blocked} blocked</em> : null}</small>}
                </button>
              </li>
            ))}
          </ul>}
          <p className="hd-fine">Counts of assigned open tasks, not hours or capacity.</p>
        </div>}
      </div>

      <div className="pt-actions">
        <div>
          <p className="pt-label">Needs a hand</p>
          {intel.attention.length === 0 ? <p className="hd-quiet">Nothing overdue or blocked here.</p> : <ul className="pt-mini">
            {intel.attention.slice(0, 3).map(({ task, reason }) => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)}>
              <strong>{task.title}</strong><small><em className={reason === 'Overdue' ? 'is-late' : 'is-blocked'}>{reason}</em> · {firstName(state, task.owner, 'Unassigned')}</small>
            </button></li>)}
          </ul>}
        </div>
        <div>
          <p className="pt-label">Next actions</p>
          {intel.next.length === 0 ? <p className="hd-quiet">No open work ready to move.</p> : <ul className="pt-mini">
            {intel.next.map(task => <li key={task.id}><button type="button" onClick={() => onOpen(task.id)}>
              <strong>{task.nextAction || task.title}</strong><small>{task.nextAction ? `${task.title} · ` : ''}{firstName(state, task.owner, 'Unassigned')}{task.due ? ` · due ${shortDate(task.due, today)}` : ''}{task.projectId ? ` · ${projectName(state, task.projectId)}` : ''}</small>
            </button></li>)}
          </ul>}
        </div>
      </div>
    </section>
  );
}
