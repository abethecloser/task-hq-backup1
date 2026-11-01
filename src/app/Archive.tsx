// Archive: one place for archived projects and tasks. Nothing here is deleted or completed; each
// record keeps its status, people and history, and Restore brings it back exactly as it was. Every
// restore is the usual engine action, so the server decides who may do it.
import { useMemo, useState } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import type { Project, Task } from '../core/contract.ts';
import { canReopenTask } from '../core/permissions.ts';
import { coordinates, nameOf, person, projectName } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';

type Kind = 'all' | 'projects' | 'tasks';
const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function Archive({ quest, onOpenTask, onOpenProject }: { quest: Quest; onOpenTask: (id: string) => void; onOpenProject: (id: string) => void }) {
  const { state, actor, dispatch, backend } = quest;
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const term = search.trim().toLowerCase();
  const coordinator = coordinates(person(state, actor));

  const projects = useMemo(() => state.projects.filter(item => item.archivedAt && (!term || item.name.toLowerCase().includes(term)))
    .sort((a, b) => b.archivedAt! - a.archivedAt!), [state.projects, term]);
  const tasks = useMemo(() => state.tasks.filter(task => task.archivedAt && (!term || `${task.title} ${projectName(state, task.projectId)} ${nameOf(state, task.owner, '')}`.toLowerCase().includes(term)))
    .sort((a, b) => b.archivedAt! - a.archivedAt!), [state, term]);

  const canRestoreProject = coordinator && backend.supports?.projectArchive !== false;
  const canRestoreTask = (task: Task) => task.status === 'done'
    ? canReopenTask(state, task, actor) && backend.supports?.taskArchive !== false
    : coordinator && backend.supports?.legacyArchive !== false;

  async function restore(action: { type: 'project/unarchive' | 'task/unarchive'; id: string }, open: () => void) {
    const result = await dispatch(action);
    if (result.ok) { setError(''); open(); } else setError(result.error);
  }

  const showProjects = kind !== 'tasks', showTasks = kind !== 'projects';
  return (
    <div className="view archive">
      <header className="view-head">
        <div>
          <p className="eyebrow">{state.workspace.name} · archive</p>
          <div className="view-title-row">
            <h1>Archive</h1>
            <div className="scope-seg" role="group" aria-label="Show">
              {(['all', 'projects', 'tasks'] as Kind[]).map(id => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}>{id === 'all' ? 'All' : id === 'projects' ? `Projects ${state.projects.filter(item => item.archivedAt).length}` : `Tasks ${state.tasks.filter(task => task.archivedAt).length}`}</button>)}
            </div>
          </div>
          <p className="lede">Archived projects and tasks leave active work but keep their status, people and history. Restore brings a record back exactly as it was.</p>
        </div>
      </header>
      <label className="field archive-search"><span className="sr-only">Search the archive</span>
        <input type="search" value={search} placeholder="Search archived projects and tasks" onChange={event => setSearch(event.target.value)} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}

      {showProjects && <section className="archive-group" aria-labelledby="archive-projects">
        <h2 id="archive-projects" className="ctx-label">Projects</h2>
        {projects.length === 0 ? <p className="hd-quiet">{term ? 'No archived projects match.' : 'No archived projects.'}</p> : <ul className="archive-list">
          {projects.map(project => <ProjectRow key={project.id} quest={quest} project={project}
            onOpen={() => onOpenProject(project.id)}
            onRestore={canRestoreProject ? () => void restore({ type: 'project/unarchive', id: project.id }, () => onOpenProject(project.id)) : undefined} />)}
        </ul>}
      </section>}

      {showTasks && <section className="archive-group" aria-labelledby="archive-tasks">
        <h2 id="archive-tasks" className="ctx-label">Tasks</h2>
        {tasks.length === 0 ? <p className="hd-quiet">{term ? 'No archived tasks match.' : 'No archived tasks.'}</p> : <ul className="archive-list">
          {tasks.map(task => (
            <li key={task.id} className={`archive-row status-${task.status}`}>
              <span className={`state-dot dot-${task.status}`} aria-hidden="true" />
              <div className="archive-text">
                <button type="button" className="row-open" onClick={() => onOpenTask(task.id)}><strong>{task.title}</strong></button>
                <small>{task.status === 'done' ? 'Completed' : `Not completed · ${STATUS_LABELS[task.status]}`}{task.projectId ? ` · ${projectName(state, task.projectId) || 'Removed project'}` : ''}{task.owner ? ` · ${nameOf(state, task.owner, 'Former member')}` : ''}</small>
                <small>Archived {day(task.archivedAt!)}{task.archivedBy ? ` · ${nameOf(state, task.archivedBy, 'someone')}` : ''}</small>
              </div>
              <span className="archive-actions">
                {canRestoreTask(task) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void restore({ type: 'task/unarchive', id: task.id }, () => onOpenTask(task.id))}>Restore</button>}
              </span>
            </li>
          ))}
        </ul>}
      </section>}
    </div>
  );
}

function ProjectRow({ quest, project, onOpen, onRestore }: { quest: Quest; project: Project; onOpen: () => void; onRestore?: () => void }) {
  const { state } = quest;
  const tasks = state.tasks.filter(task => task.projectId === project.id);
  const open = tasks.filter(task => task.status !== 'done' && !task.archivedAt).length;
  return (
    <li className="archive-row is-project">
      <svg className="icon archive-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" /></svg>
      <div className="archive-text">
        <button type="button" className="row-open" onClick={onOpen}><strong>{project.name}</strong></button>
        <small>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}{open ? ` · ${open} still open` : ''}</small>
        <small>Archived {day(project.archivedAt!)}{project.archivedBy ? ` · ${nameOf(state, project.archivedBy, 'someone')}` : ''}</small>
      </div>
      <span className="archive-actions">{onRestore && <button type="button" className="btn btn-ghost btn-sm" onClick={onRestore}>Restore</button>}</span>
    </li>
  );
}
