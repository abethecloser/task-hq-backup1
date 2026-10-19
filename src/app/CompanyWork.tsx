import { Select } from '../ui/Select.tsx';
import { useState } from 'react';
import type { TaskStatus } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { compareTasks } from '../core/selectors.ts';
import { Empty, TaskRow } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';

export function CompanyWork({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
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
    .filter(item => item.tasks.length);

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Shared visibility</p>
          <h1>Company Work</h1>
          <p className="lede">Everything the team is moving. Everyone in {quest.backend.kind === 'live' ? state.workspace.name : 'this demo workspace'} can see it; owners and approvers control what moves.</p>
        </div>
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
      {byProject.length === 0 ? <Empty title="No tasks match these filters" /> : byProject.map(group => (
        <section key={group.id || 'none'} className="group">
          <h3 className="group-title">{group.name} <span>{group.tasks.length}</span></h3>
          <div className="rows">{group.tasks.map(task => <TaskRow key={task.id} quest={quest} task={task} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
}
