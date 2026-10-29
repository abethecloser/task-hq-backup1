// Project room: one project's shared space for the team. Overview up top, the project's task
// board in the center, and the conversation and activity beside it. Everything is read from
// the same records as Tasks and Projects; comments and edits are the usual engine actions.
// The collaboration dock stays available below (shell), so nothing here duplicates it.
import { useMemo, useState } from 'react';
import { projectIntel } from '../core/project-intel.ts';
import { firstName, isOpen, isOverdue } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { Board } from './AllTasks.tsx';
import { CommentReply, EventFeed, isComment } from './TaskComments.tsx';

export function ProjectRoom({ quest, projectId, company, onBack, onOpenTask, onAddTask }: {
  quest: Quest; projectId: string; company: boolean; onBack: () => void; onOpenTask: (id: string) => void; onAddTask?: (projectId: string) => void;
}) {
  const { state, actor, now } = quest;
  const project = state.projects.find(item => item.id === projectId);
  const tasks = useMemo(() => state.tasks.filter(task => task.projectId === projectId && !task.archivedAt && (company || task.owner === actor)), [state.tasks, projectId, company, actor]);
  const ids = useMemo(() => new Set(tasks.map(task => task.id)), [tasks]);
  const intel = useMemo(() => projectIntel(state, actor, now, company, { projectId }), [state, actor, now, company, projectId]);
  const events = useMemo(() => state.events.filter(event => event.taskId && ids.has(event.taskId) && !event.undone).sort((a, b) => b.at - a.at), [state.events, ids]);
  const comments = events.filter(isComment);
  const activity = events.filter(event => !isComment(event)).slice(0, 12);
  const open = tasks.filter(isOpen);
  const [replyTo, setReplyTo] = useState('');
  const target = open.find(task => task.id === replyTo) ?? open[0];
  const [tab, setTab] = useState<'conversation' | 'activity'>('conversation');

  if (!project) return <div className="view"><button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Projects</button><p className="hd-quiet">This project no longer exists.</p></div>;
  return (
    <div className="view project-room">
      <nav className="tp-bar" aria-label="Project">
        <button type="button" className="btn btn-ghost btn-sm tp-back" onClick={onBack}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Projects</button>
        {onAddTask && <button type="button" className="btn btn-primary btn-sm" onClick={() => onAddTask(projectId)}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New task</button>}
      </nav>
      <header className="view-head">
        <div>
          <p className="eyebrow">Project room · shared with the team</p>
          <h1>{project.name}</h1>
          <p className="lede">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} · {intel.tasks.percent}% done · {intel.people.length} {intel.people.length === 1 ? 'person' : 'people'} with open work</p>
        </div>
      </header>

      <section className="pr-overview" aria-label="Project overview">
        <div className="pr-stat"><b>{intel.tasks.done}/{intel.tasks.total}</b><span>tasks done</span><i className="pr-meter" aria-hidden="true"><i style={{ width: `${intel.tasks.percent}%` }} /></i></div>
        <div className="pr-stat"><b>{open.length}</b><span>open</span></div>
        <div className={`pr-stat ${open.some(task => isOverdue(task, now)) ? 'is-hot' : ''}`}><b>{open.filter(task => isOverdue(task, now)).length}</b><span>overdue</span></div>
        <div className="pr-stat"><b>{intel.stages.blocked}</b><span>blocked</span></div>
        <div className="pr-people" aria-label="People with open work">{intel.people.length === 0 ? <span className="muted">No open assignments</span>
          : intel.people.slice(0, 6).map(item => <span key={item.person} className="pr-person">{item.name}<b>{item.open}</b></span>)}</div>
      </section>

      <div className="pr-grid">
        <section className="pr-board" aria-labelledby="pr-board-title">
          <h2 id="pr-board-title" className="ctx-label">Task board</h2>
          {tasks.length === 0 ? <p className="hd-quiet">No tasks yet.{onAddTask && <> <button type="button" className="link" onClick={() => onAddTask(projectId)}>Add the first task</button></>}</p>
            : <Board quest={quest} tasks={tasks} selectedId={null} onSelect={onOpenTask} />}
        </section>

        <aside className="pr-side tp-card tp-talk" aria-label="Project conversation and activity">
          <div className="tp-tabs" role="tablist" aria-label="Conversation and activity">
            <button type="button" role="tab" aria-selected={tab === 'conversation'} onClick={() => setTab('conversation')}>Conversation <span>{comments.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>Activity <span>{activity.length}</span></button>
          </div>
          {tab === 'conversation' ? <>
            {target && <div className="pr-reply">
              <label className="field"><span>Comment on</span>
                <select value={target.id} onChange={event => setReplyTo(event.target.value)}>{open.map(task => <option key={task.id} value={task.id}>{task.title} · {firstName(state, task.owner, 'Unassigned')}</option>)}</select>
              </label>
              <CommentReply key={target.id} quest={quest} taskId={target.id} label={`Comment on ${target.title}`} />
            </div>}
            <EventFeed events={comments} empty="No comments on this project’s tasks yet." />
          </> : <EventFeed events={activity} empty="No activity on this project yet." />}
          <p className="muted pr-note">Comments live on tasks; open a card on the board for its full thread. Channels and the inbox are in the dock below.</p>
        </aside>
      </div>
    </div>
  );
}
