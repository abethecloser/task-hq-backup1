import { TaskFilters } from './TopBar.tsx';
import type { TopTab } from './TopBar.tsx';
import { Select } from '../ui/Select.tsx';
import { feedbackAttributes } from '../ui/Feedback.tsx';
// All Tasks: the operational center. One registry, a scope switch (My work / Company)
// and five lenses (All tasks, Urgent, Today, Overdue, Watching), dense table or
// status board. Selecting a row opens it in the right-hand context panel; the
// row's own control moves the work forward without leaving the list.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { BOARD_ORDER, DEFAULT_QUERY, LEGACY_LENSES, LENSES, LENS_HINTS, LENS_LABELS, SORT_LABELS, boardColumns, isCompletedQuery, queryTasks, rowFlags } from '../core/registry.ts';
import type { Lens, RegistryQuery, Scope, SortKey, StatusFilter } from '../core/registry.ts';
import { firstName, nameOf, projectName } from '../core/selectors.ts';
import { completionDetails } from '../core/completed.ts';
import { localDate, shortDate } from '../core/time.ts';
import { Avatar, Empty } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { JobPicker } from './JobPicker.tsx';
import { AssigneeSelect, DueInput, PrioritySelect, StatusMenu } from './TaskControls.tsx';
import { ActiveFilters, FILTER_DEFAULTS, FilterSection, activeFilterCount, filterFields, sameFilters } from './RegistryFilters.tsx';
import type { DraftEdit, FilterFields } from './RegistryFilters.tsx';

type Layout = 'table' | 'board';
const EMPTY: Record<Lens, string> = { all: 'No tasks here yet', urgent: 'Nothing urgent', today: 'Nothing due today', overdue: 'Nothing is overdue', watching: 'You aren’t watching anything' };
export const LENS_ICONS: Record<Lens, string> = {
  all: 'M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10',
  urgent: 'M13 3 5 14h6l-1 7 8-11h-6z',
  today: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z',
  overdue: 'M12 4 21 20H3zM12 10v4M12 17v.5',
  watching: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
const prefKey = (tenant: string, actor: string) => `quest.registry.v1.${tenant}.${actor}`;

function loadPrefs(key: string): { query: RegistryQuery; layout: Layout } {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (raw && typeof raw === 'object') {
      const query = { ...DEFAULT_QUERY, ...raw.query, ...LEGACY_LENSES[raw.query?.lens], search: '' };
      return { query: LENSES.includes(query.lens) ? query : { ...query, lens: 'all' }, layout: raw.layout === 'board' ? 'board' : 'table' };
    }
  } catch { /* preferences are optional */ }
  return { query: DEFAULT_QUERY, layout: 'table' };
}

/** Owned by the shell so leaving the registry keeps the current search and filters. */
export function useRegistryPrefs(tenant: string, actor: string) {
  const key = prefKey(tenant, actor);
  const [stored, setStored] = useState(() => ({ key, prefs: loadPrefs(key) }));
  const prefs = stored.key === key ? stored.prefs : loadPrefs(key);
  if (stored.key !== key) setStored({ key, prefs });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* this page only */ } }, [key, prefs]);
  const setPrefs = (update: (current: typeof prefs) => typeof prefs) => {
    setStored(current => ({ key, prefs: update(current.key === key ? current.prefs : loadPrefs(key)) }));
  };
  return { prefs, setPrefs };
}

/** A jump into the registry from elsewhere: lens plus filters, applied once per nonce. Scope is kept unless the changes set it.
 *  `keep` (the top-bar view tabs) changes only the lens and leaves every filter, job and search as they are. */
export interface RegistryPreset { lens: Lens; changes?: Partial<RegistryQuery>; keep?: boolean; nonce: number }

export function AllTasks({ quest, selectedId, onSelect, onCreate, canCreate, preset, onPresetApplied, registry, lenses, onLens }: {
  quest: Quest; selectedId: string | null; onSelect: (id: string) => void; onCreate: () => void; canCreate: boolean;
  preset?: RegistryPreset | null; onPresetApplied?: () => void;
  registry: ReturnType<typeof useRegistryPrefs>;
  /** Lens filters (All · Today · Overdue · Urgent · More), shown beside the scope switch. */
  lenses?: TopTab[]; onLens?: (id: string) => void;
}) {
  const { state, actor, now } = quest;
  const { prefs, setPrefs } = registry;
  const query = prefs.query;
  const completed = isCompletedQuery(query);
  const search = useRef<HTMLInputElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!preset) return;
    setPrefs(current => ({ ...current, layout: preset.changes?.status === 'done' ? 'table' : current.layout, query: preset.keep
      ? { ...current.query, lens: preset.lens, ...(isCompletedQuery(current.query) ? { status: 'open' as const } : {}) }
      : { ...DEFAULT_QUERY, sort: current.query.sort, scope: current.query.scope, lens: preset.lens, ...preset.changes } }));
    if (!preset.keep) setPendingDraft(null); // a jump from elsewhere replaces any unapplied choices
    onPresetApplied?.(); // applied once: returning to All Tasks later keeps the person's own filters
  }, [preset, onPresetApplied]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (changes: Partial<RegistryQuery>) => setPrefs(current => ({ ...current, query: { ...current.query, ...changes } }));
  const pickScope = (scope: Scope) => set({ scope });
  const activeFilters = activeFilterCount(query, { includeJob: false });
  // Filter choices are a draft until Apply; null means "same as what's applied". Kept while collapsed.
  const [pendingDraft, setPendingDraft] = useState<FilterFields | null>(null);
  const draft = pendingDraft ?? filterFields(query);
  const pending = !!pendingDraft && !sameFilters(pendingDraft, filterFields(query));
  const editDraft = (edit: DraftEdit) => setPendingDraft(current => {
    const base = current ?? filterFields(query);
    return { ...base, ...(typeof edit === 'function' ? edit(base) : edit) };
  });
  const applyDraft = () => { set(draft); setPendingDraft(null); };
  const removeFilter = (changes: Partial<FilterFields>) => { set(changes); setPendingDraft(current => current && { ...current, ...changes }); };
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => queryTasks(state, actor, minute * 60000, query), [state, actor, minute, query]);
  const filtered = !!query.search || !!query.company || activeFilterCount(query) > 0;
  const live = quest.backend.kind === 'live';

  return (
    <div className={`view registry ${completed ? 'is-completed' : ''}`}>
      <header className="view-head">
        <div>
          <p className="eyebrow">{live ? `${state.workspace.name} · task registry` : 'Task-HQ Demo · synthetic records'}</p>
          <div className="view-title-row">
            <h1>{completed ? 'Completed' : query.lens === 'all' ? 'Tasks' : LENS_LABELS[query.lens]}</h1>
            <div className="scope-seg" role="group" aria-label="Whose tasks">
              <button type="button" aria-pressed={query.scope === 'mine'} onClick={() => pickScope('mine')}>
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0" /></svg>My work
              </button>
              <button type="button" aria-pressed={query.scope === 'company'} onClick={() => pickScope('company')}>
                <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" /></svg>Company
              </button>
            </div>
            {lenses && onLens && <div className="registry-lenses"><TaskFilters tabs={lenses} onTab={onLens} /></div>}
          </div>
          <p className="lede">{completed ? `${query.scope === 'mine' ? 'Your completed work' : 'Completed work visible in this company'} · ${query.sort === 'urgency' ? 'newest completions first' : SORT_LABELS[query.sort].toLowerCase()}. Open a task for comments, history, Reopen or Archive.` : query.lens === 'watching' ? LENS_HINTS.watching : `${query.scope === 'mine' ? 'Your work' : 'The whole company'} · ${LENS_HINTS[query.lens]}`}</p>
        </div>
        {/* New task is the top bar's quick action. */}
      </header>


      <div className="registry-controls">
      <div className="registry-tools" role="group" aria-label="Search, filter and sort">
        <JobPicker state={state} actor={actor} scope={query.scope} project={query.project} company={query.company}
          onChange={({ project, company }) => { set({ company }); removeFilter({ project }); }} />
        <label className="search-field registry-search">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
          <input ref={search} type="search" value={query.search} placeholder="Search tasks, people, projects…  ( / )" aria-label="Search tasks" onChange={event => set({ search: event.target.value })} />
        </label>
        <button type="button" className={`btn filters-button ${activeFilters ? 'is-on' : ''}`} aria-controls="registry-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" /></svg>
          Filters{pending && <span className="filters-pending-dot" title="Changes not applied yet" />}{activeFilters > 0 && <span className="filters-badge" aria-label={`${activeFilters} active`}>{activeFilters}</span>}
        </button>
        <Select value={query.sort} onChange={event => set({ sort: event.target.value as SortKey })} aria-label="Sort">
          {(Object.keys(SORT_LABELS) as SortKey[]).map(sort => <option key={sort} value={sort}>Sort: {completed && sort === 'urgency' ? 'Completed · newest first' : SORT_LABELS[sort]}</option>)}
        </Select>
        <span className="registry-meta">
          <span className="filters-count">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}</span>
          {filtered && <button type="button" className="link" onClick={() => { set({ ...DEFAULT_QUERY, scope: query.scope, lens: query.lens, sort: query.sort }); setPendingDraft(null); }}>Clear filters</button>}
          <span className="segmented" role="group" aria-label="Layout">
            <button type="button" aria-pressed={prefs.layout === 'table'} className={prefs.layout === 'table' ? 'is-on' : ''} onClick={() => setPrefs(current => ({ ...current, layout: 'table' }))}>List</button>
            <button type="button" aria-pressed={prefs.layout === 'board'} className={prefs.layout === 'board' ? 'is-on' : ''} onClick={() => setPrefs(current => ({ ...current, layout: 'board' }))}>Board</button>
          </span>
        </span>
      </div>
      <FilterSection id="registry-filters" open={filtersOpen} state={state} actor={actor} draft={draft} pending={pending}
        onDraft={editDraft} onApply={applyDraft} onClearAll={() => editDraft(FILTER_DEFAULTS)} />
      {!filtersOpen && <ActiveFilters state={state} actor={actor} query={query} onRemove={removeFilter} />}
      </div>

      {tasks.length === 0
        ? <Empty title={completed ? 'No completed tasks in this scope' : filtered ? 'No tasks match these filters' : EMPTY[query.lens]}>
            {completed ? 'Completed tasks stay here until archived or reopened. Try the other scope or adjust your filters.' : !filtered && query.lens === 'all' && canCreate ? 'Create the first one with New task (N).' : undefined}
          </Empty>
        : prefs.layout === 'board'
          ? <Board quest={quest} tasks={tasks} selectedId={selectedId} onSelect={onSelect} />
          : <Table quest={quest} tasks={tasks} selectedId={selectedId} onSelect={onSelect} />}
    </div>
  );
}

function Flags({ quest, task, priority = true }: { quest: Quest; task: Task; priority?: boolean }) {
  const flags = rowFlags(quest.state, task, quest.now);
  return (
    <>
      {task.ultra && <span className="tag tag-ultra">Ultra</span>}
      {task.type && <span className="tag tag-type">{quest.state.taxonomy?.types.find(item => item.id === task.type)?.label ?? task.type}</span>}
      {(task.tags ?? []).map(tag => <span key={tag} className="tag tag-tag">#{tag}</span>)}
      {flags.overdue && <span className="tag tag-overdue">Overdue</span>}
      {flags.blocked && <span className="tag tag-overdue">Blocked</span>}
      {flags.waiting && <span className="tag tag-wait">Waiting</span>}
      {flags.unowned && <span className="tag tag-wait">No owner</span>}
      {priority && task.priority === 'high' && !task.ultra && <span className="tag tag-high">High</span>}
    </>
  );
}

function Table({ quest, tasks, selectedId, onSelect }: { quest: Quest; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { state, now } = quest;
  return (
    <div className="registry-table" role="table" aria-label="Tasks">
      <div className="registry-row is-head" role="row">
        <span role="columnheader">Task</span><span role="columnheader">Assigned</span><span role="columnheader">Status</span><span role="columnheader">Priority</span><span role="columnheader">Due</span>
      </div>
      {tasks.map((task, index) => {
        const flags = rowFlags(state, task, now);
        return (
          <div key={task.id} role="row" style={{ ['--i' as string]: Math.min(index, 12) }}
            {...feedbackAttributes(quest.feedback?.record(task.id))} data-feedback-record={task.id} className={`registry-row status-${task.status} ${task.id === selectedId ? 'is-selected' : ''} ${flags.overdue || flags.blocked ? 'is-alert' : ''}`}
            onClick={() => onSelect(task.id)}>
            <span role="cell" className="cell-task">
              <span className={`state-dot dot-${task.status}`} aria-hidden="true" />
              <span className="cell-task-text">
                <button type="button" className="row-open" aria-label={`Open ${task.title}`} aria-current={task.id === selectedId || undefined} onClick={event => { event.stopPropagation(); onSelect(task.id); }}><strong>{task.title}</strong></button>
                {task.projectId && <span className="cell-project">{projectName(state, task.projectId)}</span>}
                <small>{task.status === 'blocked' ? `Blocked: ${task.blocker?.note ?? ''}` : task.status === 'done' ? <CompletionMeta quest={quest} task={task} /> : task.nextAction ? `Next: ${task.nextAction}` : 'No next action yet'}</small>
                <span className="cell-flags"><Flags quest={quest} task={task} priority={false} /></span>
              </span>
            </span>
            <span role="cell" className="cell-owner"><Avatar state={state} id={task.owner} size="sm" /><AssigneeSelect quest={quest} task={task} short /></span>
            <span role="cell" className="cell-status"><StatusMenu quest={quest} task={task} /></span>
            <span role="cell" className="cell-priority"><PrioritySelect quest={quest} task={task} /></span>
            <span role="cell" className={`cell-due ${flags.overdue ? 'text-danger' : ''}`}><DueInput quest={quest} task={task} overdue={flags.overdue} />{task.dueTime && <small className="cell-time"> {task.dueTime}</small>}</span>
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
                {task.status === 'done' && <small><CompletionMeta quest={quest} task={task} /></small>}
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

function CompletionMeta({ quest, task }: { quest: Quest; task: Task }) {
  const { actor, at } = completionDetails(quest.state, task);
  return <>Completed by {actor ? nameOf(quest.state, actor, 'Former member') : 'actor unavailable'} · {at !== null ? <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time> : 'time unavailable'}</>;
}
