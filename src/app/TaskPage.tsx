// A task, full screen: identity and the four everyday fields (status, assigned, priority,
// due) up top; brief, people and dependencies on the left; contextual actions and
// the conversation on the right. The quick actions are the engine's authorized offers
// (TaskSituation), never invented here, and every edit is an engine action.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { EditableTaskFields, Task } from '../core/contract.ts';
import { canEditTask, canReopenTask, lockedTaskFields } from '../core/permissions.ts';
import { blockingDeps, dependents, firstName, isOpen, isOverdue, leadById, nameOf, projectName, taskById } from '../core/selectors.ts';
import { Avatar, PersonSelect, TaskTags } from '../ui/components.tsx';
import { useFeedbackRecord } from '../ui/Feedback.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { Select } from '../ui/Select.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { AssigneeSelect, DueInput, PrioritySelect, StatusMenu } from './TaskControls.tsx';
import { TaskSituation } from './WorkSurface.tsx';

const when = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isFormField = (target: EventTarget) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');

export function TaskPage({ quest, task, canCreate, onClose, onOpen, onCreate }: {
  quest: Quest; task: Task; canCreate: boolean; onClose: () => void; onOpen: (id: string) => void; onCreate: () => void;
}) {
  const { state, actor, dispatch } = quest;
  const [title, setTitle] = useState(task.title);
  const [nextAction, setNextAction] = useState(task.nextAction);
  const [description, setDescription] = useState(task.description);
  const [waitingOn, setWaitingOn] = useState(task.waitingOn);
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState<'comments' | 'activity' | 'history'>('comments');
  const feedback = useFeedbackRecord(task.id);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTitle(task.title); setNextAction(task.nextAction); setDescription(task.description); setWaitingOn(task.waitingOn); }, [task.title, task.nextAction, task.description, task.waitingOn]);
  useEffect(() => { window.scrollTo(0, 0); back.current?.focus({ preventScroll: true }); }, [task.id]);

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
  const comments = events.filter(event => / commented: /.test(event.text));
  const historyEvents = events.filter(event => !/ commented: /.test(event.text));
  const feed = tab === 'comments' ? comments : tab === 'history' ? historyEvents : events;
  const created = events.find(event => event.text.includes('created'));
  const people = state.people.filter(item => item.role !== 'reviewer');
  const watching = task.watchers.includes(actor);

  async function addComment(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/comment', id: task.id, note: comment });
    if (result.ok) { setComment(''); setTab('comments'); }
  }
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

      <div className="tp-grid">
        <div className="tp-col tp-details" aria-label="Task details">
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
                onChange={event => setDescription(event.target.value)} onBlur={() => saveText('description', description)} />
            </label>
            {(editable || task.waitingOn) && (
              <label className="field"><span>Waiting on (outside Task-HQ)</span>
                <ReferenceInput value={waitingOn} maxLength={120} readOnly={!editable} placeholder="e.g. City permit office" onChange={event => setWaitingOn(event.target.value)} onBlur={() => saveText('waitingOn', waitingOn)} />
              </label>
            )}
            {lead && <div className="callout"><b>Lead</b> {lead.name} · {lead.phone} · {lead.address}</div>}
          </section>
          <section className="tp-card" aria-labelledby="tp-people">
            <h2 id="tp-people" className="ctx-label">People</h2>
            <dl className="tp-people">
              <div><dt>Next-step owner</dt><dd>{editable ? <PersonSelect state={state} label="Next-step owner" value={task.nextOwner} onChange={id => void update({ nextOwner: id })} /> : task.nextOwner ? nameOf(state, task.nextOwner) : '—'}</dd></div>
              <div><dt>Approver</dt><dd>{editable ? <PersonSelect state={state} label="Approver" value={task.approver} emptyLabel="No approval needed" onChange={id => void update({ approver: id })} /> : task.approver ? nameOf(state, task.approver) : 'None'}</dd></div>
              {(editable || task.decisionOwner) && <div><dt>Decision owner</dt><dd>{editable ? <PersonSelect state={state} label="Decision owner" value={task.decisionOwner} onChange={id => void update({ decisionOwner: id })} /> : nameOf(state, task.decisionOwner)}</dd></div>}
            </dl>
            <h3 className="ctx-label tp-sub">Watchers <span>{task.watchers.length}</span></h3>
            <ul className="tp-watchers">
              {task.watchers.map(id => (
                <li key={id}><Avatar state={state} id={id} size="sm" />{id === actor ? 'You' : nameOf(state, id, 'Former member')}
                  {(editable || id === actor) && <button type="button" className="icon-btn" aria-label={`Remove ${id === actor ? 'yourself' : nameOf(state, id)} from watchers`} onClick={() => void update({ watchers: task.watchers.filter(item => item !== id) })}>×</button>}
                </li>
              ))}
              {task.watchers.length === 0 && <li className="muted">Nobody is watching yet.</li>}
            </ul>
            {editable && people.some(item => !task.watchers.includes(item.id)) && (
              <Select className="inline-select" value="" aria-label="Add a watcher" onChange={event => { if (event.target.value) void update({ watchers: [...task.watchers, event.target.value] }); }}>
                <option value="">+ Add a watcher</option>
                {people.filter(item => !task.watchers.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.id === actor ? `${item.name} (you)` : item.name}</option>)}
              </Select>
            )}
            {!editable && !reviewer && <p className="muted">Watch this task to follow its comments and changes.</p>}
          </section>

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

          {editable && (
            <details className="tp-card drawer-details">
              <summary>More details</summary>
              <div className="roles">
                {quest.backend.supports?.taskTaxonomy !== false && <>
                  <label className="field"><span>Time</span><input type="time" value={task.dueTime ?? ''} disabled={!task.due || locked} onChange={event => void update({ dueTime: event.target.value || undefined })} /></label>
                  {(state.taxonomy?.types.length ?? 0) > 0 && <label className="field"><span>Type</span><Select value={task.type ?? ''} onChange={event => void update({ type: event.target.value || undefined })}><option value="">No type</option>{state.taxonomy!.types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
                  <label className="field"><span>Tags</span><input defaultValue={(task.tags ?? []).join(' ')} placeholder="permits safety" onBlur={event => { const tags = event.target.value.split(/[\s,]+/).map(tag => tag.replace(/^#/, '').toLowerCase()).filter(Boolean); if (tags.join(' ') !== (task.tags ?? []).join(' ')) void update({ tags }); }} /></label>
                </>}
              </div>
              <details className="deps">
                <summary>Depends on ({task.dependsOn.length})</summary>
                {candidates.map(item => <label key={item.id} className={`dep-check ${item.status === 'done' ? 'is-completed' : ''}`}><input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={() => void update({ dependsOn: toggle(task.dependsOn, item.id) })} />{item.title}</label>)}
              </details>
              {task.dependsOn.some(id => !taskById(state, id)) && <p className="muted">A dependency was removed.</p>}
            </details>
          )}
        </div>

        <aside className="tp-col tp-conversation" aria-label="Conversation and quick actions">
          <section className="tp-card tp-actions" aria-labelledby="tp-actions">
            <h2 id="tp-actions" className="ctx-label">Quick actions</h2>
            {task.status === 'review' && <p className="ctx-review" role="status"><b>Submitted for review</b> · {task.approver ? `waiting for ${nameOf(state, task.approver, 'the approver')}` : 'waiting for approval'}. It is not complete until approved.</p>}
            {task.status === 'done' ? <Completed quest={quest} task={task} /> : <TaskSituation quest={quest} taskId={task.id} onOpen={onOpen} />}
          </section>

          <section className="tp-card tp-talk" aria-label="Comments and activity">
            <div className="tp-tabs" role="tablist" aria-label="Comments, activity and history" onKeyDown={event => {
              const tabs = ['comments', 'activity', 'history'] as const;
              const index = tabs.indexOf(tab);
              const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
              if (next !== null) { event.preventDefault(); setTab(tabs[next]!); (event.currentTarget.children[next] as HTMLButtonElement).focus(); }
            }}>
              <button type="button" role="tab" id="tp-tab-comments" aria-controls="tp-feed-panel" tabIndex={tab === 'comments' ? 0 : -1} aria-selected={tab === 'comments'} onClick={() => setTab('comments')}>Comments <span>{comments.length}</span></button>
              <button type="button" role="tab" id="tp-tab-activity" aria-controls="tp-feed-panel" tabIndex={tab === 'activity' ? 0 : -1} aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>Activity <span>{events.length}</span></button>
              <button type="button" role="tab" id="tp-tab-history" aria-controls="tp-feed-panel" tabIndex={tab === 'history' ? 0 : -1} aria-selected={tab === 'history'} onClick={() => setTab('history')}>History <span>{historyEvents.length}</span></button>
            </div>
            <p className="muted tp-sub">Recent retained workspace activity; older events may no longer be available.</p>
            {!reviewer && tab === 'comments' && (
              <form className="task-comment-form" onSubmit={event => void addComment(event)}>
                <ReferenceTextarea rows={2} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} aria-label="Task comment" placeholder="Write a comment. Use @ to mention someone." />
                <button className="btn btn-primary btn-sm" disabled={!comment.trim()}>Comment</button>
              </form>
            )}
            <div id="tp-feed-panel" role="tabpanel" aria-labelledby={`tp-tab-${tab}`}>
            {feed.length === 0
              ? <p className="muted">{tab === 'comments' ? 'No comments yet.' : tab === 'history' ? 'No history yet.' : 'No activity yet.'}</p>
              : (
                <ol className="ctx-history tp-feed">{feed.slice(0, 60).map(event => (
                  <li key={event.id} className={event.undone ? 'is-undone' : ''}><time>{when(event.at)}</time><p><ReferencedText text={event.text} document={event.references?.text} /></p></li>
                ))}</ol>
              )}
            </div>
          </section>

        </aside>
      </div>
    </article>
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
  // A live server older than dispatch v5 predates `task/reopen`; there, reopening
  // is limited to undoing your own completion.
  const reopenAvailable = backend.supports?.taskReopen !== false;
  const allowed = canReopenTask(state, task, actor);

  async function reopen(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/reopen', id: task.id, note });
    if (result.ok) { setNote(''); setOpen(false); }
  }
  const by = task.completedBy || finish?.actor || '';
  const approved = finish?.kind === 'approval';
  const archiveAvailable = backend.supports?.taskArchive !== false && allowed;
  return (
    <div className={`ctx-done ${task.archivedAt ? 'is-archived' : ''}`}>
      <p className="ctx-done-state" role="status"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        <b>{approved ? 'Approved and completed' : 'Completed'}</b>{task.completedAt ? ` ${when(task.completedAt)}` : ''}{by ? ` · ${nameOf(state, by, 'someone')}` : ''}</p>
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
