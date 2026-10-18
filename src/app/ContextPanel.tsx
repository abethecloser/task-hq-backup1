// RIGHT ZONE — Context & Execution. With a task selected it shows identity,
// ownership, urgency, dependencies, history and the authorized next actions
// (composed by the engine, never invented here). With nothing selected it shows
// compact operational signals, or stays collapsed when there is nothing to say.
// Docked beside the canvas on wide screens (the canvas reflows); a drawer otherwise.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EditableTaskFields, Task } from '../core/contract.ts';
import { dailySignal } from '../core/executive.ts';
import type { Lens } from '../core/registry.ts';
import { lensCounts } from '../core/registry.ts';
import { blockingDeps, dependents, firstName, hasRole, isOpen, isOverdue, leadById, nameOf, projectName, taskById } from '../core/selectors.ts';
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
  const [waitingOn, setWaitingOn] = useState(task.waitingOn);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { setTitle(task.title); setNextAction(task.nextAction); setDescription(task.description); setWaitingOn(task.waitingOn); }, [task.title, task.nextAction, task.description, task.waitingOn]);
  useEffect(() => { if (!docked) panel.current?.querySelector<HTMLElement>('.context-close')?.focus(); }, [docked, task.id]);

  const me = state.people.find(item => item.id === actor);
  const reviewer = me?.role === 'reviewer';
  const isManager = hasRole(state, actor, ['manager']);
  const lockedFields = task.ultra && !isManager;
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
    <aside ref={panel} className={`context context-task ${docked ? 'is-docked' : 'is-drawer'}`}
      role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-labelledby="context-title"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <header className="context-head">
        <span className="context-label">Task context</span>
        <StatusPill task={task} />
        <button type="button" className="icon-btn context-close" aria-label="Close task" onClick={onClose}>×</button>
      </header>
      <div className="context-body">
        <section className="ctx-identity">
          <p className="ctx-eyebrow">{projectName(state, task.projectId) || 'No project'}{task.leadId ? ' · from a lead' : ''}</p>
          <textarea id="context-title" className="title-edit" rows={2} value={title} maxLength={160} readOnly={reviewer}
            onChange={event => setTitle(event.target.value)} onBlur={() => saveText('title', title)} aria-label="Task name" />
          <p className="ctx-sub">Created by {nameOf(state, task.createdBy, 'someone')}{created ? ` · ${when(created.at)}` : ''} · updated {when(task.updatedAt)}</p>
          <div className="ctx-tags"><TaskTags state={state} task={task} now={now} /></div>
        </section>

        <dl className="ctx-grid" aria-label="Ownership and urgency">
          <div><dt>Owner</dt><dd><Avatar state={state} id={task.owner} size="sm" />{task.owner ? nameOf(state, task.owner) : <em>Unassigned</em>}</dd></div>
          <div><dt>Due</dt><dd className={isOverdue(task, now) ? 'text-danger' : ''}>{task.due ? shortDate(task.due, today) : '—'}{isOverdue(task, now) ? ' · overdue' : ''}</dd></div>
          <div><dt>Next step owner</dt><dd>{task.nextOwner ? nameOf(state, task.nextOwner) : '—'}</dd></div>
          <div><dt>Approver</dt><dd>{task.approver ? nameOf(state, task.approver) : 'None'}</dd></div>
          {task.decisionOwner && <div><dt>Decision owner</dt><dd>{nameOf(state, task.decisionOwner)}</dd></div>}
          {task.waitingOn && <div><dt>Waiting on</dt><dd>{task.waitingOn}</dd></div>}
          <div><dt>Priority</dt><dd>{task.ultra ? 'Ultra Priority' : task.priority === 'high' ? 'High' : 'Normal'}</dd></div>
        </dl>

        {task.status !== 'done' && (
          <label className="field next-field"><span>Next action</span>
            <input value={nextAction} maxLength={200} readOnly={reviewer} placeholder="The next physical step, in one line" onChange={event => setNextAction(event.target.value)} onBlur={() => saveText('nextAction', nextAction)} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
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
            <ol>{history.map(event => <li key={event.id} className={event.undone ? 'is-undone' : ''}><time>{when(event.at)}</time><p>{event.text}</p></li>)}</ol>
          </section>
        )}

        {!reviewer && (
          <details className="drawer-details">
            <summary>Edit people, dates & dependencies</summary>
            <div className="roles">
              <label className="field"><span>Owner (does the work)</span><PersonSelect state={state} label="Owner" value={task.owner} emptyLabel="Unassigned" disabled={lockedFields} onChange={id => void update({ owner: id })} /></label>
              <label className="field"><span>Next-step owner (receives the handoff)</span><PersonSelect state={state} label="Next-step owner" value={task.nextOwner} onChange={id => void update({ nextOwner: id })} /></label>
              <label className="field"><span>Approver (reviews before done)</span><PersonSelect state={state} label="Approver" value={task.approver} emptyLabel="No approval needed" onChange={id => void update({ approver: id })} /></label>
              <label className="field"><span>Decision owner</span><PersonSelect state={state} label="Decision owner" value={task.decisionOwner} onChange={id => void update({ decisionOwner: id })} /></label>
              <label className="field"><span>Waiting on (outside Task-HQ)</span><input value={waitingOn} maxLength={120} placeholder="e.g. City permit office" onChange={event => setWaitingOn(event.target.value)} onBlur={() => saveText('waitingOn', waitingOn)} /></label>
              <div className="field"><span>Watchers / coordinators</span>
                <div className="watchers">{state.people.filter(item => item.role !== 'reviewer').map(item => (
                  <button key={item.id} type="button" className={`chip ${task.watchers.includes(item.id) ? 'is-on' : ''}`} onClick={() => void update({ watchers: toggle(task.watchers, item.id) })}>{item.name.split(' ')[0]}</button>
                ))}</div>
              </div>
              <label className="field"><span>Due</span><input type="date" value={task.due} disabled={lockedFields} onChange={event => void update({ due: event.target.value })} /></label>
              <label className="field"><span>Priority</span><select value={task.priority} disabled={lockedFields} onChange={event => void update({ priority: event.target.value as Task['priority'] })}><option value="normal">Normal</option><option value="high">High</option></select></label>
              <label className="field"><span>Project</span><select value={task.projectId} onChange={event => void update({ projectId: event.target.value })}><option value="">No project</option>{state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <details className="deps">
              <summary>Depends on ({task.dependsOn.length})</summary>
              {candidates.map(item => <label key={item.id} className="dep-check"><input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={() => void update({ dependsOn: toggle(task.dependsOn, item.id) })} />{item.title}</label>)}
            </details>
            <label className="field"><span>Notes</span><textarea rows={3} value={description} maxLength={1000} onChange={event => setDescription(event.target.value)} onBlur={() => saveText('description', description)} /></label>
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
  const allowed = state.people.find(item => item.id === actor)?.role !== 'reviewer'
    && (task.owner === actor || task.approver === actor || hasRole(state, actor, ['manager', 'coordinator']));

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
          <label className="field"><span>Why is it being reopened?</span><input autoFocus required maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder="Becomes the next action" /></label>
          <span className="offer-form-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!note.trim()}>Reopen</button></span>
        </form>
      )}
      {allowed && !reopenAvailable && !canUndo && <p className="muted">Reopening finished work arrives with the next server release. Until then, create a follow-up task.</p>}
    </section>
  );
}

/** Nothing selected: compact operational signals, each linked to the work behind it. */
export function Signals({ quest, notifications, onOpenNotification, onLens, onClose }: {
  quest: Quest; notifications: Notification[]; onOpenNotification: (note: Notification) => void; onLens: (lens: Lens, filter?: 'overdue' | 'blocked' | 'unowned') => void; onClose: () => void;
}) {
  const { state, actor, now, backend } = quest;
  const counts = lensCounts(state, actor, now);
  const open = state.tasks.filter(isOpen);
  const blocked = open.filter(task => task.status === 'blocked').length;
  const overdue = open.filter(task => isOverdue(task, now)).length;
  const unowned = open.filter(task => !task.owner).length;
  const sources = dailySignal(state, now).sources;
  const live = backend.kind === 'live';
  return (
    <aside className="context context-signals is-docked" aria-label="Operational signals">
      <header className="context-head">
        <span className="context-label">Operational signals</span>
        <button type="button" className="icon-btn" aria-label="Collapse signals" onClick={onClose}>×</button>
      </header>
      <div className="context-body signals-body">
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
          <button type="button" className="sig-metric" onClick={() => onLens('team')}><b>{counts.team}</b><span>open tasks owned by others</span></button>
        </section>
        <section className="sig">
          <h4 className="ctx-label">Friction</h4>
          <div className="sig-metrics">
            <button type="button" className={`sig-metric ${blocked ? 'is-hot' : ''}`} onClick={() => onLens('attention', 'blocked')}><b>{blocked}</b><span>blocked</span></button>
            <button type="button" className={`sig-metric ${overdue ? 'is-hot' : ''}`} onClick={() => onLens('attention', 'overdue')}><b>{overdue}</b><span>overdue</span></button>
            <button type="button" className={`sig-metric ${unowned ? 'is-hot' : ''}`} onClick={() => onLens('all', 'unowned')}><b>{unowned}</b><span>no owner</span></button>
          </div>
        </section>
        <section className="sig">
          <h4 className="ctx-label">Sources</h4>
          <ul className="sig-sources">{sources.map(source => <li key={source.id} title={source.note}><i className={`sig-dot ${source.status === 'connected' ? 'is-live' : ''}`} aria-hidden="true" />{source.label}<small>{source.status === 'connected' ? 'connected' : 'not connected'}</small></li>)}</ul>
        </section>
      </div>
    </aside>
  );
}

/** Whether the signals panel has anything worth showing. */
export function hasSignals(quest: Quest, notifications: Notification[]) {
  const { state, now } = quest;
  return notifications.length > 0 || state.tasks.some(task => isOpen(task) && (task.status === 'blocked' || isOverdue(task, now) || !task.owner));
}
