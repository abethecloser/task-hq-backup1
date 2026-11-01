import { useMemo } from 'react';
import { projectIntel } from '../core/project-intel.ts';
import { firstName, projectName } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';

const STAGES = [['working', 'In progress'], ['review', 'In review'], ['blocked', 'Blocked'], ['ready', 'Not started'], ['done', 'Done']] as const;


/** Projects and Team Overview: one completion ring beside the task-stage breakdown and how many projects
 * are complete, plus what needs a hand next (unless those parts are their own dashboard modules). */
export function ProjectTeam({ quest, company, onOpen, onReports, only, omit = {} }: {
  quest: Quest; company: boolean; onOpen: (taskId: string) => void;
  /** Render one part on its own (a Home dashboard module). */
  only?: 'needs-hand' | 'next-actions';
  /** Parts shown elsewhere on the dashboard, so the overview doesn't repeat them. */
  omit?: { needsHand?: boolean; nextActions?: boolean };
  /** Opens the full Reports page. */
  onReports?: () => void;
}) {
  const { state, actor, now } = quest;
  const intel = useMemo(() => projectIntel(state, actor, now, company), [state, actor, now, company]);
  const today = localDate(now);
  const scope = company ? 'All work you can see' : 'Your work';
  const r = 46, circumference = 2 * Math.PI * r;

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
    const titles = { 'needs-hand': 'Needs a hand', 'next-actions': 'Next actions' } as const;
    return (
      <section className="hd-panel pt pt-part" aria-label={titles[only]}>
        {only === 'needs-hand' ? needsHand : nextActions}
      </section>
    );
  }

  return (
    <section className="hd-panel pt" aria-labelledby="pt-title">
      <div className="hd-head">
        <span className="hd-tile tone-act" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg></span>
        <div><h2 id="pt-title">Projects and Team Overview</h2><small>{scope} · {intel.tasks.total} tasks</small></div>
      </div>
      <div className="pt-grid">
        <div className="pt-ring">
          <svg viewBox="0 0 120 120" role="img" aria-label={`Task completion: ${intel.tasks.percent}% — ${intel.tasks.done} of ${intel.tasks.total} tasks done.`}>
            <circle cx="60" cy="60" r={r} className="pt-track" />
            {intel.tasks.percent > 0 && <circle cx="60" cy="60" r={r} className="pt-value" strokeDasharray={`${(intel.tasks.percent / 100) * circumference} ${circumference}`} transform="rotate(-90 60 60)" />}
          </svg>
          <div className="pt-ring-label" aria-hidden="true"><b>{intel.tasks.percent}<i>%</i></b><small>tasks done</small></div>
          <p className="pt-ring-sub">{intel.tasks.done} of {intel.tasks.total} tasks</p>
        </div>
        <div className="pt-breakdown">
          <p className="pt-label">Tasks by stage</p>
          <ul className="pt-stages" aria-label="Tasks by stage">
            {STAGES.map(([key, label]) => <li key={key}><i className={`s-${key}`} aria-hidden="true" />{label}<b>{intel.stages[key]}</b></li>)}
          </ul>
          <p className="pt-projects-done"><b>{intel.projectsComplete.complete} of {intel.projectsComplete.total}</b> projects complete<small>A project is complete when every task in it is done.</small></p>
        </div>
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
