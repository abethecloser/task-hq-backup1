import { Select } from './Select.tsx';
import { useFeedbackRecord } from './Feedback.tsx';
import { ReferenceInput } from './ReferenceEditor.tsx';
// Components shared by the Quest app and the Quest extension popup.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { QuestState, Task } from '../core/contract.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import type { Insight } from '../core/rules.ts';
import { INSIGHT_LABELS } from '../core/rules.ts';
import { apply } from '../core/engine.ts';
import {
  blockingDeps, dependents, firstName, isOverdue, moveForwardPlan, nameOf, projectName,
} from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import { offersMoveForward } from '../core/permissions.ts';
import type { Quest, Toast } from './useQuest.ts';
import { Latch, toneForAction } from './Behavior.tsx';
import { LOOK_LABELS, useLook } from './look.ts';
import brandMark from '../assets/brand/mark.png';
import type { Look } from './look.ts';

export function initials(name: string) {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

export function Avatar({ state, id, size = 'md' }: { state: QuestState; id: string; size?: 'sm' | 'md' | 'lg' }) {
  const name = nameOf(state, id, '');
  return <span className={`avatar avatar-${size} ${name ? '' : 'avatar-empty'}`} title={name || 'Unassigned'}>{name ? initials(name) : '?'}</span>;
}

export function RecordCard({ kind, tone = 'neutral', className = '', children }: {
  kind: 'intake' | 'signal';
  tone?: 'neutral' | 'critical' | 'high';
  className?: string;
  children: ReactNode;
}) {
  return <article className={`record-card record-${kind} ${className}`.trim()} data-record-kind={kind} data-record-tone={tone}>{children}</article>;
}

export function RecordMeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`record-meta ${className}`.trim()}>{children}</div>;
}

export function StatusPill({ task }: { task: Task }) {
  return <span className={`pill pill-${task.status}`}>{STATUS_LABELS[task.status]}</span>;
}

export function TaskTags({ state, task, now }: { state: QuestState; task: Task; now: number }) {
  const waiting = blockingDeps(state, task);
  return (
    <>
      {task.ultra && <span className="tag tag-ultra">Ultra Priority</span>}
      {isOverdue(task, now) && <span className="tag tag-overdue">Overdue</span>}
      {task.priority === 'high' && !task.ultra && <span className="tag tag-high">High</span>}
      {waiting.length > 0 && <span className="tag tag-wait">Waiting on {firstName(state, waiting[0]!.owner, 'someone')}</span>}
      {task.leadId && <span className="tag tag-lead">Lead</span>}
    </>
  );
}

/**
 * Move Work Forward: where the work is now → the one action → what it unlocks and who is next.
 * The same control appears on the My Work hero, task rows, the drawer and the popup.
 */
export function MoveForward({ quest, task, compact = false, onDone }: { quest: Quest; task: Task; compact?: boolean; onDone?: () => void }) {
  const { state, actor, dispatch, now } = quest;
  const plan = moveForwardPlan(state, task, actor);
  const canAct = offersMoveForward(state, task, actor, now);
  const [pulse, setPulse] = useState(0);
  if (state.people.find(item => item.id === actor)?.role === 'reviewer') return null; // reviewers never move work
  async function go() {
    setPulse(value => value + 1);
    const result = await dispatch({ type: 'task/advance', id: task.id });
    if (result.ok) onDone?.();
    return result.ok;
  }
  const tone = toneForAction(plan.label);
  const successLabel = tone === 'complete' ? 'Done' : tone === 'assist' ? 'Resolved' : /approval/i.test(plan.label) ? 'Sent for approval' : /take it/i.test(plan.label) ? 'Yours' : 'Started';
  if (compact) {
    return <Latch size="sm" stopPropagation label={plan.label} tone={tone} successLabel={successLabel} disabled={!canAct} hint={plan.effect} onCommit={go} />;
  }
  return (
    <div className="mwf" data-status={task.status}>
      <div className="mwf-step mwf-now"><small>NOW</small><strong>{plan.current}</strong></div>
      <div className="mwf-control" data-pulse={pulse}>
        <Latch label={plan.label} tone={tone} successLabel={successLabel} disabled={!canAct} hint={plan.effect} onCommit={go} />
      </div>
      <div className="mwf-step mwf-next">
        <small>NEXT</small>
        <strong>{plan.next}</strong>
        {plan.nextWho.length > 0 && <span className="mwf-who">{plan.nextWho.map(id => <Avatar key={id} state={state} id={id} size="sm" />)}<em>{plan.nextWho.map(id => firstName(state, id)).join(', ')}</em></span>}
      </div>
      {plan.effect && <p className="mwf-effect">{plan.effect}</p>}
    </div>
  );
}

export function TaskRow({ quest, task, onOpen, index, locked = false, priority = false }: { quest: Quest; task: Task; onOpen: (id: string) => void; index?: number; locked?: boolean; priority?: boolean }) {
  const { state, now } = quest;
  const feedback = useFeedbackRecord(task.id);
  const today = localDate(now);
  const unlocks = dependents(state, task);
  return (
    <div {...feedback} data-feedback-record={task.id} className={`task-row status-${task.status} ${task.ultra ? 'is-ultra' : ''} ${locked ? 'is-locked' : ''}`} onClick={() => onOpen(task.id)}>
      {index !== undefined && <span className="row-index">{String(index + 1).padStart(2, '0')}</span>}
      <span className={`state-dot dot-${task.status}`} aria-hidden="true" />
      <span className="row-main">
        <span className="row-title"><button type="button" className="row-open" aria-label={`Open task: ${task.title}`} onClick={event => { event.stopPropagation(); onOpen(task.id); }}><strong>{task.title}</strong></button><TaskTags state={state} task={task} now={now} />{priority && <span className="muted">First by urgency</span>}</span>
        <span className="row-next">{task.status === 'blocked' ? `Blocked: ${task.blocker?.note ?? ''}` : task.nextAction ? `Next: ${task.nextAction}` : <em>No next action yet</em>}</span>
        <span className="row-meta">
          <Avatar state={state} id={task.owner} size="sm" /><span>{firstName(state, task.owner)}</span>
          {task.due && <><i>·</i><span className={isOverdue(task, now) ? 'text-danger' : ''}>Due {shortDate(task.due, today)}</span></>}
          {task.projectId && <><i>·</i><span>{projectName(state, task.projectId)}</span></>}
          {task.approver && task.status === 'review' && <><i>·</i><span>Approver {firstName(state, task.approver)}</span></>}
          {task.nextOwner && task.nextOwner !== task.owner && task.status !== 'done' && <><i>·</i><span>Handoff to {firstName(state, task.nextOwner)}</span></>}
          {unlocks.length > 0 && <><i>·</i><span>Unlocks {unlocks.length}</span></>}
        </span>
      </span>
      <span className="row-end">
        <StatusPill task={task} />
        {!locked && task.status !== 'done' && <MoveForward quest={quest} task={task} compact />}
      </span>
    </div>
  );
}

export function InsightCard({ quest, insight, onOpen }: { quest: Quest; insight: Insight; onOpen: (taskId: string) => void }) {
  const { state, dispatch, actor, now } = quest;
  const [next, setNext] = useState('');
  const tone = insight.severity === 'critical' || insight.severity === 'high' ? insight.severity : 'neutral';
  // Offered only when the engine would accept it from the person looking (dry run).
  const quick = insight.action && apply(state, insight.action.do, { actor, now, newId: () => 'dry-run' }).ok ? insight.action : undefined;
  const capture = insight.kind === 'missing-next-action' && insight.taskId
    && apply(state, { type: 'task/update', id: insight.taskId, changes: { nextAction: 'x' } }, { actor, now, newId: () => 'dry-run' }).ok;
  return (
    <RecordCard kind="signal" tone={tone} className={`insight sev-${insight.severity}`}>
      <div className="insight-top">
        <p className="insight-kind">{INSIGHT_LABELS[insight.kind]}</p>
        <strong className="insight-what">{insight.what}</strong>
        <RecordMeta className="insight-who"><Avatar state={state} id={insight.who} size="sm" />{insight.who === actor ? 'You' : insight.who ? firstName(state, insight.who) : 'The team'} acts next</RecordMeta>
      </div>
      <div className="insight-split">
        <p><b>Why it matters</b>{insight.why}</p>
        <p><b>What to do</b>{insight.next}</p>
      </div>
      {capture
        ? <form className="insight-capture" onSubmit={async event => { event.preventDefault(); if (next.trim()) { const res = await dispatch({ type: 'task/update', id: insight.taskId!, changes: { nextAction: next.trim() } }); if (res.ok) setNext(''); } }}>
            <ReferenceInput value={next} maxLength={200} placeholder="The next physical step, in one line" aria-label="Next action" onChange={event => setNext(event.target.value)} />
            <button type="submit" className="btn btn-dark btn-sm" disabled={!next.trim()}>Save next action</button>
            {insight.taskId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(insight.taskId!)}>Open</button>}
          </form>
        : (quick || insight.taskId) && <div className="insight-actions">
            {quick && <button type="button" className="btn btn-dark btn-sm" onClick={() => void dispatch(quick.do)}>{quick.label}</button>}
            {insight.taskId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(insight.taskId!)}>Open</button>}
          </div>}
    </RecordCard>
  );
}

export function ToastBar({ toast, onUndo, onDismiss }: { toast: Toast | null; onUndo: (eventId: string) => void; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite" key={toast.id}>
      <span>{toast.text}</span>
      {toast.undoId && <button type="button" className="toast-undo" onClick={() => onUndo(toast.undoId!)}>Undo</button>}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}

/** Picker for operational roles (owner, approver, helper…). Reviewers are never offered. */
export function PersonSelect({ state, value, onChange, label, allowEmpty = true, emptyLabel = 'Nobody', disabled = false }: { state: QuestState; value: string; onChange: (id: string) => void; label: string; allowEmpty?: boolean; emptyLabel?: string; disabled?: boolean }) {
  return (
    <Select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {state.people.filter(item => item.role !== 'reviewer').map(item => <option key={item.id} value={item.id}>{item.name} · {item.title}</option>)}
    </Select>
  );
}

export function WorkingAs({ quest, compact = false }: { quest: Quest; compact?: boolean }) {
  const { state, actor, setActor } = quest;
  return (
    <label className={`working-as ${compact ? 'is-compact' : ''}`}>
      <span>Working as</span>
      <Select value={actor} onChange={event => setActor(event.target.value)} aria-label="Working as (demo person)">
        {state.people.map(item => <option key={item.id} value={item.id}>{compact ? item.name : `${item.name} — ${item.title}`}</option>)}
      </Select>
    </label>
  );
}

export function ModeChip({ quest }: { quest: Quest }) {
  return <span className="mode-chip" title={quest.backend.detail}><span className="mode-dot" /><span className="mode-text">{quest.backend.label}{quest.backend.authority === 'local-demo' ? ' · demo' : ''}</span></span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><div className="empty-mark">✓</div><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function BrandMark({ size = 30 }: { size?: number }) {
  return <img className="brand-mark" src={brandMark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}

/** Studio (default) or Brutalist. Saved in this browser only. */
export function LookSwitch({ compact = false }: { compact?: boolean }) {
  const [look, setLook] = useLook();
  return (
    <span className={`look-switch ${compact ? 'is-compact' : ''}`} role="group" aria-label="Look">
      {!compact && <span className="look-label">Look</span>}
      {(Object.keys(LOOK_LABELS) as Look[]).map(id => (
        <button key={id} type="button" aria-pressed={look === id} className={look === id ? 'is-on' : ''} onClick={() => setLook(id)}>{LOOK_LABELS[id]}</button>
      ))}
    </span>
  );
}
