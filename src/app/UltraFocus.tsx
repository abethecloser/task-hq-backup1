import { Select } from '../ui/Select.tsx';
import { useState } from 'react';
import type { AccessGrant } from '../core/contract.ts';
import { SECTION_LABELS } from '../core/contract.ts';
import { canDecideGrants, firstName, hasRole, nameOf, taskById } from '../core/selectors.ts';
import { clock, duration } from '../core/time.ts';
import { Avatar } from '../ui/components.tsx';
import { compose } from '../core/compose.ts';
import { SituationView } from './WorkSurface.tsx';
import { InstrumentDeck } from './InstrumentDeck.tsx';
import type { Quest } from '../ui/useQuest.ts';

export const ENFORCEMENT_NOTE = 'Task-HQ locks its own screens and actions on this device. It does not block other browser tabs, apps or devices, and the demo has no server-side enforcement yet.';
export const LIVE_ENFORCEMENT_NOTE = 'The Task-HQ server refuses actions outside the critical task, on every device. It does not block other browser tabs or apps.';

function focusEvents(quest: Quest) {
  return quest.state.events.filter(event => event.kind === 'ultra' || event.kind === 'grant').slice(0, 12);
}

export function FocusHistory({ quest }: { quest: Quest }) {
  const events = focusEvents(quest);
  if (!events.length) return null;
  return (
    <details className="history" open>
      <summary>Focus history ({events.length})</summary>
      <ol>{events.map(event => <li key={event.id}><time>{clock(event.at)}</time>{event.text}</li>)}</ol>
    </details>
  );
}

export function CriticalFocus({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, dispatch, now } = quest;
  const focus = state.focus!;
  const task = taskById(state, focus.taskId);

  if (!task) return null;
  return (
    <div className="focus-screen">
      <div className="focus-badge"><span className="pulse" />CRITICAL FOCUS · ULTRA PRIORITY</div>
      <p className="focus-sub">{nameOf(state, focus.activatedBy)} made this your only priority {duration(now - focus.since)} ago. Everything else in Task-HQ is paused for you until it’s done or released.</p>
      <section className="focus-card">
        <SituationView quest={quest} situation={compose(state, actor, now).primary} onOpen={onOpen} variant="focus" keyboard />
      </section>

      <InstrumentDeck quest={quest} selection={{ taskId: task.id }} variant="embedded" />
      <p className="boundary">{quest.backend.kind === 'live' ? LIVE_ENFORCEMENT_NOTE : ENFORCEMENT_NOTE}</p>
      <FocusHistory quest={quest} />
    </div>
  );
}

export function GrantBar({ quest, grant, onReturn }: { quest: Quest; grant: AccessGrant; onReturn: () => void }) {
  const { now, dispatch, state } = quest;
  const left = Math.max(0, (grant.expiresAt ?? now) - now);
  const pct = Math.min(100, (left / (grant.durationSec * 1000)) * 100);
  return (
    <div className="grant-bar" role="status">
      <div className="grant-fill" style={{ width: `${pct}%` }} />
      <span><b>Temporary access:</b> {SECTION_LABELS[grant.section]} · <b>{duration(left)}</b> left · for “{taskById(state, grant.taskId)?.title}”</span>
      <button type="button" className="btn btn-sm btn-dark" onClick={async () => { await dispatch({ type: 'grant/return', id: grant.id }); onReturn(); }}>Return to critical task</button>
    </div>
  );
}

export function FocusControl({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, dispatch, now } = quest;
  const canActivate = hasRole(state, actor, state.policy.ultraActivators);
  const canDecide = canDecideGrants(state, actor);
  const [seconds, setSeconds] = useState(state.policy.grantSeconds);
  const [pick, setPick] = useState('');
  const focus = state.focus;
  const open = state.grants.filter(grant => grant.status === 'pending' || (grant.status === 'approved' && (grant.expiresAt ?? 0) > now));
  if (!focus && !canActivate) return null;
  const candidates = state.tasks.filter(task => task.status !== 'done' && task.owner);

  return (
    <details className="focus-control compact-focus" open={focus || open.length ? true : undefined}>
      <summary>Ultra Priority · {focus ? "Active critical focus" : "Available for critical work"}{open.length ? ` · ${open.length} access requests` : ""}</summary>
      <div className="fc-head">
        <span className="kicker">ULTRA PRIORITY</span>
        {focus ? <strong><Avatar state={state} id={focus.employee} size="sm" /> {nameOf(state, focus.employee)} is in Critical Focus on “{taskById(state, focus.taskId)?.title}” · {duration(now - focus.since)}</strong> : <strong>No one is in Critical Focus.</strong>}
        {focus && (canDecide || focus.activatedBy === actor) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'ultra/release', reason: 'released by manager' })}>Release focus</button>}
        {focus && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(focus.taskId)}>Open task</button>}
      </div>
      {!focus && canActivate && (
        <div className="inline-form">
          <Select value={pick} onChange={event => setPick(event.target.value)} aria-label="Task to make Ultra Priority">
            <option value="">Choose a truly critical task…</option>
            {candidates.map(task => <option key={task.id} value={task.id}>{task.title} — {firstName(state, task.owner)}</option>)}
          </Select>
          <button type="button" className="btn btn-ultra btn-sm" disabled={!pick} onClick={() => void dispatch({ type: 'ultra/activate', taskId: pick })}>Activate critical focus</button>
        </div>
      )}
      {open.map(grant => (
        <div key={grant.id} className="fc-request">
          <div><b>{nameOf(state, grant.requester)}</b> wants <b>{SECTION_LABELS[grant.section]}</b><small>“{grant.reason}”</small></div>
          {grant.status === 'pending' ? (
            canDecide ? (
              <div className="fc-actions">
                <label className="secs">for <input type="number" min={10} max={state.policy.maxGrantSeconds} value={seconds} onChange={event => setSeconds(Number(event.target.value))} aria-label="Seconds of access" />s</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'grant/decide', id: grant.id, approve: false })}>Deny</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatch({ type: 'grant/decide', id: grant.id, approve: true, seconds })}>Approve</button>
              </div>
            ) : <span className="muted">Waiting for {state.policy.ultraScope === 'manager-context' && focus ? nameOf(state, focus.activatedBy) : 'an approver'}</span>
          ) : (
            <div className="fc-actions"><span className="pill pill-working">Approved · {duration((grant.expiresAt ?? now) - now)} left</span>{canDecide && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'grant/revoke', id: grant.id })}>Revoke</button>}</div>
          )}
        </div>
      ))}
      <p className="boundary">{quest.backend.kind === 'live' ? LIVE_ENFORCEMENT_NOTE : ENFORCEMENT_NOTE} Policy: {state.policy.ultraScope === 'manager-context' ? 'only the activating manager decides requests' : 'any approver decides requests'} (change in Policy & data).</p>
      <FocusHistory quest={quest} />
    </details>
  );
}
