import { Select } from '../ui/Select.tsx';
import { useState } from 'react';
import type { TaskStatus } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { compareTasks } from '../core/selectors.ts';
import { Empty, TaskRow } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';

export function CompanyWork({ quest, onOpen, onCreateProject, onAddTask, onOpenRoom }: {
  quest: Quest; onOpen: (id: string) => void;
  /** Opens the project's room (overview, board, conversation, activity). */
  onOpenRoom?: (projectId: string) => void;
  /** Present when this viewer may create projects (supervisor, admin, owner). */
  onCreateProject?: () => void;
  /** Opens New task with the project chosen. */
  onAddTask?: (projectId: string) => void;
}) {
  const { state, now } = quest;
  const [project, setProject] = useState('');
  const [who, setWho] = useState('');
  const [status, setStatus] = useState<TaskStatus | 'open' | 'all'>('open');
  const tasks = state.tasks
    .filter(task => (status === 'all' ? true : status === 'open' ? task.status !== 'done' : task.status === status))
    .filter(task => !project || task.projectId === project)
    .filter(task => !who || (who === 'none' ? !task.owner : [task.owner, task.nextOwner, task.approver, task.decisionOwner, ...task.watchers].includes(who)))
    .sort(compareTasks(now));
  const byProject = [...state.projects, { id: '', name: 'No project' }]
    .map(item => ({ ...item, tasks: tasks.filter(task => task.projectId === item.id) }))
    // Unfiltered, every project shows (a new one has no tasks yet); filtered, only matching ones.
    .filter(item => item.tasks.length || (item.id && !project && !who && status === 'open') || (item.id && item.id === project));

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Shared visibility</p>
          <h1>Projects</h1>
          <p className="lede">Coordinate daily work by project. Scan status, then open a task to see who acts next.</p>
        </div>
        {onCreateProject && <button type="button" className="btn btn-primary view-head-action" onClick={onCreateProject}>+ New project</button>}
      </header>
      <div className="filters" role="group" aria-label="Filters">
        <Select value={status} onChange={event => setStatus(event.target.value as typeof status)} aria-label="Status">
          <option value="open">All open</option>
          {(Object.keys(STATUS_LABELS) as TaskStatus[]).map(key => <option key={key} value={key}>{STATUS_LABELS[key]}</option>)}
          <option value="all">Everything</option>
        </Select>
        <Select value={project} onChange={event => setProject(event.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select value={who} onChange={event => setWho(event.target.value)} aria-label="Person">
          <option value="">Anyone involved</option>
          <option value="none">No owner</option>
          {state.people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <span className="filters-count">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      {byProject.length === 0 ? <Empty title="No tasks match these filters" /> : byProject.map(group => {
        const next = group.tasks.find(task => task.status !== 'done');
        const summary = (Object.keys(STATUS_LABELS) as TaskStatus[])
          .map(key => ({ label: STATUS_LABELS[key], count: group.tasks.filter(task => task.status === key).length }))
          .filter(item => item.count)
          .map(item => `${item.count} ${item.label.toLowerCase()}`).join(' · ');
        return (
        <section key={group.id || 'none'} className="group">
          <h3 className="group-title">{group.name} <span>{group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}</span>
            {group.id && onOpenRoom && <button type="button" className="hd-more group-room" onClick={() => onOpenRoom(group.id)}>Open project room →</button>}</h3>
          <p className="muted">{summary}{project || who || status !== 'open' ? ' · filtered view' : ''}</p>
          {group.tasks.length === 0
            ? <p className="muted">No tasks yet.{onAddTask && <> <button type="button" className="link" onClick={() => onAddTask(group.id)}>Add the first task</button></>}</p>
            : <div className="rows">{group.tasks.map(task => <TaskRow key={task.id} quest={quest} task={task} priority={task.id === next?.id} onOpen={onOpen} />)}</div>}
        </section>
      ); })}
    </div>
  );
}
