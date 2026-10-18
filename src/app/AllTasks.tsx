// All Tasks: the operational center. One registry, five lenses, dense table or
// status board. Selecting a row opens it in the right-hand context panel; the
// row's own control moves the work forward without leaving the list.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { BOARD_ORDER, DEFAULT_QUERY, LENS_HINTS, LENS_LABELS, SORT_LABELS, boardColumns, lensCounts, queryTasks, rowFlags } from '../core/registry.ts';
import type { Lens, RegistryQuery, SortKey, StatusFilter } from '../core/registry.ts';
import { firstName, projectName } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import { Avatar, Empty, MoveForward, StatusPill } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';

type Layout = 'table' | 'board';
const LENSES: Lens[] = ['all', 'mine', 'team', 'attention', 'completed'];
const prefKey = (tenant: string, actor: string) => `quest.registry.v1.${tenant}.${actor}`;

function loadPrefs(key: string): { query: RegistryQuery; layout: Layout } {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object') return { query: { ...DEFAULT_QUERY, ...raw.query, search: '' }, layout: raw.layout === 'board' ? 'board' : 'table' };
  } catch { /* preferences are optional */ }
  return { query: DEFAULT_QUERY, layout: 'table' };
}

/** A jump into the registry from elsewhere (sidebar, signals): lens plus filters, applied once per nonce. */
export interface RegistryPreset { lens: Lens; changes?: Partial<RegistryQuery>; nonce: number }

export function AllTasks({ quest, selectedId, onSelect, onCreate, canCreate, preset, onPresetApplied }: {
  quest: Quest; selectedId: string | null; onSelect: (id: string) => void; onCreate: () => void; canCreate: boolean;
  preset?: RegistryPreset | null; onPresetApplied?: () => void;
}) {
  const { state, actor, now } = quest;
  const key = prefKey(state.workspace.tenantId, actor);
  const [prefs, setPrefs] = useState(() => loadPrefs(key));
  const query = prefs.query;
  const search = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => { setPrefs(loadPrefs(key)); }, [key]);
  useEffect(() => {
    if (!preset) return;
    setPrefs(current => ({ ...current, query: { ...DEFAULT_QUERY, sort: current.query.sort, lens: preset.lens, status: preset.lens === 'completed' ? 'done' : 'open', ...preset.changes } }));
    onPresetApplied?.(); // applied once: returning to All Tasks later keeps the person's own filters
  }, [preset, onPresetApplied]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* this page only */ } }, [key, prefs]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (changes: Partial<RegistryQuery>) => setPrefs(current => ({ ...current, query: { ...current.query, ...changes } }));
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => lensCounts(state, actor, minute * 60000), [state, actor, minute]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => queryTasks(state, actor, minute * 60000, query), [state, actor, minute, query]);
  const filtered = query.search || query.owner || query.project || query.due !== 'any' || query.priority !== 'any' || (query.lens !== 'completed' && query.status !== 'open');
  const live = quest.backend.kind === 'live';

  return (
    <div className="view registry">
      <header className="view-head">
        <div>
          <p className="eyebrow">{live ? `${state.workspace.name} · task registry` : 'Task-HQ Demo · synthetic records'}</p>
          <h1>{LENS_LABELS[query.lens]}</h1>
          <p className="lede">{LENS_HINTS[query.lens]}</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={onCreate} title={canCreate ? 'New task (N)' : 'Not available right now'}>New task</button>
      </header>

      <nav className="lens-bar" aria-label="Task lenses">
        {LENSES.map(lens => (
          <button key={lens} type="button" className={`lens ${query.lens === lens ? 'is-active' : ''}`} aria-pressed={query.lens === lens}
            onClick={() => set({ lens, status: lens === 'completed' ? 'done' : query.status === 'done' ? 'open' : query.status })}>
            {LENS_LABELS[lens]}<span className={lens === 'attention' && counts.attention ? 'is-hot' : ''}>{counts[lens]}</span>
          </button>
        ))}
      </nav>

      <div className="registry-tools" role="group" aria-label="Search, filter and sort" data-open={filtersOpen || undefined}>
        <label className="search-field">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
          <input ref={search} type="search" value={query.search} placeholder="Search tasks, people, projects…  ( / )" aria-label="Search tasks" onChange={event => set({ search: event.target.value })} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? 'Hide filters' : filtered ? 'Filters · on' : 'Filters'}</button>
        {query.lens !== 'completed' && (
          <select value={query.status} onChange={event => set({ status: event.target.value as StatusFilter })} aria-label="Status">
            <option value="open">Open</option>
            {BOARD_ORDER.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            <option value="any">Any status</option>
          </select>
        )}
        <select value={query.owner} onChange={event => set({ owner: event.target.value })} aria-label="Owner">
          <option value="">Any owner</option>
          <option value="none">No owner</option>
          {state.people.filter(item => item.role !== 'reviewer').map(item => <option key={item.id} value={item.id}>{item.id === actor ? `${item.name} (you)` : item.name}</option>)}
        </select>
        <select value={query.project} onChange={event => set({ project: event.target.value })} aria-label="Project">
          <option value="">Any project</option>
          <option value="none">No project</option>
          {state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={query.due} onChange={event => set({ due: event.target.value as RegistryQuery['due'] })} aria-label="Due">
          <option value="any">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Next 7 days</option><option value="none">No due date</option>
        </select>
        <select value={query.priority} onChange={event => set({ priority: event.target.value as RegistryQuery['priority'] })} aria-label="Priority">
          <option value="any">Any priority</option><option value="ultra">Ultra Priority</option><option value="high">High</option><option value="normal">Normal</option>
        </select>
        <select value={query.sort} onChange={event => set({ sort: event.target.value as SortKey })} aria-label="Sort">
          {(Object.keys(SORT_LABELS) as SortKey[]).map(sort => <option key={sort} value={sort}>Sort: {SORT_LABELS[sort]}</option>)}
        </select>
        <span className="registry-meta">
          <span className="filters-count">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
          {filtered && <button type="button" className="link" onClick={() => set({ ...DEFAULT_QUERY, lens: query.lens, sort: query.sort, status: query.lens === 'completed' ? 'done' : 'open' })}>Clear filters</button>}
          <span className="segmented" role="group" aria-label="Layout">
            <button type="button" aria-pressed={prefs.layout === 'table'} className={prefs.layout === 'table' ? 'is-on' : ''} onClick={() => setPrefs(current => ({ ...current, layout: 'table' }))}>List</button>
            <button type="button" aria-pressed={prefs.layout === 'board'} className={prefs.layout === 'board' ? 'is-on' : ''} onClick={() => setPrefs(current => ({ ...current, layout: 'board' }))}>Board</button>
          </span>
        </span>
      </div>

      {tasks.length === 0
        ? <Empty title={filtered ? 'No tasks match these filters' : query.lens === 'attention' ? 'Nothing needs attention' : query.lens === 'completed' ? 'Nothing completed yet' : 'No tasks here yet'}>
            {!filtered && query.lens !== 'completed' && canCreate ? 'Create the first one with New task (N).' : undefined}
          </Empty>
        : prefs.layout === 'board'
          ? <Board quest={quest} tasks={tasks} selectedId={selectedId} onSelect={onSelect} />
          : <Table quest={quest} tasks={tasks} selectedId={selectedId} onSelect={onSelect} />}
    </div>
  );
}

function Flags({ quest, task }: { quest: Quest; task: Task }) {
  const flags = rowFlags(quest.state, task, quest.now);
  return (
    <>
      {task.ultra && <span className="tag tag-ultra">Ultra</span>}
      {flags.overdue && <span className="tag tag-overdue">Overdue</span>}
      {flags.blocked && <span className="tag tag-overdue">Blocked</span>}
      {flags.waiting && <span className="tag tag-wait">Waiting</span>}
      {flags.unowned && <span className="tag tag-wait">No owner</span>}
      {task.priority === 'high' && !task.ultra && <span className="tag tag-high">High</span>}
    </>
  );
}

function Table({ quest, tasks, selectedId, onSelect }: { quest: Quest; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { state, now } = quest;
  const today = localDate(now);
  return (
    <div className="registry-table" role="table" aria-label="Tasks">
      <div className="registry-row is-head" role="row">
        <span role="columnheader">Task</span><span role="columnheader">Owner</span><span role="columnheader">Status</span><span role="columnheader">Due</span><span role="columnheader">Project</span><span role="columnheader"><span className="sr-only">Move work forward</span></span>
      </div>
      {tasks.map((task, index) => {
        const flags = rowFlags(state, task, now);
        return (
          <div key={task.id} role="row" style={{ ['--i' as string]: Math.min(index, 12) }}
            className={`registry-row status-${task.status} ${task.id === selectedId ? 'is-selected' : ''} ${flags.overdue || flags.blocked ? 'is-alert' : ''}`}
            onClick={() => onSelect(task.id)}>
            <span role="cell" className="cell-task">
              <span className={`state-dot dot-${task.status}`} aria-hidden="true" />
              <span className="cell-task-text">
                <button type="button" className="row-open" aria-label={`Open ${task.title}`} aria-current={task.id === selectedId || undefined} onClick={event => { event.stopPropagation(); onSelect(task.id); }}><strong>{task.title}</strong></button>
                <small>{task.status === 'blocked' ? `Blocked: ${task.blocker?.note ?? ''}` : task.status === 'done' ? `Completed ${task.completedAt ? new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}` : task.nextAction ? `Next: ${task.nextAction}` : 'No next action yet'}</small>
                <span className="cell-flags"><Flags quest={quest} task={task} /></span>
              </span>
            </span>
            <span role="cell" className="cell-owner"><Avatar state={state} id={task.owner} size="sm" /><span>{task.owner ? firstName(state, task.owner) : <em>Unassigned</em>}</span></span>
            <span role="cell"><StatusPill task={task} /></span>
            <span role="cell" className={flags.overdue ? 'text-danger' : ''}>{task.due ? shortDate(task.due, today) : '—'}</span>
            <span role="cell" className="cell-project">{projectName(state, task.projectId) || '—'}</span>
            <span role="cell" className="cell-act">{task.status !== 'done' && <MoveForward quest={quest} task={task} compact />}</span>
          </div>
        );
      })}
    </div>
  );
}

function Board({ quest, tasks, selectedId, onSelect }: { quest: Quest; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { state, now } = quest;
  const today = localDate(now);
  const columns = boardColumns(tasks).filter(column => column.tasks.length > 0 || column.status !== 'done');
  return (
    <div className="board" aria-label="Tasks by status">
      {columns.map(column => (
        <section key={column.status} className={`board-col col-${column.status}`} aria-label={STATUS_LABELS[column.status]}>
          <h3 className="board-head"><span className={`state-dot dot-${column.status}`} aria-hidden="true" />{STATUS_LABELS[column.status]}<span>{column.tasks.length}</span></h3>
          <div className="board-cards">
            {column.tasks.map(task => (
              <button key={task.id} type="button" className={`board-card ${task.id === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(task.id)} aria-current={task.id === selectedId || undefined}>
                <strong>{task.title}</strong>
                <span className="cell-flags"><Flags quest={quest} task={task} /></span>
                <span className="board-meta"><Avatar state={state} id={task.owner} size="sm" />{task.owner ? firstName(state, task.owner) : 'Unassigned'}{task.due && <> · <span className={rowFlags(state, task, now).overdue ? 'text-danger' : ''}>{shortDate(task.due, today)}</span></>}</span>
              </button>
            ))}
            {column.tasks.length === 0 && <p className="board-empty">Nothing {STATUS_LABELS[column.status].toLowerCase()}.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
