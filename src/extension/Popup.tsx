import { Select } from '../ui/Select.tsx';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Section } from '../core/contract.ts';
import { SECTION_LABELS } from '../core/contract.ts';
import { insightsFor } from '../core/rules.ts';
import {
  activeGrant, activeLeads, canDecideGrants, firstName, hasRole, inFocus, leadBucket, myTasks, nameOf, nextActionable, pendingGrant, taskById,
} from '../core/selectors.ts';
import { duration, localDate } from '../core/time.ts';
import { appUrl, isExtensionContext } from '../adapter/store.ts';
import { Avatar, InsightCard, MoveForward, PersonSelect, BrandMark, TaskTags, ToastBar, WorkingAs } from '../ui/components.tsx';
import { useQuest } from '../ui/useQuest.ts';
import type { Quest } from '../ui/useQuest.ts';
import { LeadClock } from '../app/SpeedToLead.tsx';
import { resolveContext } from '../core/deck.ts';

function openApp(taskId?: string, view?: string) {
  const url = appUrl(taskId, view);
  if (isExtensionContext()) void chrome.tabs.create({ url });
  else window.open(url, '_blank');
}

export default function Popup() {
  const quest = useQuest('popup');
  if (quest.loadError) return <div className="pop-boot">Task-HQ could not load: {quest.loadError}</div>;
  if (!quest.state || !quest.actor) return <div className="pop-boot"><BrandMark /> Opening…</div>;
  return <PopupBody quest={quest as Quest} />;
}

function PopupBody({ quest }: { quest: Quest }) {
  const { state, actor, now, dispatch } = quest;
  const [tab, setTab] = useState<'work' | 'attention' | 'leads'>('work');
  const focused = inFocus(state, actor);
  const grant = activeGrant(state, actor, now);
  const attention = insightsFor(state, now, actor);
  const waitingLeads = activeLeads(state).filter(lead => leadBucket(state, lead, now) !== 'responded');
  const can = (section: Section) => !focused || grant?.section === section;

  return (
    <div className={`pop ${focused ? 'is-focus' : ''}`}>
      <header className="pop-head">
        <BrandMark size={26} />
        <strong className="pop-brand">Task-HQ Companion<small>{quest.state.workspace.name}</small></strong>
        <WorkingAs quest={quest} compact />
        <button type="button" className="icon-btn" title="Open Task-HQ" aria-label="Open Task-HQ" onClick={() => openApp()}>↗</button>
      </header>
      <p className="pop-mode" title={quest.backend.detail}>{quest.backend.label} · demo · teammates are not notified</p>

      {focused && grant && (
        <div className="grant-bar is-pop"><div className="grant-fill" style={{ width: `${Math.max(0, ((grant.expiresAt ?? now) - now) / (grant.durationSec * 10))}%` }} />
          <span>{SECTION_LABELS[grant.section]} open · <b>{duration((grant.expiresAt ?? now) - now)}</b></span>
          <button type="button" className="btn btn-sm btn-dark" onClick={() => void dispatch({ type: 'grant/return', id: grant.id })}>Return</button>
        </div>
      )}

      {focused && !grant ? <PopFocus quest={quest} /> : (
        <>
          <nav className="pop-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'work'} onClick={() => setTab('work')}>My Work</button>
            <button type="button" role="tab" aria-selected={tab === 'attention'} disabled={!can('needs-attention') && !can('company-work')} onClick={() => setTab('attention')}>Attention {attention.length > 0 && <span className="badge">{attention.length}</span>}</button>
            <button type="button" role="tab" aria-selected={tab === 'leads'} disabled={!can('leads')} onClick={() => setTab('leads')}>Leads {waitingLeads.length > 0 && <span className="badge">{waitingLeads.length}</span>}</button>
          </nav>
          {tab === 'work' && <PopWork quest={quest} />}
          {tab === 'attention' && (
            <div className="pop-list">
              <PopManager quest={quest} />
              {attention.length === 0 ? <p className="muted pad">Nothing needs you right now.</p> : attention.slice(0, 6).map(item => <InsightCard key={item.id} quest={quest} insight={item} onOpen={id => openApp(id)} />)}
              <button type="button" className="link pad" onClick={() => openApp(undefined, 'needs-attention')}>See all of Needs Attention →</button>
            </div>
          )}
          {tab === 'leads' && <PopLeads quest={quest} />}
        </>
      )}
      <ToastBar toast={quest.toast} onUndo={eventId => void dispatch({ type: 'undo', eventId })} onDismiss={quest.dismissToast} />
    </div>
  );
}

function PopWork({ quest }: { quest: Quest }) {
  const { state, actor, now, dispatch } = quest;
  const next = nextActionable(state, actor, now);
  const others = myTasks(state, actor, now).filter(task => task.id !== next?.id).slice(0, 5);
  const [help, setHelp] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState(actor);
  const focused = inFocus(state, actor);
  const grant = activeGrant(state, actor, now);
  const canCreate = !focused || grant?.section === 'create-task';

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await dispatch({ type: 'task/create', task: { title, owner, due: localDate(now) } });
    if (result.ok) setTitle('');
  }
  async function askHelp(event: FormEvent) {
    event.preventDefault();
    if (!next) return;
    const result = await dispatch({ type: 'task/request-help', id: next.id, note: help });
    if (result.ok) { setHelp(''); setHelpOpen(false); }
  }

  return (
    <div className="pop-list">
      {next ? (
        <section className={`pop-next ${next.ultra ? 'is-ultra' : ''}`}>
          <div className="pop-next-top"><span className="kicker">NEXT UP</span><TaskTags state={state} task={next} now={now} /></div>
          <h2>{next.title}</h2>
          <p>{next.status === 'blocked' ? `Blocked: ${next.blocker?.note}` : next.nextAction || 'No next action written yet.'}</p>
          <MoveForward quest={quest} task={next} />
          <div className="pop-row-actions">
            {next.status !== 'blocked' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHelpOpen(!helpOpen)}>Request help</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openApp(next.id)}>Open in Task-HQ ↗</button>
          </div>
          {helpOpen && <form className="inline-form" onSubmit={askHelp}><input autoFocus value={help} onChange={event => setHelp(event.target.value)} placeholder="What’s blocking you?" maxLength={300} /><button className="btn btn-primary btn-sm" disabled={!help.trim()}>Ask</button></form>}
        </section>
      ) : <p className="muted pad">Nothing is waiting on you. Nice.</p>}

      {others.map(task => (
        <div key={task.id} className="pop-row">
          <span className={`state-dot dot-${task.status}`} />
          <button type="button" className="pop-row-title" onClick={() => openApp(task.id)}>{task.title}<small>{task.status === 'review' && task.approver === actor ? `Approve for ${firstName(state, task.owner)}` : task.nextAction || 'No next action'}</small></button>
          <MoveForward quest={quest} task={task} compact />
        </div>
      ))}

      {canCreate ? (
        <form className="pop-create" onSubmit={create}>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Quick task…" maxLength={160} aria-label="Quick task" />
          <PersonSelect state={state} label="Owner" value={owner} emptyLabel="Unassigned" onChange={setOwner} />
          <button className="btn btn-primary btn-sm" disabled={!title.trim()}>Add</button>
        </form>
      ) : <p className="muted pad">Creating tasks is paused during Critical Focus.</p>}
      <PopManager quest={quest} />
    </div>
  );
}

function PopManager({ quest }: { quest: Quest }) {
  const { state, actor, now, dispatch } = quest;
  const [pick, setPick] = useState('');
  const canActivate = hasRole(state, actor, state.policy.ultraActivators) && !state.focus;
  const open = state.grants.filter(grant => grant.status === 'pending' || (grant.status === 'approved' && (grant.expiresAt ?? 0) > now));
  const canManage = canDecideGrants(state, actor) || (!!state.focus && hasRole(state, actor, state.policy.ultraApprovers));
  if (!canActivate && !(canManage && (state.focus || open.length))) return null;
  return (
    <section className="pop-manager">
      {canActivate && (
        <div className="inline-form">
          <Select value={pick} onChange={event => setPick(event.target.value)} aria-label="Task to make Ultra Priority">
            <option value="">Only priority: choose a critical task…</option>
            {state.tasks.filter(task => task.status !== 'done' && task.owner).map(task => <option key={task.id} value={task.id}>{task.title} — {firstName(state, task.owner)}</option>)}
          </Select>
          <button type="button" className="btn btn-ultra btn-sm" disabled={!pick} onClick={() => void dispatch({ type: 'ultra/activate', taskId: pick }).then(() => setPick(''))}>Only priority</button>
        </div>
      )}
      {state.focus && <p><b>Ultra:</b> {firstName(state, state.focus.employee)} on “{taskById(state, state.focus.taskId)?.title}” <button type="button" className="link" onClick={() => void dispatch({ type: 'ultra/release', reason: 'released from the extension' })}>Release</button></p>}
      {open.map(grant => (
        <div key={grant.id} className="pop-req">
          <span><b>{firstName(state, grant.requester)}</b> → {SECTION_LABELS[grant.section]}<small>“{grant.reason}”</small></span>
          {grant.status === 'pending'
            ? <span><button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'grant/decide', id: grant.id, approve: false })}>Deny</button><button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatch({ type: 'grant/decide', id: grant.id, approve: true })}>Approve {duration(state.policy.grantSeconds * 1000)}</button></span>
            : <span>{duration((grant.expiresAt ?? now) - now)} <button type="button" className="link" onClick={() => void dispatch({ type: 'grant/revoke', id: grant.id })}>Revoke</button></span>}
        </div>
      ))}
    </section>
  );
}

function PopFocus({ quest }: { quest: Quest }) {
  const { state, actor, dispatch } = quest;
  const task = taskById(state, state.focus!.taskId);
  const pending = pendingGrant(state, actor);
  const [section, setSection] = useState<Section>('company-work');
  const [reason, setReason] = useState('');
  if (!task) return null;
  return (
    <div className="pop-focus">
      <span className="focus-badge"><span className="pulse" />CRITICAL FOCUS</span>
      <h2>{task.title}</h2>
      <p>{task.nextAction || task.description}</p>
      <MoveForward quest={quest} task={task} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openApp(task.id)}>Open in Task-HQ ↗</button>
      {pending
        ? <p className="waiting">Waiting for {nameOf(state, state.focus!.activatedBy)} to decide: {SECTION_LABELS[pending.section]}</p>
        : (
          <form className="pop-access" onSubmit={async event => { event.preventDefault(); const result = await dispatch({ type: 'grant/request', section, reason }); if (result.ok) setReason(''); }}>
            <Select value={section} onChange={event => setSection(event.target.value as Section)} aria-label="Access to">{(['company-work', 'needs-attention', 'leads', 'create-task'] as Section[]).map(id => <option key={id} value={id}>{SECTION_LABELS[id]}</option>)}</Select>
            <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Why you need it" maxLength={200} />
            <button className="btn btn-primary btn-sm" disabled={!reason.trim()}>Request access</button>
          </form>
        )}
      <p className="boundary">Task-HQ pauses its own sections only. Other tabs and apps are not blocked.</p>
    </div>
  );
}

function PopLeads({ quest }: { quest: Quest }) {
  const { state, actor, now, dispatch } = quest;
  const leads = activeLeads(state).filter(lead => lead.stage !== 'won').slice(0, 5);
  return (
    <div className="pop-list">
      {leads.map(lead => (
        <div key={lead.id} className={`pop-lead b-${leadBucket(state, lead, now)}`}>
          <LeadClock quest={quest} lead={lead} />
          <span className="pop-lead-main"><b>{lead.name}</b><small>{lead.need}</small><small><Avatar state={state} id={lead.assignee} size="sm" /> {lead.assignee ? firstName(state, lead.assignee) : 'Unassigned'}</small><small className="pop-next-step">Next: {resolveContext(state, actor, { leadId: lead.id }, now).nextStep}</small><button type="button" className="link" onClick={() => openApp(undefined, `leads/${lead.id}`)}>Open in instrument deck ↗</button></span>
          <span className="pop-lead-actions">
            {!lead.assignee && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'lead/assign', id: lead.id, to: actor })}>Take it</button>}
            {!lead.firstResponseAt && <button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatch({ type: 'lead/attempt', id: lead.id, channel: 'phone', outcome: 'reached' })}>Log: reached</button>}
            {!lead.firstResponseAt && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void dispatch({ type: 'lead/attempt', id: lead.id, channel: 'phone', outcome: 'no-answer' })}>Log: no answer</button>}
          </span>
        </div>
      ))}
      <p className="boundary">Simulated leads. Task-HQ logs what you did; it does not call or text anyone.</p>
      <button type="button" className="link pad" onClick={() => openApp(undefined, 'leads')}>Open Speed to Lead →</button>
    </div>
  );
}
