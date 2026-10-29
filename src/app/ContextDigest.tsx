// Right panel context (V5/V6 "Notifications & context"): workspace progress, quick actions, and the
// Needs a hand · Next actions · Recent activity sections around the inbox list. All of it is read
// from the same records as Home's Projects & team and Team activity; every row opens its task.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { teamActivity } from '../core/dashboard.ts';
import { projectIntel } from '../core/project-intel.ts';
import { firstName, projectName } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';
import { Recent } from './Home.tsx';

export interface DigestActions {
  company: boolean;
  onOpenTask: (id: string) => void;
  onOpenProjects: () => void;
  onOpenCalendar?: () => void;
  onCreate?: () => void;
}

/** V6 header block: completion ring for the work in view, plus the quick actions this viewer may take. */
export function WorkspaceSummary({ quest, actions }: { quest: Quest; actions: DigestActions }) {
  const { state, actor, now } = quest;
  const intel = useMemo(() => projectIntel(state, actor, now, actions.company), [state, actor, now, actions.company]);
  const r = 42, circumference = 2 * Math.PI * r;
  return (
    <div className="cx-summary">
      <button type="button" className="cx-workspace" onClick={actions.onOpenProjects}
        aria-label={`${actions.company ? 'Active workspace' : 'Your work'}: ${intel.tasks.done} of ${intel.tasks.total} tasks complete. Open projects.`}>
        <span className="cx-ring" aria-hidden="true">
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r={r} className="cx-ring-track" />
            {intel.tasks.percent > 0 && <circle cx="50" cy="50" r={r} className="cx-ring-value" strokeDasharray={`${(intel.tasks.percent / 100) * circumference} ${circumference}`} transform="rotate(-90 50 50)" />}</svg>
          <b>{intel.tasks.percent}%</b>
        </span>
        <span><strong>{actions.company ? 'Active workspace' : 'Your work'}</strong><small>{intel.tasks.done} of {intel.tasks.total} tasks complete</small></span>
      </button>
      {(actions.onCreate || actions.onOpenCalendar) && <div className="cx-quick">
        {actions.onCreate && <button type="button" onClick={actions.onCreate}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Task</button>}
        {actions.onOpenCalendar && <button type="button" className="is-cal" onClick={actions.onOpenCalendar}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /></svg>Calendar</button>}
      </div>}
    </div>
  );
}

/** Needs a hand and Next actions: shown above the inbox list. */
export function DigestLead({ quest, actions }: { quest: Quest; actions: DigestActions }) {
  const { state, actor, now } = quest;
  const intel = useMemo(() => projectIntel(state, actor, now, actions.company), [state, actor, now, actions.company]);
  const today = localDate(now);
  return <>
    <Section title="Needs a hand" count={intel.attention.length}>
      {intel.attention.length === 0 ? <p className="cx-empty">Nothing overdue or blocked.</p> : <ul className="cx-list">
        {intel.attention.slice(0, 3).map(({ task, reason }) => <li key={task.id}><button type="button" className="cx-card is-hand" onClick={() => actions.onOpenTask(task.id)}>
          <strong>{task.title}</strong>
          <small><em className={reason === 'Overdue' ? 'is-late' : 'is-blocked'}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>{reason}</em><i aria-hidden="true">•</i><span>{firstName(state, task.owner, 'Unassigned')}</span></small>
        </button></li>)}
      </ul>}
    </Section>
    <Section title="Next actions">
      {intel.next.length === 0 ? <p className="cx-empty">No open work ready to move.</p> : <ul className="cx-list">
        {intel.next.slice(0, 3).map(task => <li key={task.id}><button type="button" className="cx-card" onClick={() => actions.onOpenTask(task.id)}>
          <strong>{task.nextAction || task.title}</strong>
          <small>{[task.due ? `due ${shortDate(task.due, today)}` : task.nextAction ? task.title : firstName(state, task.owner, 'Unassigned'), task.projectId ? projectName(state, task.projectId) : ''].filter(Boolean).map((part, index) => <span key={index}>{index > 0 && <i aria-hidden="true">•</i>}{part}</span>)}</small>
        </button></li>)}
      </ul>}
    </Section>
  </>;
}

/** Recent activity: shown below the inbox list. */
export function DigestTail({ quest, actions }: { quest: Quest; actions: DigestActions }) {
  const { state, actor } = quest;
  const activity = useMemo(() => teamActivity(state, actor, actions.company, 3), [state, actor, actions.company]);
  return (
    <Section title="Recent activity">
      {activity.length === 0 ? <p className="cx-empty">No activity yet.</p>
        : <ul className="cx-activity hd-list hd-feed">{activity.map(event => <li key={event.id}><Recent event={event} quest={quest} onOpen={actions.onOpenTask} /></li>)}</ul>}
    </Section>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="cx-section" aria-label={title}>
      <h3 className="cx-label">{title}{count ? <span className="cx-count">{count}</span> : null}</h3>
      {children}
    </section>
  );
}
