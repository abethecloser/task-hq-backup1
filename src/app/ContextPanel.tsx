import { Select } from '../ui/Select.tsx';
import { useFeedbackRecord } from '../ui/Feedback.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
// RIGHT ZONE — Context & Execution. With a task selected it shows identity,
// ownership, urgency, dependencies, history and the authorized next actions
// (composed by the engine, never invented here). With nothing selected it shows
// compact operational signals, or stays collapsed when there is nothing to say.
// Docked beside the canvas on wide screens (the canvas reflows); a drawer otherwise.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EditableTaskFields, Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { dailySignal } from '../core/executive.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { digest, dueOn, heatGrid, systemInsights } from '../core/dashboard.ts';
import type { SystemInsight } from '../core/dashboard.ts';
import { canAssignOthers, canEditTask, canReopenTask, lockedTaskFields } from '../core/permissions.ts';
import { blockingDeps, dependents, firstName, isOpen, isOverdue, leadById, nameOf, projectName, taskById } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import { Avatar, PersonSelect, StatusPill, TaskTags } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { Notification } from './notifications.ts';
import { NOTIFICATION_LABELS } from './notifications.ts';
import { TaskSituation } from './WorkSurface.tsx';

const when = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function TaskContext({ quest, task, docked, onClose, onOpen }: { quest: Quest; task: Task; docked: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const { state, actor, now, dispatch } = quest;
  const [title, setTitle] = useState(task.title);
  const [nextAction, setNextAction] = useState(task.nextAction);
  const [description, setDescription] = useState(task.description);
  const [comment, setComment] = useState('');
  const [waitingOn, setWaitingOn] = useState(task.waitingOn);
  const feedback = useFeedbackRecord(task.id);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { setTitle(task.title); setNextAction(task.nextAction); setDescription(task.description); setWaitingOn(task.waitingOn); }, [task.title, task.nextAction, task.description, task.waitingOn]);
  useEffect(() => { if (!docked) panel.current?.querySelector<HTMLElement>('.context-close')?.focus(); }, [docked, task.id]);

  const me = state.people.find(item => item.id === actor);
  const reviewer = me?.role === 'reviewer';
  const lockedFields = lockedTaskFields(state, task, actor);
  // Live members edit their own tasks; on anyone else's they can comment, watch and ask for help where they're involved.
  const editable = canEditTask(state, task, actor);
  const assigns = canAssignOthers(state, actor);
  const update = (changes: Partial<EditableTaskFields>) => dispatch({ type: 'task/update', id: task.id, changes });
  const saveText = (key: 'title' | 'nextAction' | 'description' | 'waitingOn', value: string) => { if (value.trim() !== task[key]) void update({ [key]: value.trim() }); };
  const lead = task.leadId ? leadById(state, task.leadId) : undefined;
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const candidates = state.tasks.filter(item => (item.id !== task.id && item.status !== 'done') || task.dependsOn.includes(item.id));
  const waitsOn = task.dependsOn.map(id => taskById(state, id)).filter((item): item is Task => !!item);
  const unlocks = dependents(state, task);
  const history = state.events.filter(event => event.taskId === task.id).slice(0, 8);
  const created = state.events.find(event => event.taskId === task.id && event.text.includes('created'));
  const today = localDate(now);

  return (
    <aside {...feedback} data-feedback-record={task.id} ref={panel} className={`context context-task ${docked ? 'is-docked' : 'is-drawer'}`}
      role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-labelledby="context-title"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header className="context-head">
        <span className="context-label">Instrument deck</span>
        <span className={`ctx-verify ${quest.backend.kind === 'live' ? 'is-live' : ''}`} title={quest.backend.kind === 'live' ? 'Every change is checked again by the server before it is saved.' : 'Demo: every change is checked by the same rules engine, on this device.'}>{quest.backend.kind === 'live' ? 'Server-enforced' : 'Local · engine-checked'}</span>
        <button type="button" className="icon-btn context-close" aria-label="Close task" onClick={onClose}>×</button>
      </header>
      <div className="context-body">
        <section className="ctx-identity">
          <p className="ctx-eyebrow">{projectName(state, task.projectId) || 'No project'}{task.leadId ? ' · from a lead' : ''}</p>
          <ReferenceTextarea id="context-title" className="title-edit" rows={2} referenceDocument={task.references?.title} value={title} maxLength={160} readOnly={!editable}
            onChange={event => setTitle(event.target.value)} onBlur={() => saveText('title', title)} aria-label="Task name" />
          <p className="ctx-sub">Created by {nameOf(state, task.createdBy, 'someone')}{created ? ` · ${when(created.at)}` : ''} · updated {when(task.updatedAt)}</p>
          <div className="ctx-tags"><TaskTags state={state} task={task} now={now} /></div>
        </section>

        <dl className="ctx-state" aria-label="State, owner, priority and due date">
          <div><dt>State</dt><dd><span className={`state-dot dot-${task.status}`} aria-hidden="true" />{STATUS_LABELS[task.status]}</dd></div>
          <div><dt>Owner</dt><dd><Avatar state={state} id={task.owner} size="sm" />{task.owner ? (task.owner === actor ? 'You' : nameOf(state, task.owner)) : <em>Unassigned</em>}</dd></div>
          <div><dt>Priority</dt><dd>{task.ultra ? 'Ultra Priority' : task.priority === 'high' ? 'High' : 'Normal'}</dd></div>
          <div><dt>Due</dt><dd className={isOverdue(task, now) ? 'text-danger' : ''}>{task.due ? shortDate(task.due, today) : '—'}{task.dueTime ? ` · ${task.dueTime}` : ''}{isOverdue(task, now) ? ' · overdue' : ''}</dd></div>
        </dl>
        <dl className="ctx-grid" aria-label="People and classification">
          {task.type && <div><dt>Type</dt><dd>{state.taxonomy?.types.find(item => item.id === task.type)?.label ?? task.type}</dd></div>}
          {(task.tags ?? []).length > 0 && <div><dt>Tags</dt><dd>{(task.tags ?? []).map(tag => `#${tag}`).join(' ')}</dd></div>}
          <div><dt>Next step owner</dt><dd>{task.nextOwner ? nameOf(state, task.nextOwner) : '—'}</dd></div>
          <div><dt>Approver</dt><dd>{task.approver ? nameOf(state, task.approver) : 'None'}</dd></div>
          {task.decisionOwner && <div><dt>Decision owner</dt><dd>{nameOf(state, task.decisionOwner)}</dd></div>}
          {task.waitingOn && <div><dt>Waiting on</dt><dd>{task.waitingOn}</dd></div>}
        </dl>

        {task.status !== 'done' && (
          <label className="field next-field"><span>Next action</span>
            <ReferenceInput referenceDocument={task.references?.nextAction} value={nextAction} maxLength={200} readOnly={!editable} placeholder="The next physical step, in one line" onChange={event => setNextAction(event.target.value)} onBlur={() => saveText('nextAction', nextAction)} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
          </label>
        )}

        {task.status === 'done' ? <Completed quest={quest} task={task} /> : <TaskSituation quest={quest} taskId={task.id} onOpen={onOpen} />}

        {lead && <div className="callout"><b>Lead</b> {lead.name} · {lead.phone} · {lead.address}</div>}

        {(waitsOn.length > 0 || unlocks.length > 0) && (
          <section className="ctx-deps" aria-label="Dependencies">
            {waitsOn.length > 0 && <>
              <h4 className="ctx-label">Starts after</h4>
              <ul>{waitsOn.map(item => <li key={item.id}><button type="button" className="ctx-link" onClick={() => onOpen(item.id)}><span className={`state-dot dot-${item.status}`} aria-hidden="true" />{item.title}<small>{item.status === 'done' ? 'done' : `${firstName(state, item.owner, 'unassigned')} · ${item.status}`}</small></button></li>)}</ul>
            </>}
            {unlocks.length > 0 && <>
              <h4 className="ctx-label">Unlocks</h4>
              <ul>{unlocks.map(item => <li key={item.id}><button type="button" className="ctx-link" onClick={() => onOpen(item.id)}><span className={`state-dot dot-${item.status}`} aria-hidden="true" />{item.title}<small>{firstName(state, item.owner || task.nextOwner, 'needs an owner')}</small></button></li>)}</ul>
            </>}
            {blockingDeps(state, task).length > 0 && isOpen(task) && <p className="muted">This task can’t move until the work above is done.</p>}
          </section>
        )}

        {history.length > 0 && (
          <section className="ctx-history" aria-label="History">
            <h4 className="ctx-label">History & evidence</h4>
            <ol>{history.map(event => <li key={event.id} className={event.undone ? 'is-undone' : ''}><time>{when(event.at)}</time><p><ReferencedText text={event.text} document={event.references?.text} /></p></li>)}</ol>
          </section>
        )}

        {!reviewer && !editable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void update({ watchers: toggle(task.watchers, actor) })}>{task.watchers.includes(actor) ? 'Stop watching' : 'Watch this task'}</button>
        )}
        {editable && (
          <details className="drawer-details">
            <summary>Edit people, dates & dependencies</summary>
            <div className="roles">
              <label className="field"><span>Owner (does the work)</span><PersonSelect state={state} label="Owner" value={task.owner} emptyLabel="Unassigned" disabled={lockedFields || !assigns} onChange={id => void update({ owner: id })} />{!assigns && <small className="field-hint">Use Hand off to pass your task on. A supervisor, admin or owner reassigns work.</small>}</label>
              <label className="field"><span>Next-step owner (receives the handoff)</span><PersonSelect state={state} label="Next-step owner" value={task.nextOwner} onChange={id => void update({ nextOwner: id })} /></label>
              <label className="field"><span>Approver (reviews before done)</span><PersonSelect state={state} label="Approver" value={task.approver} emptyLabel="No approval needed" onChange={id => void update({ approver: id })} /></label>
              <label className="field"><span>Decision owner</span><PersonSelect state={state} label="Decision owner" value={task.decisionOwner} onChange={id => void update({ decisionOwner: id })} /></label>
              <label className="field"><span>Waiting on (outside Task-HQ)</span><ReferenceInput value={waitingOn} maxLength={120} placeholder="e.g. City permit office" onChange={event => setWaitingOn(event.target.value)} onBlur={() => saveText('waitingOn', waitingOn)} /></label>
              <div className="field"><span>Watchers / coordinators</span>
                <div className="watchers">{state.people.filter(item => item.role !== 'reviewer').map(item => (
                  <button key={item.id} type="button" className={`chip ${task.watchers.includes(item.id) ? 'is-on' : ''}`} onClick={() => void update({ watchers: toggle(task.watchers, item.id) })}>{item.name.split(' ')[0]}</button>
                ))}</div>
              </div>
              <label className="field"><span>Due</span><input type="date" value={task.due} disabled={lockedFields} onChange={event => void update({ due: event.target.value })} /></label>
              <label className="field"><span>Priority</span><Select value={task.priority} disabled={lockedFields} onChange={event => void update({ priority: event.target.value as Task['priority'] })}><option value="normal">Normal</option><option value="high">High</option></Select></label>
              <label className="field"><span>Project</span><Select value={task.projectId} onChange={event => void update({ projectId: event.target.value })}><option value="">No project</option>{state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
              {quest.backend.supports?.taskTaxonomy !== false && <>
                <label className="field"><span>Time</span><input type="time" value={task.dueTime ?? ''} disabled={!task.due} onChange={event => void update({ dueTime: event.target.value || undefined })} /></label>
                {(state.taxonomy?.types.length ?? 0) > 0 && <label className="field"><span>Type</span><Select value={task.type ?? ''} onChange={event => void update({ type: event.target.value || undefined })}><option value="">No type</option>{state.taxonomy!.types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
                <label className="field"><span>Tags</span><input defaultValue={(task.tags ?? []).join(' ')} placeholder="permits safety" onBlur={event => { const tags = event.target.value.split(/[\s,]+/).map(tag => tag.replace(/^#/, '').toLowerCase()).filter(Boolean); if (tags.join(' ') !== (task.tags ?? []).join(' ')) void update({ tags }); }} /></label>
              </>}
            </div>
            <details className="deps">
              <summary>Depends on ({task.dependsOn.length})</summary>
              {candidates.map(item => <label key={item.id} className="dep-check"><input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={() => void update({ dependsOn: toggle(task.dependsOn, item.id) })} />{item.title}</label>)}
            </details>
            <label className="field"><span>Notes</span><ReferenceTextarea referenceDocument={task.references?.description} rows={3} value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} onBlur={() => saveText('description', description)} /></label>
            {!reviewer && <form className="task-comment-form" onSubmit={async e => { e.preventDefault(); const r = await dispatch({ type: 'task/comment', id: task.id, note: comment }); if (r.ok) setComment(''); }}><label className="field"><span>Comment</span><ReferenceTextarea rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} aria-label="Task comment" placeholder="Add a note with @people or #tags" /></label><button className="btn btn-sm" disabled={!comment.trim()}>Add comment</button></form>}
            {task.dependsOn.some(id => !taskById(state, id)) && <p className="muted">A dependency was removed.</p>}
          </details>
        )}
      </div>
    </aside>
  );
}

/** Completed work: who finished it, and the authorized way to reopen it. */
function Completed({ quest, task }: { quest: Quest; task: Task }) {
  const { state, actor, dispatch, backend } = quest;
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const finish = state.events.find(event => event.taskId === task.id && !event.undone && event.undo?.tasks[task.id] && event.undo.tasks[task.id]!.status !== 'done');
  const latest = state.events.find(event => event.taskId === task.id && !event.undone);
  const canUndo = !!finish && finish === latest && finish.actor === actor && !!finish.undo;
  // The deployed live server predates `task/reopen`; until the staged dispatch
  // function is released, live reopen is limited to undoing your own completion.
  const reopenAvailable = backend.kind !== 'live';
  const allowed = canReopenTask(state, task, actor);

  async function reopen(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/reopen', id: task.id, note });
    if (result.ok) { setNote(''); setOpen(false); }
  }
  return (
    <section className="ctx-done" aria-label="Completed">
      <p className="ctx-label">Completed</p>
      <p><b>{task.completedAt ? when(task.completedAt) : 'Done'}</b>{finish ? ` · ${nameOf(state, finish.actor, 'someone')}` : ''}</p>
      {canUndo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'undo', eventId: finish!.id })}>Undo my completion</button>}
      {allowed && reopenAvailable && !open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Reopen…</button>}
      {allowed && reopenAvailable && open && (
        <form className="offer-form" onSubmit={event => void reopen(event)}>
          <label className="field"><span>Why is it being reopened?</span><ReferenceInput autoFocus required maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="Becomes the next action" /></label>
          <span className="offer-form-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!note.trim()}>Reopen</button></span>
        </form>
      )}
      {allowed && !reopenAvailable && !canUndo && <p className="muted">Reopening finished work arrives with the next server release. Until then, create a follow-up task.</p>}
    </section>
  );
}

export type DeckSection = 'signals' | 'calendar' | 'insights';
const DECK_SECTIONS: { id: DeckSection; label: string }[] = [{ id: 'signals', label: 'Signals' }, { id: 'calendar', label: 'Calendar' }, { id: 'insights', label: 'Insights' }];

/** Nothing selected: the Instrument Deck's contextual sections. Operational signals, the due-date
 * calendar and deterministic system insights, each linked to the work behind it. A selected task
 * replaces all of this with TaskContext, so there is only ever one right-side panel. */
export function Signals({ quest, notifications, company, section, onSection, docked = true, onOpenNotification, onOpenTask, onLens, onRegistry, onClose }: {
  quest: Quest; notifications: Notification[]; company: boolean; section: DeckSection; onSection: (next: DeckSection) => void; docked?: boolean;
  onOpenNotification: (note: Notification) => void; onOpenTask: (id: string) => void;
  onLens: (lens: Lens, filter?: 'blocked' | 'unowned') => void; onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void; onClose: () => void;
}) {
  const { state, actor, now, backend } = quest;
  const [date, setDate] = useState(() => localDate(now));
  const open = state.tasks.filter(isOpen);
  const others = open.filter(task => task.owner && task.owner !== actor).length;
  const blocked = open.filter(task => task.status === 'blocked').length;
  const overdue = open.filter(task => isOverdue(task, now)).length;
  const unowned = open.filter(task => !task.owner).length;
  const sources = dailySignal(state, now).sources;
  const live = backend.kind === 'live';
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (!docked) panel.current?.querySelector<HTMLElement>('.deck-tabs [aria-selected="true"]')?.focus(); }, [docked]);
  return (
    <aside ref={panel} className={`context context-signals ${docked ? 'is-docked' : 'is-drawer'}`} role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-label="Instrument deck"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header className="context-head">
        <span className="context-label">Instrument deck</span>
        <span className={`ctx-verify ${live ? 'is-live' : ''}`} title={live ? 'Every change is checked again by the server before it is saved.' : 'Demo: every change is checked by the same rules engine, on this device.'}>{live ? 'Server-enforced' : 'Local · engine-checked'}</span>
        <button type="button" className="icon-btn" aria-label="Close instrument deck" onClick={onClose}>×</button>
      </header>
      <div className="deck-tabs" role="tablist" aria-label="Instrument deck sections">
        {DECK_SECTIONS.map(item => <button key={item.id} type="button" role="tab" id={`deck-${item.id}`} aria-selected={section === item.id} aria-controls="deck-panel" onClick={() => onSection(item.id)}>{item.label}</button>)}
      </div>
      <div className="context-body signals-body" id="deck-panel" role="tabpanel" aria-labelledby={`deck-${section}`}>
        {section === 'signals' && <>
          <section className="sig">
            <h4 className="ctx-label">Status</h4>
            <p className="sig-line"><i className={`sig-dot ${live ? 'is-live' : 'is-demo'}`} aria-hidden="true" />{live ? `Live · ${state.workspace.name}` : 'Demo · synthetic data'}</p>
            <p className="sig-note">{live ? `Revision ${state.rev}. Saved on the server; permissions checked there.` : 'Local to this device. Not company work.'}</p>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Needs you <span>{notifications.length}</span></h4>
            {notifications.length === 0 ? <p className="sig-note">Nothing is waiting on you.</p> : (
              <ul className="sig-list">{notifications.slice(0, 4).map(note => (
                <li key={note.id}><button type="button" className={`sig-item sev-${note.severity}`} onClick={() => onOpenNotification(note)}><small>{NOTIFICATION_LABELS[note.kind]}</small>{note.title}</button></li>
              ))}</ul>
            )}
          </section>
          <section className="sig">
            <h4 className="ctx-label">Moving without you</h4>
            <button type="button" className="sig-metric" onClick={() => onLens('all')}><b>{others}</b><span>open tasks owned by others</span></button>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Friction</h4>
            <div className="sig-metrics">
              <button type="button" className={`sig-metric ${blocked ? 'is-hot' : ''}`} onClick={() => onLens('all', 'blocked')}><b>{blocked}</b><span>blocked</span></button>
              <button type="button" className={`sig-metric ${overdue ? 'is-hot' : ''}`} onClick={() => onLens('overdue')}><b>{overdue}</b><span>overdue</span></button>
              <button type="button" className={`sig-metric ${unowned ? 'is-hot' : ''}`} onClick={() => onLens('all', 'unowned')}><b>{unowned}</b><span>no owner</span></button>
            </div>
          </section>
          <section className="sig">
            <h4 className="ctx-label">Sources</h4>
            <ul className="sig-sources">{sources.map(source => <li key={source.id} title={source.note}><i className={`sig-dot ${source.status === 'connected' ? 'is-live' : ''}`} aria-hidden="true" />{source.label}<small>{source.status === 'connected' ? 'connected' : 'not connected'}</small></li>)}</ul>
          </section>
        </>}
        {section === 'calendar' && <DeckCalendar quest={quest} company={company} date={date} onDate={setDate} onOpenTask={onOpenTask} connected={sources.some(source => /calendar/i.test(source.label) && source.status === 'connected')} />}
        {section === 'insights' && <DeckInsights quest={quest} company={company} onOpenTask={onOpenTask} onRegistry={onRegistry}
          onDate={next => { setDate(next); onSection('calendar'); }} />}
      </div>
    </aside>
  );
}

/** Month or week of due dates, shaded by due-date load from records, with the chosen day's work below. */
function DeckCalendar({ quest, company, date, onDate, onOpenTask, connected }: { quest: Quest; company: boolean; date: string; onDate: (date: string) => void; onOpenTask: (id: string) => void; connected: boolean }) {
  const { state, actor, now } = quest;
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const today = localDate(now);
  const base = new Date(`${today}T12:00:00`), picked = new Date(`${date}T12:00:00`);
  const offset = (picked.getFullYear() - base.getFullYear()) * 12 + picked.getMonth() - base.getMonth();
  const grid = heatGrid(state, actor, now, company, offset);
  const shift = (dir: 1 | -1) => {
    const next = new Date(picked);
    if (mode === 'month') next.setMonth(next.getMonth() + dir, 1); else next.setDate(next.getDate() + dir * 7);
    onDate(localDate(next.getTime()));
  };
  const monday = new Date(picked); monday.setDate(picked.getDate() - ((picked.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, at) => { const day = new Date(monday); day.setDate(monday.getDate() + at); return localDate(day.getTime()); });
  const dayTasks = dueOn(state, actor, now, company, date);
  const label = (day: string, options: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', options);
  return <>
    <section className="sig deck-cal">
      <div className="deck-cal-bar">
        <button type="button" className="icon-btn" aria-label={mode === 'month' ? 'Previous month' : 'Previous week'} onClick={() => shift(-1)}>‹</button>
        <strong>{mode === 'month' ? grid.label : `${label(week[0]!, { month: 'short', day: 'numeric' })} – ${label(week[6]!, { month: 'short', day: 'numeric' })}`}</strong>
        <button type="button" className="icon-btn" aria-label={mode === 'month' ? 'Next month' : 'Next week'} onClick={() => shift(1)}>›</button>
      </div>
      <div className="deck-cal-modes">
        <div className="seg" role="group" aria-label="Calendar view">
          <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month</button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Week</button>
        </div>
        {date !== today && <button type="button" className="link" onClick={() => onDate(today)}>Today</button>}
      </div>
      {mode === 'month'
        ? <div className="deck-cal-grid" role="grid" aria-label={grid.label}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <div key={`d${index}`} className="dow" role="columnheader">{day}</div>)}
            {grid.cells.map((cell, index) => cell
              ? <button key={cell.date} type="button" role="gridcell" className={`h${cell.heat} ${cell.today ? 'is-today' : ''} ${cell.overdue ? 'has-late' : ''}`} aria-selected={cell.date === date} aria-current={cell.today ? 'date' : undefined}
                  aria-label={`${label(cell.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${cell.due ? `${cell.due} due${cell.blocked ? `, ${cell.blocked} blocked` : ''}${cell.overdue ? `, ${cell.overdue} overdue` : ''}` : 'nothing due'}`}
                  onClick={() => onDate(cell.date)}>{cell.day}</button>
              : <div key={`b${index}`} aria-hidden="true" />)}
          </div>
        : <ul className="deck-week">
            {week.map(day => {
              const due = dueOn(state, actor, now, company, day);
              return <li key={day}><button type="button" className={`${day === date ? 'is-on' : ''} ${day === today ? 'is-today' : ''}`} aria-pressed={day === date} onClick={() => onDate(day)}>
                <span>{label(day, { weekday: 'short' })} <b>{label(day, { day: 'numeric' })}</b></span><i style={{ ['--n' as string]: Math.min(due.length, 6) }} aria-hidden="true" /><small>{due.length ? `${due.length} due` : '—'}</small>
              </button></li>;
            })}
          </ul>}
      <p className="deck-cal-key"><span><i className="h1" /><i className="h2" /><i className="h3" /><i className="h4" /></span>Due-date load: open work due that day (blocked counts twice). Not a measure of anyone’s performance.</p>
    </section>
    <section className="sig">
      <h4 className="ctx-label">{date === today ? 'Due today' : label(date, { weekday: 'long', month: 'short', day: 'numeric' })} <span>{dayTasks.length}</span></h4>
      {dayTasks.length === 0 ? <p className="sig-note">Nothing {company ? '' : 'of yours '}is due this day.</p> : (
        <ul className="sig-list">{dayTasks.slice(0, 8).map(task => (
          <li key={task.id}><button type="button" className={`sig-item ${task.ultra || isOverdue(task, now) ? 'sev-critical' : task.status === 'blocked' || task.priority === 'high' ? 'sev-high' : ''}`} onClick={() => onOpenTask(task.id)}>
            <small>{[firstName(state, task.owner), STATUS_LABELS[task.status], task.dueTime].filter(Boolean).join(' · ')}</small>{task.title}
          </button></li>
        ))}</ul>
      )}
      <p className="sig-note">{connected ? 'Includes task due dates.' : 'Task due dates only. No calendar is connected, so meetings and events don’t appear yet.'}</p>
    </section>
  </>;
}

/** Deterministic observations plus the period digest. AI analysis, when added, joins this list and never replaces it. */
function DeckInsights({ quest, company, onOpenTask, onRegistry, onDate }: { quest: Quest; company: boolean; onOpenTask: (id: string) => void; onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void; onDate: (date: string) => void }) {
  const { state, actor, now } = quest;
  const [span, setSpan] = useState<'today' | 'week'>('week');
  const minute = Math.floor(now / 60000) * 60000;
  const items = systemInsights(state, actor, minute, company);
  const summary = digest(state, actor, minute, span, company);
  const go = (item: SystemInsight) => {
    const target = item.target;
    if (!target) return;
    if ('taskId' in target) onOpenTask(target.taskId);
    else if ('date' in target) onDate(target.date);
    else if ('lens' in target) onRegistry(target.lens, { scope: company ? 'company' : 'mine', ...(target.owner ? { owner: target.owner } : {}), ...(target.status ? { status: target.status } : {}) });
    else onRegistry('all', { scope: 'company', owner: target.owner });
  };
  return <>
    <section className="sig">
      <h4 className="ctx-label">Observations <span>{items.length}</span></h4>
      {items.length === 0 ? <p className="sig-note">No rising overdue work, concentrated assignments, repeated blockers, unassigned work or deadline clusters right now.</p> : (
        <ul className="sig-list">{items.map(item => (
          <li key={item.id}><button type="button" className={`sig-item ${item.tone === 'stop' ? 'sev-critical' : item.tone === 'warn' ? 'sev-high' : ''}`} onClick={() => go(item)} disabled={!item.target}>
            <small>{item.title}</small>{item.detail}
          </button></li>
        ))}</ul>
      )}
    </section>
    <section className="sig">
      <div className="deck-cal-modes">
        <h4 className="ctx-label">{span === 'today' ? 'Daily digest' : 'Weekly digest'}</h4>
        <div className="seg" role="group" aria-label="Digest period">
          <button type="button" aria-pressed={span === 'today'} onClick={() => setSpan('today')}>Today</button>
          <button type="button" aria-pressed={span === 'week'} onClick={() => setSpan('week')}>Week</button>
        </div>
      </div>
      <div className="deck-digest" aria-live="polite">{summary.map(line => <p key={line}>{line}</p>)}</div>
    </section>
    <p className="sig-note">Rules over Task-HQ records{company ? '' : ' you’re part of'}. Counts describe work, not people’s performance.</p>
  </>;
}

/** Whether the signals panel has anything worth showing. */
export function hasSignals(quest: Quest, notifications: Notification[]) {
  const { state, now } = quest;
  return notifications.length > 0 || state.tasks.some(task => isOpen(task) && (task.status === 'blocked' || isOverdue(task, now) || !task.owner));
}
