// A task, full screen: identity and the four everyday fields (status, assigned, priority,
// due) up top; brief, people and dependencies on the left; contextual actions and
// the conversation on the right. The quick actions are the engine's authorized offers
// (TaskSituation), never invented here, and every edit is an engine action.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { EditableTaskFields, Task } from '../core/contract.ts';
import { canEditTask, canReopenTask, lockedTaskFields } from '../core/permissions.ts';
import { blockingDeps, dependents, firstName, isOpen, isOverdue, leadById, moveForwardPlan, nameOf, projectName, taskById } from '../core/selectors.ts';
import { completionDetails } from '../core/completed.ts';
import { MAX_ITEMS, addItem, removeItem, splitChecklist, toggleItem, withNotes } from '../core/checklist.ts';
import { Avatar, PersonSelect, TaskTags } from '../ui/components.tsx';
import { useFeedbackRecord } from '../ui/Feedback.tsx';
import { ReferenceInput, ReferenceTextarea } from '../ui/ReferenceEditor.tsx';
import { Select } from '../ui/Select.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { AssigneeSelect, DueInput, PrioritySelect, StatusMenu } from './TaskControls.tsx';
import { TaskSituation } from './WorkSurface.tsx';
import { TaskConversation } from './TaskComments.tsx';
import { useWorkday } from '../shifts/Workday.tsx';

const when = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isFormField = (target: EventTarget) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');

export function TaskPage({ quest, task, canCreate, onClose, onOpen, onCreate, onOpenDock }: {
  quest: Quest; task: Task; canCreate: boolean; onClose: () => void; onOpen: (id: string) => void; onCreate: () => void;
  /** Shows this task's conversation in the collaboration dock (wide screens, where the dock exists). */
  onOpenDock?: (taskId: string) => void;
}) {
  const { state, actor, dispatch } = quest;
  const [title, setTitle] = useState(task.title);
  const [nextAction, setNextAction] = useState(task.nextAction);
  // Notes field shows the description's notes; the trailing checklist block is edited in Checklist.
  const [description, setDescription] = useState(() => splitChecklist(task.description).notes);
  const [waitingOn, setWaitingOn] = useState(task.waitingOn);
  const feedback = useFeedbackRecord(task.id);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTitle(task.title); setNextAction(task.nextAction); setDescription(splitChecklist(task.description).notes); setWaitingOn(task.waitingOn); }, [task.title, task.nextAction, task.description, task.waitingOn]);
  useEffect(() => { window.scrollTo(0, 0); document.querySelector('.main > .content')?.scrollTo(0, 0); back.current?.focus({ preventScroll: true }); }, [task.id]);

  const me = state.people.find(item => item.id === actor);
  const reviewer = me?.role === 'reviewer';
  const editable = canEditTask(state, task, actor);
  const locked = lockedTaskFields(state, task, actor);
  const update = (changes: Partial<EditableTaskFields>) => dispatch({ type: 'task/update', id: task.id, changes });
  const saveText = (key: 'title' | 'nextAction' | 'description' | 'waitingOn', value: string) => { if (value.trim() !== task[key]) void update({ [key]: value.trim() }); };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const lead = task.leadId ? leadById(state, task.leadId) : undefined;
  const waitsOn = task.dependsOn.map(id => taskById(state, id)).filter((item): item is Task => !!item);
  const unlocks = dependents(state, task);
  const candidates = state.tasks.filter(item => (item.id !== task.id && item.status !== 'done') || task.dependsOn.includes(item.id));
  const events = state.events.filter(event => event.taskId === task.id);
  const created = events.find(event => event.text.includes('created'));
  const people = state.people.filter(item => item.role !== 'reviewer');
  const watching = task.watchers.includes(actor);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented && !isFormField(event.target)) { event.stopPropagation(); onClose(); }
  }

  return (
    <article {...feedback} data-feedback-record={task.id} className={`view task-page status-${task.status}`} aria-labelledby="task-page-title" onKeyDown={onKeyDown}>
      <nav className="tp-bar" aria-label="Task">
        <button ref={back} type="button" className="btn btn-ghost btn-sm tp-back" onClick={onClose}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Back
        </button>
        <span className={`ctx-verify ${quest.backend.kind === 'live' ? 'is-live' : ''}`} title={quest.backend.kind === 'live' ? 'Every change is checked again by the server before it is saved.' : 'Demo: every change is checked by the same rules engine, on this device.'}>{quest.backend.kind === 'live' ? 'Server-enforced' : 'Local · engine-checked'}</span>
        <span className="tp-bar-actions">
          {!reviewer && (
            <button type="button" className={`btn btn-sm ${watching ? 'is-on' : 'btn-ghost'} tp-watch`} aria-pressed={watching} onClick={() => void update({ watchers: toggle(task.watchers, actor) })}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /></svg>{watching ? 'Watching' : 'Watch'}
            </button>
          )}
          {canCreate && <button type="button" className="btn btn-primary btn-sm" onClick={onCreate}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New task
          </button>}
        </span>
      </nav>

      <header className="tp-head">
        <p className="ctx-eyebrow">{projectName(state, task.projectId) || 'No project'}{task.leadId ? ' · from a lead' : ''}</p>
        <ReferenceTextarea id="task-page-title" className="title-edit tp-title" rows={1} referenceDocument={task.references?.title} value={title} maxLength={160} readOnly={!editable}
          onChange={event => setTitle(event.target.value)} onBlur={() => saveText('title', title)} aria-label="Task name" />
        <p className="ctx-sub">Created by {nameOf(state, task.createdBy, 'someone')}{created ? ` · ${when(created.at)}` : ''} · updated {when(task.updatedAt)}</p>
        <div className="ctx-tags"><TaskTags state={state} task={task} now={quest.now} /></div>
      </header>


      <dl className="tp-facts" aria-label="Status, assigned, priority and due date">
        <div><dt>Status</dt><dd><StatusMenu quest={quest} task={task} /></dd></div>
        <div><dt>Assigned</dt><dd><Avatar state={state} id={task.owner} size="sm" /><AssigneeSelect quest={quest} task={task} /></dd></div>
        <div><dt>Priority</dt><dd><PrioritySelect quest={quest} task={task} /></dd></div>
        <div><dt>Due</dt><dd><DueInput quest={quest} task={task} overdue={isOverdue(task, quest.now)} />{task.dueTime && <small>{task.dueTime}</small>}</dd></div>
        <div><dt>Project</dt><dd>{editable
          ? <Select className="inline-select" value={task.projectId} aria-label="Project" onChange={event => void update({ projectId: event.target.value })}><option value="">No project</option>{state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
          : projectName(state, task.projectId) || '—'}</dd></div>
      </dl>

      <div className="tp-grid is-flow is-two">
        <div className="tp-col tp-details tp-work" aria-label="Work">
          <section className="tp-card" aria-labelledby="tp-brief">
            <h2 id="tp-brief" className="ctx-label">Brief</h2>
            {task.status !== 'done' && (
              <label className="field"><span>Next action</span>
                <ReferenceInput referenceDocument={task.references?.nextAction} value={nextAction} maxLength={200} readOnly={!editable} placeholder="The next physical step, in one line"
                  onChange={event => setNextAction(event.target.value)} onBlur={() => saveText('nextAction', nextAction)} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
              </label>
            )}
            <label className="field"><span>Notes</span>
              <ReferenceTextarea referenceDocument={task.references?.description} rows={4} value={description} maxLength={1000} readOnly={!editable} placeholder={editable ? 'Context, @people and #tags' : 'No notes'}
                onChange={event => setDescription(event.target.value)} onBlur={() => { const next = withNotes(task.description, description.trim()); if (next !== task.description) void update({ description: next }); }} />
            </label>
            {(editable || task.waitingOn) && (
              <label className="field"><span>Waiting on (outside Task-HQ)</span>
                <ReferenceInput value={waitingOn} maxLength={120} readOnly={!editable} placeholder="e.g. City permit office" onChange={event => setWaitingOn(event.target.value)} onBlur={() => saveText('waitingOn', waitingOn)} />
              </label>
            )}
            {lead && <div className="callout"><b>Lead</b> {lead.name} · {lead.phone} · {lead.address}</div>}
          </section>
          <Checklist quest={quest} task={task} editable={editable} />
          {(waitsOn.length > 0 || unlocks.length > 0) && (
            <section className="tp-card ctx-deps" aria-label="Dependencies">
              {waitsOn.length > 0 && <>
                <h2 className="ctx-label">Starts after</h2>
                <ul>{waitsOn.map(item => <li key={item.id}><button type="button" className="ctx-link" onClick={() => onOpen(item.id)}><span className={`state-dot dot-${item.status}`} aria-hidden="true" />{item.title}<small>{item.status === 'done' ? 'done' : `${firstName(state, item.owner, 'unassigned')} · ${item.status}`}</small></button></li>)}</ul>
              </>}
              {unlocks.length > 0 && <>
                <h2 className="ctx-label">Unlocks</h2>
                <ul>{unlocks.map(item => <li key={item.id}><button type="button" className="ctx-link" onClick={() => onOpen(item.id)}><span className={`state-dot dot-${item.status}`} aria-hidden="true" />{item.title}<small>{firstName(state, item.owner || task.nextOwner, 'needs an owner')}</small></button></li>)}</ul>
              </>}
              {blockingDeps(state, task).length > 0 && isOpen(task) && <p className="muted">This task can’t move until the work above is done.</p>}
            </section>
          )}


          <details className="tp-card drawer-details">
            <summary>More details <small>lifecycle{editable ? ', time, tags, dependencies' : ''}</small></summary>
            <LifecycleReference task={task} />
            {editable && <>
                <div className="roles">
                  {quest.backend.supports?.taskTaxonomy !== false && <>
                    <label className="field"><span>Time</span><input type="time" value={task.dueTime ?? ''} disabled={!task.due || locked} onChange={event => void update({ dueTime: event.target.value })} /></label>
                    {(state.taxonomy?.types.length ?? 0) > 0 && <label className="field"><span>Type</span><Select value={task.type ?? ''} onChange={event => void update({ type: event.target.value })}><option value="">No type</option>{state.taxonomy!.types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
                    <label className="field"><span>Tags</span><input defaultValue={(task.tags ?? []).join(' ')} placeholder="permits safety" onBlur={event => { const tags = event.target.value.split(/[\s,]+/).map(tag => tag.replace(/^#/, '').toLowerCase()).filter(Boolean); if (tags.join(' ') !== (task.tags ?? []).join(' ')) void update({ tags }); }} /></label>
                  </>}
                </div>
                <details className="deps">
                  <summary>Depends on ({task.dependsOn.length})</summary>
                  {candidates.map(item => <label key={item.id} className={`dep-check ${item.status === 'done' ? 'is-completed' : ''}`}><input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={() => void update({ dependsOn: toggle(task.dependsOn, item.id) })} />{item.title}</label>)}
                </details>
                {task.dependsOn.some(id => !taskById(state, id)) && <p className="muted">A dependency was removed.</p>}
            </>}
          </details>
        </div>

        <div className="tp-col tp-momentum" aria-label="People and progress">
          <PeopleProgress quest={quest} task={task} editable={editable} reviewer={reviewer} onOpen={onOpen} />
        </div>
      </div>

      <section className="tp-collab" aria-labelledby="tp-collab-title">
        <header className="tp-collab-head">
          <h2 id="tp-collab-title" className="ctx-label">Collaboration</h2>
          {onOpenDock && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenDock(task.id)}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18M3 19h18M8 11l4-4 4 4" /></svg>Open in dock
          </button>}
        </header>
        <TaskConversation quest={quest} taskId={task.id} />
      </section>
    </article>
  );
}

/** People & progress: who acts now and the primary action, quick actions, and every task role in one
 * roster: owner, next handoff, approver, decision owner and the people kept informed. Names read at a
 * glance; "Edit roles" reveals the same selects (same task/update actions and permissions as before). */
function PeopleProgress({ quest, task, editable, reviewer, onOpen }: { quest: Quest; task: Task; editable: boolean; reviewer: boolean; onOpen: (id: string) => void }) {
  const { state, actor, dispatch } = quest;
  const [editing, setEditing] = useState(false);
  const update = (changes: Partial<EditableTaskFields>) => dispatch({ type: 'task/update', id: task.id, changes });
  const people = state.people.filter(item => item.role !== 'reviewer');
  const who = (id: string, empty: string) => id ? <span className="pp-who"><Avatar state={state} id={id} size="sm" />{id === actor ? 'You' : nameOf(state, id, 'Former member')}</span> : <span className="pp-empty">{empty}</span>;
  const role = (label: string, hint: string, value: string, empty: string, field: 'nextOwner' | 'approver' | 'decisionOwner', emptyLabel?: string) => (
    <div className="pp-role" role="listitem">
      <dt>{label}<small>{hint}</small></dt>
      <dd>{editing && editable ? <PersonSelect state={state} label={label} value={value} emptyLabel={emptyLabel} onChange={id => void update({ [field]: id })} /> : who(value, empty)}</dd>
    </div>
  );
  return (
    <section className="pp" aria-labelledby="pp-title">
      <header className="pp-head">
        <h2 id="pp-title" className="ctx-label">People &amp; progress</h2>
        {editable && <button type="button" className="hd-more" aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Done editing' : 'Edit roles'}</button>}
      </header>
      <ResponsibilityCard quest={quest} task={task} onOpen={onOpen} />
      {!reviewer && <QuickActions quest={quest} task={task} compact />}
      <dl className="pp-roster" role="list" aria-label="Task roles">
        <div className="pp-role" role="listitem"><dt>Owns the work<small>Assigned</small></dt><dd>{who(task.owner, 'Unassigned')}</dd></div>
        {role('Next handoff', 'Receives it when done', task.nextOwner, 'Nobody yet', 'nextOwner')}
        {role('Approves', 'Signs off the work', task.approver, 'No approval needed', 'approver', 'No approval needed')}
        {(editable || task.decisionOwner) && role('Decides', 'Makes the call if needed', task.decisionOwner, 'Nobody', 'decisionOwner')}
        <div className="pp-role is-informed" role="listitem">
          <dt>Kept informed<small>{task.watchers.length ? `${task.watchers.length} watching` : 'Watchers'}</small></dt>
          <dd>
            <span className="pp-watchers">
              {task.watchers.map(id => <span key={id} className="pp-chip"><Avatar state={state} id={id} size="sm" />{id === actor ? 'You' : nameOf(state, id, 'Former member')}
                {(editable || id === actor) && <button type="button" aria-label={`Remove ${id === actor ? 'yourself' : nameOf(state, id)} from watchers`} onClick={() => void update({ watchers: task.watchers.filter(item => item !== id) })}>×</button>}</span>)}
              {task.watchers.length === 0 && <span className="pp-empty">Nobody yet</span>}
            </span>
            {editing && editable && people.some(item => !task.watchers.includes(item.id)) && (
              <Select className="inline-select" value="" aria-label="Add a watcher" onChange={event => { if (event.target.value) void update({ watchers: [...task.watchers, event.target.value] }); }}>
                <option value="">+ Add a watcher</option>
                {people.filter(item => !task.watchers.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.id === actor ? `${item.name} (you)` : item.name}</option>)}
              </Select>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Checklist: steps stored in the task description (core/checklist.ts), saved with the usual task/update. */
function Checklist({ quest, task, editable }: { quest: Quest; task: Task; editable: boolean }) {
  const [draft, setDraft] = useState('');
  const { items } = splitChecklist(task.description);
  const done = items.filter(item => item.done).length;
  const save = (description: string | null) => { if (description != null && description !== task.description) void quest.dispatch({ type: 'task/update', id: task.id, changes: { description } }); };
  if (!editable && items.length === 0) return null;
  return (
    <section className="tp-card tp-checklist" aria-labelledby="tp-checklist-title">
      <h2 id="tp-checklist-title" className="ctx-label">Checklist {items.length > 0 && <span>{done}/{items.length}</span>}</h2>
      {items.length > 0 && <i className="tp-check-meter" aria-hidden="true"><i style={{ width: `${(done / items.length) * 100}%` }} /></i>}
      {items.length > 0 && <ul className="tp-check-list">
        {items.map((item, index) => <li key={`${index}-${item.text}`} className={item.done ? 'is-done' : ''}>
          <label><input type="checkbox" checked={item.done} disabled={!editable} onChange={() => save(toggleItem(task.description, index))} /><span>{item.text}</span></label>
          {editable && <button type="button" className="icon-btn" aria-label={`Remove “${item.text}”`} onClick={() => save(removeItem(task.description, index))}>×</button>}
        </li>)}
      </ul>}
      {editable && items.length < MAX_ITEMS && <form className="tp-check-add" onSubmit={event => { event.preventDefault(); const next = addItem(task.description, draft); if (next) { save(next); setDraft(''); } }}>
        <input value={draft} maxLength={120} placeholder="Add a step" aria-label="Add a checklist step" onChange={event => setDraft(event.target.value)} />
        <button className="btn btn-sm" disabled={!draft.trim()}>Add</button>
      </form>}
    </section>
  );
}

/** Quick actions, always visible: ask a person for help, report being stuck to the team, nudge the
 * assignee, clear a blocker, or clock in. Each is an engine action, so the usual permissions apply. */
function QuickActions({ quest, task, compact = false }: { quest: Quest; task: Task; compact?: boolean }) {
  const { state, actor, dispatch } = quest;
  const workday = useWorkday();
  const [form, setForm] = useState<'help' | 'stuck' | null>(null);
  const [note, setNote] = useState('');
  const [helper, setHelper] = useState('');
  const [error, setError] = useState('');
  const open = task.status !== 'done';
  const owner = task.owner && task.owner !== actor ? task.owner : '';
  const run = async (action: Parameters<typeof dispatch>[0]) => {
    const result = await dispatch(action);
    if (result.ok) { setForm(null); setNote(''); setHelper(''); setError(''); } else setError(result.error);
  };
  if (!open && !workday) return null;
  return (
    <section className={`tp-card tp-quick ${compact ? 'is-compact' : ''}`} aria-labelledby="tp-quick-title">
      <h2 id="tp-quick-title" className={compact ? 'sr-only' : 'ctx-label'}>Quick actions</h2>
      <div className="tp-quick-list">
        {workday && <button type="button" className="tp-quick-btn" onClick={workday.open}><QIcon d="M8 5v14l11-7z" />{workday.shift ? 'On shift · open workday' : 'Clock in on this task'}</button>}
        {open && owner && <button type="button" className="tp-quick-btn" onClick={() => void run({ type: 'task/comment', id: task.id, note: `Nudge for ${firstName(state, owner)}: checking in on this. Where does it stand?` })}><QIcon d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4" />Nudge {firstName(state, owner)}</button>}
        {open && task.status !== 'blocked' && <button type="button" className="tp-quick-btn" aria-expanded={form === 'help'} onClick={() => setForm(form === 'help' ? null : 'help')}><QIcon d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v.01M9 9.5a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.1-1.5 2.1" />Request help</button>}
        {open && task.status !== 'blocked' && <button type="button" className="tp-quick-btn" aria-expanded={form === 'stuck'} onClick={() => setForm(form === 'stuck' ? null : 'stuck')}><QIcon d="M12 4 21 20H3zM12 10v4M12 17v.5" />I’m stuck</button>}
        {open && task.status === 'blocked' && <button type="button" className="tp-quick-btn" onClick={() => void run({ type: 'task/resolve', id: task.id })}><QIcon d="M5 12l5 5L20 7" />Mark unblocked</button>}
      </div>
      {form && <form className="offer-form" onSubmit={event => { event.preventDefault(); void run({ type: 'task/request-help', id: task.id, note, ...(form === 'help' && helper ? { helper } : {}) }); }}>
        {form === 'help' && <label className="field"><span>Ask</span><PersonSelect state={{ ...state, people: state.people.filter(item => item.id !== actor && item.role !== 'reviewer') }} label="Ask for help" value={helper} emptyLabel="Anyone on the team" onChange={setHelper} /></label>}
        <label className="field"><span>{form === 'help' ? 'What do you need?' : 'What’s blocking you?'}</span><input autoFocus required maxLength={200} value={note} onChange={event => setNote(event.target.value)} /></label>
        <p className="muted">This marks the task Blocked and tells {form === 'help' && helper ? firstName(state, helper) : 'the team'}.</p>
        <span className="offer-form-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!note.trim()}>{form === 'help' ? 'Ask for help' : 'Report blocker'}</button></span>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
const QIcon = ({ d }: { d: string }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** Completed work: who finished it, and the authorized way to reopen it. */
function Completed({ quest, task }: { quest: Quest; task: Task }) {
  const { state, actor, dispatch, backend } = quest;
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const finish = state.events.find(event => event.taskId === task.id && !event.undone && event.undo?.tasks[task.id] && event.undo.tasks[task.id]!.status !== 'done');
  const completion = completionDetails(state, task);
  const latest = state.events.find(event => event.taskId === task.id && !event.undone);
  const canUndo = !!finish && finish === latest && finish.actor === actor && !!finish.undo;
  // A live server older than dispatch v5 predates `task/reopen`; there, reopening
  // is limited to undoing your own completion.
  const reopenAvailable = backend.supports?.taskReopen !== false;
  const allowed = canReopenTask(state, task, actor);

  async function reopen(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/reopen', id: task.id, note });
    if (result.ok) { setNote(''); setOpen(false); }
  }
  const by = completion.actor || finish?.actor || '';
  const approved = finish?.kind === 'approval';
  const archiveAvailable = backend.supports?.taskArchive !== false && allowed;
  return (
    <div className={`ctx-done ${task.archivedAt ? 'is-archived' : ''}`}>
      <p className="ctx-done-state" role="status"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <b>{approved ? 'Approved and completed' : 'Completed'}</b>{completion.at !== null ? ` ${when(completion.at)}` : ''}{by ? ` · ${nameOf(state, by, 'Former member')}` : ' · Completion actor unavailable in retained history'}</p>
      {task.archivedAt ? <p className="muted">Archived {when(task.archivedAt)}{task.archivedBy ? ` · ${nameOf(state, task.archivedBy, 'someone')}` : ''}. Its history is kept.</p> : null}
      {canUndo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'undo', eventId: finish!.id })}>Undo my completion</button>}
      {allowed && reopenAvailable && !open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Reopen…</button>}
      {allowed && reopenAvailable && open && (
        <form className="offer-form" onSubmit={event => void reopen(event)}>
          <label className="field"><span>Why is it being reopened?</span><ReferenceInput autoFocus required maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="Becomes the next action" /></label>
          <span className="offer-form-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!note.trim()}>Reopen</button></span>
        </form>
      )}
      {archiveAvailable && !open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: task.archivedAt ? 'task/unarchive' : 'task/archive', id: task.id })}>{task.archivedAt ? 'Restore from archive' : 'Archive'}</button>}
      {allowed && !reopenAvailable && !canUndo && <p className="muted">Reopening finished work arrives with the next server release. Until then, create a follow-up task.</p>}
    </div>
  );
}

/** One presentation of the existing lifecycle and its engine-authorized actions. */
export function ResponsibilityCard({ quest, task, onOpen }: { quest: Quest; task: Task; onOpen: (id: string) => void }) {
  const { state, actor } = quest;
  const plan = moveForwardPlan(state, task, actor);
  const dependency = blockingDeps(state, task)[0];
  const responsible = dependency ? dependency.owner : task.status === 'review' ? task.approver : task.status === 'blocked' ? task.blocker?.helper || task.owner : task.owner;
  const heading = task.status === 'done' ? 'Completed' : responsible === actor ? 'Your turn' : responsible ? `Waiting on ${nameOf(state, responsible, 'a former member')}` : task.status === 'review' ? 'Approver not assigned' : 'Responsibility not assigned';
  const action = dependency ? plan.current : task.status === 'review' ? `Review the work${task.approver ? ` · Approver: ${nameOf(state, task.approver)}` : ''}` : task.status === 'blocked' ? `Resolve blocker: ${task.blocker?.note || 'Needs help'}` : task.nextAction || (task.status === 'ready' ? 'Start the work' : 'Finish the work');
  const handoff = task.status !== 'review' && task.status !== 'done' && task.approver ? `Next: review by ${nameOf(state, task.approver)}` : task.nextOwner ? `Next handoff: ${nameOf(state, task.nextOwner)}` : 'Next handoff not assigned';
  return <section className={`tp-story tp-actions ${task.status === 'done' ? 'is-done' : ''}`} aria-labelledby="tp-story-title">
    <div className="tp-story-person">{responsible && task.status !== 'done' && <Avatar state={state} id={responsible} size="md" />}<div><p className="tp-story-label">Who acts next</p><h2 id="tp-story-title">{heading}</h2></div></div>
    {task.status === 'done' ? <Completed quest={quest} task={task} /> : <><p className="tp-story-action"><span className="tp-story-k">What to do</span>{action}</p>{task.waitingOn && <p>External wait: {task.waitingOn}</p>}<TaskSituation key={task.id} quest={quest} taskId={task.id} onOpen={onOpen} actionsOnly /></>}
    <p className="tp-story-handoff">{handoff}</p>
  </section>;
}

/** Where the task sits in the usual lifecycle. A reference only, so it lives under "More details". */
function LifecycleReference({ task }: { task: Task }) {
  return <section className="tp-lifecycle" aria-label="Lifecycle reference">
    <h3 className="ctx-label tp-sub">Lifecycle</h3>
    <ol className="tp-journey" aria-label="Lifecycle reference, not a record of visited states">{(['ready', 'working', 'review', 'done'] as const).map(status => <li key={status} aria-current={task.status === status ? 'step' : undefined}>{({ ready: 'Ready', working: 'Working', review: 'In Review', done: 'Done' })[status]}{status === 'review' && <small>{task.approver ? 'When approval is required' : 'Optional · no approver set'}</small>}</li>)}</ol>
    <p className="tp-story-note">{task.status === 'blocked' ? 'Currently blocked. ' : ''}Lifecycle reference only; steps may be skipped. See History for actual transitions.</p>
  </section>;
}
