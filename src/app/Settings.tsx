import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Policy, Role } from '../core/contract.ts';
import { OPERATIONAL_ROLES } from '../core/contract.ts';
import { clock } from '../core/time.ts';
import { hasRole, nameOf } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { useLive } from './LiveContext.tsx';
import { LookSwitch } from '../ui/components.tsx';
import { PRESETS, PRODUCT, entitlementsFor, presetFor } from '../core/workspace.ts';
import type { PresetId } from '../core/workspace.ts';


export function Activity({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, dispatch } = quest;
  const [kind, setKind] = useState('');
  const events = state.events.filter(event => !kind || event.kind === kind).slice(0, 150);
  return (
    <div className="view">
      <header className="view-head">
        <div><p className="eyebrow">Event history</p><h1>Activity</h1><p className="lede">Every change, who made it, and what it set in motion.</p></div>
        <select value={kind} onChange={event => setKind(event.target.value)} aria-label="Filter activity">
          <option value="">All activity</option><option value="task">Tasks</option><option value="handoff">Handoffs</option><option value="help">Help</option>
          <option value="approval">Approvals</option><option value="ultra">Ultra Priority</option><option value="grant">Access requests</option><option value="lead">Leads</option>
        </select>
      </header>
      <ol className="timeline">
        {events.map(event => (
          <li key={event.id} className={event.undone ? 'is-undone' : ''}>
            <time>{clock(event.at)}</time>
            <span className={`tl-kind k-${event.kind}`}>{event.kind}</span>
            <p>{event.text} <small>— {event.actor === 'system' ? 'Task-HQ' : nameOf(state, event.actor)}</small></p>
            <span className="tl-actions">
              {event.taskId && <button type="button" className="link" onClick={() => onOpen(event.taskId!)}>Open</button>}
              {event.undo && !event.undone && event.actor === actor && <button type="button" className="link" onClick={() => void dispatch({ type: 'undo', eventId: event.id })}>Undo</button>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Settings({ quest, onPeople }: { quest: Quest; onPeople?: () => void }) {
  const { state, actor, dispatch, backend } = quest;
  const live = useLive();
  const isManager = hasRole(state, actor, ['manager']);
  const [draft, setDraft] = useState<Policy>(state.policy);
  const [confirmReset, setConfirmReset] = useState(false);
  const [outbox, setOutbox] = useState(0);
  useEffect(() => setDraft(state.policy), [state.policy]);
  useEffect(() => { void backend.outboxCount().then(setOutbox); }, [backend, state.rev]);

  const toggleRole = (key: 'ultraActivators' | 'ultraApprovers', role: Role) => setDraft(current => ({ ...current, [key]: current[key].includes(role) ? current[key].filter(item => item !== role) : [...current[key], role] }));
  const num = (key: keyof Policy) => (event: ChangeEvent<HTMLInputElement>) => setDraft(current => ({ ...current, [key]: Number(event.target.value) }));

  return (
    <div className="view">
      <header className="view-head"><div><p className="eyebrow">{backend.kind === 'live' ? state.workspace.name : 'Configurable · demo defaults'}</p><h1>Policy & data</h1><p className="lede">{backend.kind === 'live' ? 'Policy applies to everyone in this workspace. ' : 'These are starting points to try, not company policy. '}{isManager ? 'You can change them as a manager.' : 'Only a manager can change them.'}</p></div></header>

      {backend.kind === 'live'
        ? <section className="panel settings"><h3>Members & access</h3><p className="muted">Members, invitations, access requests and roles{live ? ` for ${live.org.name}` : ''} live in People & Roles.</p>{onPeople && <button type="button" className="btn btn-ghost" onClick={onPeople}>Open People & Roles</button>}</section>
        : <WorkspacePanel quest={quest} isManager={isManager} />}

      <section className="panel settings">
        <h3>Appearance</h3>
        <p className="muted">Studio is the default design. Brutalist uses heavy type, monospace labels, hard rules and square corners. Saved in this browser only; it doesn’t change anything for your team.</p>
        <LookSwitch />
      </section>

      <section className="panel settings">
        <h3>Ultra Priority</h3>
        <p className="muted">Governance is undecided on purpose: try both scopes and choose.</p>
        <fieldset disabled={!isManager}>
          <label className="row-field">Who decides access requests
            <select value={draft.ultraScope} onChange={event => setDraft({ ...draft, ultraScope: event.target.value as Policy['ultraScope'] })}>
              <option value="manager-context">Only the manager who activated focus</option>
              <option value="company-wide">Any approver in the company</option>
            </select>
          </label>
          {(['ultraActivators', 'ultraApprovers'] as const).map(key => (
            <div key={key} className="row-field">{key === 'ultraActivators' ? 'Who can activate Ultra Priority' : 'Who can approve, revoke and release'}
              <div className="checks">{OPERATIONAL_ROLES.map(role => <label key={role}><input type="checkbox" checked={draft[key].includes(role)} onChange={() => toggleRole(key, role)} />{presetFor(state).roleLabels[role]}</label>)}</div>
            </div>
          ))}
          <label className="row-field">Default temporary access (seconds)<input type="number" min={10} value={draft.grantSeconds} onChange={num('grantSeconds')} /></label>
          <label className="row-field">Longest access a manager may grant (seconds)<input type="number" min={30} value={draft.maxGrantSeconds} onChange={num('maxGrantSeconds')} /></label>
        </fieldset>
        <h3>Speed to Lead & attention rules</h3>
        <fieldset disabled={!isManager}>
          <label className="row-field">First-response target (minutes)<input type="number" min={1} value={draft.leadResponseMinutes} onChange={num('leadResponseMinutes')} /></label>
          <label className="row-field">Flag work as stalled after (hours)<input type="number" min={1} value={draft.stalledHours} onChange={num('stalledHours')} /></label>
          <label className="row-field check-row"><input type="checkbox" checked={draft.agentPilot} onChange={event => setDraft({ ...draft, agentPilot: event.target.checked })} />Show the simulated Agent pilot (off by default; Task-HQ never needs it)</label>
        </fieldset>
        {isManager && <button type="button" className="btn btn-primary" disabled={JSON.stringify(draft) === JSON.stringify(state.policy)} onClick={() => void dispatch({ type: 'policy/update', changes: draft })}>Save policy</button>}
      </section>

      <section className="panel settings">
        <h3>Where this data lives</h3>
        <p><b>{backend.label}.</b> {backend.detail}</p>
        {backend.kind === 'live'
          ? <>
            <p className="muted">Revision {state.rev}. Task data lives on the Task-HQ server: every change is checked against your role there and recorded in the audit log. This browser keeps only your sign-in, display preferences and any feedback captures you made here.</p>
            {isManager && <p><button type="button" className="btn btn-ghost" onClick={() => downloadBackup(state)}>Download workspace backup (.json)</button> <small className="muted">A full copy of tasks, history, feedback and policy at revision {state.rev}. Keep it somewhere safe; the Task-HQ team can restore from it.</small></p>}
          </>
          : <>
            <p className="muted">{outbox} change(s) recorded on this device. None have been delivered to teammates because no shared Task-HQ server is connected. Revision {state.rev} · last written by {state.writer}.</p>
            <p className="muted">Sign-in is not real: “Working as” lets you play each synthetic person to try the hand-offs. Authorization rules are enforced in Task-HQ’s shared rules on this device only.</p>
          </>}
        {confirmReset
          ? <div className="inline-form"><span>Replace all demo data with a fresh sample workspace?</span><button type="button" className="btn btn-danger" onClick={() => { void dispatch({ type: 'demo/reset' }); setConfirmReset(false); }}>Yes, reset</button><button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button></div>
          : backend.kind !== 'live' && <button type="button" className="btn btn-ghost" onClick={() => setConfirmReset(true)}>Reset demo workspace…</button>}
      </section>
    </div>
  );
}

function downloadBackup(state: Quest['state']) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify({ format: 'task-hq.workspace-backup.v1', exportedAt: new Date().toISOString(), workspace: state.workspace, state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `task-hq-${state.workspace.id}-rev${state.rev}-${stamp}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function WorkspacePanel({ quest, isManager }: { quest: Quest; isManager: boolean }) {
  const { state, dispatch } = quest;
  const workspace = state.workspace;
  const [name, setName] = useState(workspace.name);
  const [preset, setPreset] = useState<PresetId>(workspace.preset);
  useEffect(() => { setName(workspace.name); setPreset(workspace.preset); }, [workspace.name, workspace.preset]);
  const features = entitlementsFor(state);
  return (
    <section className="panel settings">
      <h3>Workspace</h3>
      <p className="muted">{PRODUCT.name} is the platform; this is one customer workspace. Industry language and handoffs come from the preset, not the product.</p>
      <fieldset disabled={!isManager}>
        <label className="row-field">Workspace name<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <label className="row-field">Industry preset
          <select value={preset} onChange={event => setPreset(event.target.value as PresetId)}>{(Object.keys(PRESETS) as PresetId[]).map(id => <option key={id} value={id}>{PRESETS[id].label}</option>)}</select>
        </label>
        <p className="muted">Lead handoff in this preset: “{PRESETS[preset].leadHandoffAction}” creates an {PRESETS[preset].leadHandoffNoun}.</p>
      </fieldset>
      {isManager && <button type="button" className="btn btn-primary" disabled={name.trim() === workspace.name && preset === workspace.preset} onClick={() => void dispatch({ type: 'workspace/update', changes: { name, preset } })}>Save workspace</button>}
      <dl className="status-grid">
        <dt>Type</dt><dd>{workspace.kind === 'organization' ? 'Organization' : 'Individual'}</dd>
        <dt>Tenant</dt><dd>{workspace.tenantId} (local; a server would enforce isolation per tenant)</dd>
        <dt>Plan</dt><dd>Local demo — every feature on, no billing{features.maxMembers ? ` · up to ${features.maxMembers} members` : ''}</dd>
      </dl>
    </section>
  );
}
