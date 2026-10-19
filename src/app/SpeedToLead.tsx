import { Select } from '../ui/Select.tsx';
import { useFeedbackRecord } from '../ui/Feedback.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { ResponseLeague } from './Relationships.tsx';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ContactChannel, ContactOutcome, Lead } from '../core/contract.ts';
import { LEAD_STAGE_LABELS } from '../core/contract.ts';
import { nextSimulatedLead } from '../core/seed.ts';
import { activeLeads, firstName, leadBucket, leadElapsed, nameOf, taskById } from '../core/selectors.ts';
import type { LeadBucket } from '../core/selectors.ts';
import { addDays, clock, duration } from '../core/time.ts';
import { Avatar, PersonSelect, RecordCard, RecordMeta } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { presetFor } from '../core/workspace.ts';
import { InstrumentDeck } from './InstrumentDeck.tsx';

const COLUMNS: { id: LeadBucket; title: string; hint: string }[] = [
  { id: 'attention', title: 'Needs attention', hint: 'Unassigned, past target, blocked or escalated' },
  { id: 'waiting', title: 'Waiting for first response', hint: 'Owner set, clock running' },
  { id: 'responded', title: 'Responded', hint: 'First contact logged' },
];

export const LEAD_HONESTY = 'Leads here are simulated. Task-HQ does not call, text or email anyone and is not connected to a CRM; “Log contact attempt” records what a person did.';
export const LIVE_LEAD_HONESTY = 'Live inquiries require an approved source and workspace mapping. Task-HQ does not call, text or email anyone; log contact attempts only after a person makes them.';

export function SpeedToLead({ quest, onOpen, selectedLead = null, onSelectLead }: { quest: Quest; onOpen: (id: string) => void; selectedLead?: string | null; onSelectLead?: (id: string | null) => void }) {
  const { state, now, dispatch } = quest;
  const leads = activeLeads(state);
  const responded = state.leads.filter(lead => lead.firstResponseAt);
  const avg = responded.length ? responded.reduce((sum, lead) => sum + leadElapsed(lead, now), 0) / responded.length : 0;
  const onTarget = responded.filter(lead => leadElapsed(lead, now) <= state.policy.leadResponseMinutes * 60_000).length;
  const [deckOpen, setDeckOpen] = useState(Boolean(selectedLead));
  const selectedRecord = selectedLead ? state.leads.find(lead => lead.id === selectedLead) : undefined;
  const columns = COLUMNS.map(column => ({
    ...column,
    leads: leads.filter(lead => leadBucket(state, lead, now) === column.id),
  })).filter(column => column.leads.length > 0);

  function selectLead(id: string | null) {
    onSelectLead?.(id);
    setDeckOpen(Boolean(id));
  }

  return (
    <div className="view speed-lead-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Response target {state.policy.leadResponseMinutes} min{quest.backend.kind === 'live' ? '' : ' · demo default'}</p>
          <h1>First Response</h1>
          <p className="lede">New lead → owner → first response → follow-up → {presetFor(state).leadHandoffAction.toLowerCase()} or escalate.</p>
        </div>
        {quest.backend.kind !== 'live' && state.people.find(item => item.id === quest.actor)?.role !== 'reviewer' && <button type="button" className="btn btn-primary" onClick={() => void dispatch({ type: 'lead/receive', lead: nextSimulatedLead(state.leads) })}>Simulate new lead</button>}
      </header>
      <p className="boundary">External sources: unconnected. Synthetic intake uses the task engine; no calls, messages or CRM writes are sent.</p>
      <ResponseLeague quest={quest} />
      <div className="stats lead-stats">
        <div><b>{leads.filter(lead => !lead.firstResponseAt).length}</b><span>waiting for response</span></div>
        <div><b>{avg ? duration(avg) : '—'}</b><span>average first response</span></div>
        <div><b>{responded.length ? `${onTarget}/${responded.length}` : '—'}</b><span>responded within target</span></div>
      </div>
      <p className="boundary">{quest.backend.kind === 'live' ? LIVE_LEAD_HONESTY : LEAD_HONESTY}</p>
      <section className={`lead-deck-shell ${deckOpen ? 'is-open' : ''}`} aria-label="Instrument Deck">
        <div className="lead-deck-bar">
          <div className="lead-deck-copy">
            <span className="kicker">INSTRUMENT DECK</span>
            <strong>{selectedRecord ? `Focused on ${selectedRecord.name}` : 'Open the deck for contextual controls'}</strong>
            <small>{selectedRecord ? 'Actions are checked against this lead and your role.' : 'Choose a lead to bring its response and handoff tools into focus.'}</small>
          </div>
          <button type="button" className="btn btn-sm lead-deck-toggle" aria-controls="lead-instrument-deck" aria-expanded={deckOpen} onClick={() => setDeckOpen(open => !open)}>
            {deckOpen ? 'Hide instruments' : selectedRecord ? 'Open instruments' : 'Open instrument deck'}
            <span aria-hidden="true">{deckOpen ? '−' : '+'}</span>
          </button>
        </div>
        <div id="lead-instrument-deck" className="lead-deck-content" hidden={!deckOpen}>
          <InstrumentDeck quest={quest} selection={selectedLead ? { leadId: selectedLead } : null} />
          {selectedRecord && <button type="button" className="link lead-deck-clear" onClick={() => selectLead(null)}>Clear lead context</button>}
        </div>
      </section>
      {columns.length > 0 ? (
        <div className="lead-board">
          {columns.map(column => (
            <section key={column.id} className={`lead-col col-${column.id}`}>
              <h3>{column.title} <span>{column.leads.length}</span></h3>
              <small>{column.hint}</small>
              {column.leads.map(lead => <LeadCard key={lead.id} quest={quest} lead={lead} onOpen={onOpen} selected={lead.id === selectedLead} onSelect={selectLead} />)}
            </section>
          ))}
        </div>
      ) : (
        <div className="empty lead-empty">
          <span className="empty-mark" aria-hidden="true">✓</span>
          <h3>No active leads</h3>
          <p>{quest.backend.kind === 'live' ? 'Approved lead sources are not connected to this workspace.' : 'There are no active demo leads. Simulate a lead to walk through first response and handoff.'}</p>
        </div>
      )}
    </div>
  );
}

export function LeadClock({ quest, lead }: { quest: Quest; lead: Lead }) {
  const target = quest.state.policy.leadResponseMinutes * 60_000;
  const elapsed = leadElapsed(lead, quest.now);
  const ratio = Math.min(1, elapsed / target);
  const late = elapsed > target;
  const c = 2 * Math.PI * 20;
  return (
    <span className={`lead-clock ${late ? 'is-late' : ''} ${lead.firstResponseAt ? 'is-done' : ''}`} title={`Target ${quest.state.policy.leadResponseMinutes} min`}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" className="lc-track" /><circle cx="24" cy="24" r="20" className="lc-fill" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} /></svg>
      <b>{duration(elapsed)}</b>
      <small>{lead.firstResponseAt ? 'to first response' : late ? 'over target' : 'waiting'}</small>
    </span>
  );
}

export function LeadCard({ quest, lead, onOpen, selected = false, onSelect }: { quest: Quest; lead: Lead; onOpen: (id: string) => void; selected?: boolean; onSelect?: (id: string | null) => void }) {
  const { state, actor, now, dispatch } = quest;
  const [form, setForm] = useState<'attempt' | 'block' | 'follow' | 'escalate' | null>(null);
  const [channel, setChannel] = useState<ContactChannel>('phone');
  const [outcome, setOutcome] = useState<ContactOutcome>('reached');
  const [note, setNote] = useState('');
  const [due, setDue] = useState(addDays(now, 1));
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const result = form === 'attempt' ? await dispatch({ type: 'lead/attempt', id: lead.id, channel, outcome, note })
        : form === 'block' ? await dispatch({ type: 'lead/block', id: lead.id, note })
        : form === 'follow' ? await dispatch({ type: 'lead/follow-up', id: lead.id, due, note })
        : form === 'escalate' ? await dispatch({ type: 'lead/escalate', id: lead.id, note }) : null;
      if (result?.ok) { setForm(null); setNote(''); }
      else if (result) setActionError(result.error);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Task-HQ could not save this action. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const feedback = useFeedbackRecord(lead.id);
  const followUp = lead.followUpTaskId ? taskById(state, lead.followUpTaskId) : undefined;
  const handoff = lead.handoffTaskId ? taskById(state, lead.handoffTaskId) : undefined;
  const closed = lead.stage === 'won' || state.people.find(item => item.id === actor)?.role === 'reviewer';
  const toggleForm = (next: NonNullable<typeof form>) => {
    setActionError('');
    setForm(current => current === next ? null : next);
  };

  return (
    <div {...feedback} data-feedback-record={lead.id}><RecordCard kind="intake" tone={lead.stage === 'blocked' || lead.stage === 'escalated' ? 'critical' : 'neutral'} className={`lead-card stage-${lead.stage} ${selected ? 'is-selected' : ''}`}>
      <div className="lead-top">
        <LeadClock quest={quest} lead={lead} />
        <div className="lead-id">
          <strong>{lead.name}</strong>
          <span>{lead.need}</span>
          {lead.intake && <RecordMeta className="lead-source-meta">Source event: {lead.intake.externalId} · {lead.intake.channel}{lead.email ? ` · ${lead.email}` : ''}</RecordMeta>}
          <RecordMeta className="lead-source-meta">{lead.source} · arrived {clock(lead.arrivedAt)} · {lead.phone || lead.email || 'No contact method'} · {lead.address}</RecordMeta>
          {onSelect && <button type="button" className="link" aria-pressed={selected} onClick={() => onSelect(selected ? null : lead.id)}>{selected ? 'Close lead instruments ↑' : 'Open lead instruments ↑'}</button>}
        </div>
      </div>
      {!lead.assignee && !closed && quest.backend?.kind !== 'live' && <button type="button" className="btn btn-primary btn-sm" onClick={() => void dispatch({ type: 'lead/claim', id: lead.id })}>Claim inquiry</button>}
      <div className="lead-owner">
        <Avatar state={state} id={lead.assignee} size="sm" />
        <PersonSelect state={state} value={lead.assignee} label="Lead owner" emptyLabel="Assign an owner…" onChange={to => to && void dispatch({ type: 'lead/assign', id: lead.id, to })} disabled={closed} />
        <span className={`pill pill-lead-${lead.stage}`}>{lead.stage === 'won' ? presetFor(state).leadHandedLabel : LEAD_STAGE_LABELS[lead.stage]}</span>
      </div>
      {lead.blocker && lead.stage === 'blocked' && <p className="lead-blocker">Blocked: {lead.blocker}</p>}
      {lead.stage === 'escalated' && <p className="lead-blocker">Escalated to {nameOf(state, lead.escalatedTo)}</p>}
      {lead.attempts.length > 0 && (
        <ol className="lead-attempts">{lead.attempts.map(item => <li key={item.at}><time>{clock(item.at)}</time> {firstName(state, item.by)} · {item.channel} · {item.outcome.replace('-', ' ')}{item.note && <> — <ReferencedText text={item.note} document={item.references?.note} /></>} <em>(logged)</em></li>)}</ol>
      )}
      {(followUp || handoff) && (
        <div className="lead-links">
          {followUp && <button type="button" className="link" onClick={() => onOpen(followUp.id)}>Follow-up task · {firstName(state, followUp.owner)} · {followUp.status === 'done' ? 'done' : `due ${followUp.due}`}</button>}
          {handoff && <button type="button" className="link" onClick={() => onOpen(handoff.id)}>Inspection task · {firstName(state, handoff.owner)} · {handoff.status}</button>}
        </div>
      )}
      {!closed && (
        <div className="lead-actions">
          <button type="button" className={`chip ${form === 'attempt' ? 'is-on' : lead.firstResponseAt ? '' : 'chip-go'}`} aria-expanded={form === 'attempt'} aria-controls={form === 'attempt' ? `lead-action-form-${lead.id}` : undefined} disabled={submitting} onClick={() => toggleForm('attempt')}>{form === 'attempt' ? 'Cancel response' : lead.firstResponseAt ? 'Log contact attempt' : 'Log first response'}</button>
          {lead.firstResponseAt && lead.stage !== 'qualified' && <button type="button" className="chip" onClick={() => void dispatch({ type: 'lead/qualify', id: lead.id })}>Qualified</button>}
          <button type="button" className={`chip ${form === 'follow' ? 'is-on' : ''}`} aria-expanded={form === 'follow'} aria-controls={form === 'follow' ? `lead-action-form-${lead.id}` : undefined} disabled={submitting} onClick={() => toggleForm('follow')}>Schedule follow-up</button>
          <button type="button" className={`chip ${form === 'block' ? 'is-on' : ''}`} aria-expanded={form === 'block'} aria-controls={form === 'block' ? `lead-action-form-${lead.id}` : undefined} disabled={submitting} onClick={() => toggleForm('block')}>Flag blocker</button>
          {lead.firstResponseAt && <button type="button" className="chip chip-go" onClick={() => void dispatch({ type: 'lead/advance', id: lead.id })}>{presetFor(state).leadHandoffAction} →</button>}
          <button type="button" className={`chip chip-warn ${form === 'escalate' ? 'is-on' : ''}`} aria-expanded={form === 'escalate'} aria-controls={form === 'escalate' ? `lead-action-form-${lead.id}` : undefined} disabled={submitting} onClick={() => toggleForm('escalate')}>Escalate</button>
        </div>
      )}
      {form && !closed && (
        <form id={`lead-action-form-${lead.id}`} className="lead-form" onSubmit={submit} aria-busy={submitting}>
          {form === 'attempt' && (
            <>
              <Select value={channel} onChange={event => setChannel(event.target.value as ContactChannel)} aria-label="Channel"><option value="phone">Phone</option><option value="text">Text</option><option value="email">Email</option><option value="in-person">In person</option></Select>
              <Select value={outcome} onChange={event => setOutcome(event.target.value as ContactOutcome)} aria-label="Outcome"><option value="reached">Reached them</option><option value="no-answer">No answer</option><option value="left-message">Left a message</option></Select>
            </>
          )}
          {form === 'follow' && <input type="date" value={due} onChange={event => setDue(event.target.value)} aria-label="Follow-up date" required />}
          <ReferenceInput value={note} onChange={event => setNote(event.target.value)} maxLength={200} aria-label="Note"
            placeholder={form === 'attempt' ? 'What happened? (optional)' : form === 'follow' ? 'Next step (optional)' : form === 'block' ? 'What is blocking this lead?' : 'Why escalate?'} required={form === 'block' || form === 'escalate'} />
          <button className="btn btn-primary btn-sm" disabled={submitting}>{submitting ? 'Saving…' : form === 'attempt' ? lead.firstResponseAt ? 'Log attempt' : 'Save first response' : form === 'follow' ? 'Create follow-up task' : form === 'block' ? 'Flag blocker' : 'Escalate to manager'}</button>
          {actionError && <p className="lead-action-error" role="alert">{actionError}</p>}
          {form === 'attempt' && !lead.assignee && <small className="muted">Logging an attempt makes {firstName(state, actor)} the owner.</small>}
        </form>
      )}
    </RecordCard></div>
  );
}
