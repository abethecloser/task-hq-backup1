// Inline task controls shared by the All Tasks rows and the task page: the status pill
// (only the moves the engine would accept, see statusMoves), priority, assignee and due.
// Every change is an ordinary engine action, so the server checks it again.
import { useState } from 'react';
import type { Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { canAssignOthers, canEditTask, lockedTaskFields, statusAction, statusMoves } from '../core/permissions.ts';
import type { StatusMove } from '../core/permissions.ts';
import { localDate, shortDate } from '../core/time.ts';
import { ReferenceInput } from '../ui/ReferenceEditor.tsx';
import { Select } from '../ui/Select.tsx';
import type { Quest } from '../ui/useQuest.ts';

const stop = { onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() };

/** The status as a colored pill; when this person can move it, the pill is a dropdown of the allowed moves. */
export function StatusMenu({ quest, task }: { quest: Quest; task: Task }) {
  const { state, actor, now, dispatch } = quest;
  const moves = statusMoves(state, task, actor, now);
  const [asking, setAsking] = useState<StatusMove | null>(null);
  const [note, setNote] = useState('');
  if (!moves.length) return <span className={`pill pill-${task.status}`}>{STATUS_LABELS[task.status]}</span>;
  async function run(move: StatusMove, text = '') {
    const result = await dispatch(statusAction(task, move, text));
    if (result.ok) { setAsking(null); setNote(''); }
  }
  return (
    <span className="status-menu" {...stop}>
      <Select className={`pill pill-${task.status} pill-select`} value="" aria-label={`Status: ${STATUS_LABELS[task.status]}. Change status`}
        onChange={event => { const move = moves.find(item => item.key === event.target.value); if (!move) return; if (move.prompt) { setAsking(move); setNote(''); } else void run(move); }}>
        <option value="" disabled>{STATUS_LABELS[task.status]}</option>
        {moves.map(move => <option key={move.key} value={move.key}>{move.prompt ? `${move.label}…` : move.to !== task.status ? `${move.label} → ${STATUS_LABELS[move.to]}` : move.label}</option>)}
      </Select>
      {asking && (
        <form className="status-note" onSubmit={event => { event.preventDefault(); void run(asking, note.trim()); }}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setAsking(null); } }}>
          <label className="field"><span>{asking.prompt}</span>
            <ReferenceInput autoFocus required maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder={asking.key === 'block' ? 'e.g. Waiting on the permit office' : 'e.g. Photos are missing the north side'} />
          </label>
          <span className="status-note-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!note.trim()}>{asking.key === 'block' ? 'Mark blocked' : 'Send back'}</button>
          </span>
        </form>
      )}
    </span>
  );
}

export function PrioritySelect({ quest, task }: { quest: Quest; task: Task }) {
  const { state, actor, dispatch } = quest;
  if (task.ultra) return <span className="tag tag-ultra">Ultra</span>;
  const editable = canEditTask(state, task, actor) && !lockedTaskFields(state, task, actor) && task.status !== 'done';
  if (!editable) return <span className={`priority-text ${task.priority === 'high' ? 'is-high' : ''}`}>{task.priority === 'high' ? 'High' : 'Normal'}</span>;
  return (
    <span {...stop}>
      <Select className={`inline-select priority-select ${task.priority === 'high' ? 'is-high' : ''}`} value={task.priority} aria-label="Priority"
        onChange={event => void dispatch({ type: 'task/update', id: task.id, changes: { priority: event.target.value as Task['priority'] } })}>
        <option value="normal">Normal</option><option value="high">High</option>
      </Select>
    </span>
  );
}

/** Who the task is assigned to. Reassigning needs a supervisor, admin or owner (or the demo's work-role rules). */
export function AssigneeSelect({ quest, task, short = false }: { quest: Quest; task: Task; short?: boolean }) {
  const { state, actor, dispatch } = quest;
  const editable = canEditTask(state, task, actor) && canAssignOthers(state, actor) && !lockedTaskFields(state, task, actor) && task.status !== 'done';
  const people = state.people.filter(item => item.role !== 'reviewer');
  const label = (id: string) => { const who = state.people.find(item => item.id === id); return who ? (short ? who.name.split(' ')[0] : who.name) : ''; };
  const outside = !!task.owner && !people.some(item => item.id === task.owner); // a former member or an observer still holds it
  if (!editable) return <span className="assignee-text">{task.owner ? (task.owner === actor ? 'You' : label(task.owner) || 'Former member') : <em>Unassigned</em>}</span>;
  return (
    <span {...stop}>
      <Select className="inline-select assignee-select" value={task.owner} aria-label="Assigned to"
        onChange={event => void dispatch({ type: 'task/update', id: task.id, changes: { owner: event.target.value } })}>
        <option value="">Unassigned</option>
        {outside && <option value={task.owner} disabled>{label(task.owner) || 'Former member'}</option>}
        {people.map(item => <option key={item.id} value={item.id}>{item.id === actor ? `${label(item.id)} (you)` : label(item.id)}</option>)}
      </Select>
    </span>
  );
}

export function DueInput({ quest, task, overdue = false }: { quest: Quest; task: Task; overdue?: boolean }) {
  const { state, actor, dispatch } = quest;
  // Shows the chosen date at once while the save is in flight; a refused save falls back to the stored date.
  const [pending, setPending] = useState<string | null>(null);
  const editable = canEditTask(state, task, actor) && !lockedTaskFields(state, task, actor) && task.status !== 'done';
  if (!editable) return <span className={`due-text ${overdue ? 'text-danger' : ''}`}>{task.due ? shortDate(task.due, localDate(quest.now)) : '—'}</span>;
  return (
    <input type="date" className={`inline-date ${overdue ? 'is-overdue' : ''}`} value={pending ?? task.due} aria-label="Due date" aria-busy={pending !== null} {...stop}
      onChange={event => {
        const due = event.target.value;
        setPending(due);
        void dispatch({ type: 'task/update', id: task.id, changes: { due,
          ...(!due && task.dueTime && quest.backend.supports?.taskTaxonomy !== false ? { dueTime: '' } : {}),
        } }).finally(() => setPending(current => (current === due ? null : current)));
      }} />
  );
}
