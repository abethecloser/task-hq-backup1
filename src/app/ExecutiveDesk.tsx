// Executive Desk: the Executive Brief, Decision Desk and Daily Signal from the
// shared core (src/core/executive.ts), computed on the workspace this person is
// already authorized to load. Nothing runs by itself: every option is performed
// only after the principal confirms, through the same engine dispatch as any
// other action, and the server re-checks it.
import { useEffect, useMemo, useState } from 'react';
import type { Action } from '../core/contract.ts';
import { actionFor } from '../core/capabilities.ts';
import type { Values } from '../core/capabilities.ts';
import { dailySignal, decisionDesk, executiveBrief } from '../core/executive.ts';
import { operationalMeasures } from '../core/metrics.ts';
import type { Measure } from '../core/metrics.ts';
import type { BriefItem, Decision, DecisionOption } from '../core/executive.ts';
import { firstName, isOpen, nameOf } from '../core/selectors.ts';
import { duration } from '../core/time.ts';
import { Avatar, Empty } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { OfferForm } from './WorkSurface.tsx';

const KIND_LABELS: Record<Decision['kind'], string> = {
  access: 'Access request', approval: 'Approval', 'escalated-lead': 'Escalated lead', 'needs-your-call': 'Needs your call', 'unowned-priority': 'Needs an owner',
};
const sinceKey = (tenant: string, actor: string) => `quest.brief.since.v1.${tenant}.${actor}`;

function readSince(key: string): number | null {
  try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : null; } catch { return null; }
}

export function ExecutiveDesk({ quest, onOpenTask, onOpenLead }: { quest: Quest; onOpenTask: (id: string) => void; onOpenLead: (id: string) => void }) {
  const { state, actor, now } = quest;
  const key = sinceKey(state.workspace.tenantId, actor);
  const [since, setSince] = useState<number | null>(() => readSince(key));
  useEffect(() => setSince(readSince(key)), [key]);
  const minute = Math.floor(now / 60000);
  /* eslint-disable react-hooks/exhaustive-deps */
  const desk = useMemo(() => decisionDesk(state, minute * 60000, actor), [state, actor, minute]);
  const brief = useMemo(() => executiveBrief(state, minute * 60000, actor, { since }), [state, actor, minute, since]);
  const signal = useMemo(() => dailySignal(state, minute * 60000), [state, minute]);
  const measures = useMemo(() => operationalMeasures(state, minute * 60000, actor), [state, minute, actor]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const moving = state.tasks.filter(task => isOpen(task) && task.owner && task.owner !== actor);
  const delegated = moving.filter(task => task.createdBy === actor);
  const waitingPeople = new Set(desk.flatMap(item => item.waiting.map(who => who.personId ?? who.label)));
  const live = quest.backend.kind === 'live';

  function markBriefed() {
    try { localStorage.setItem(key, String(Date.now())); } catch { /* this page only */ }
    setSince(Date.now());
  }
  const openSource = (item: { source: { kind: string; id: string } }) => {
    if (item.source.kind === 'task') onOpenTask(item.source.id);
    else if (item.source.kind === 'lead') onOpenLead(item.source.id);
    else if (item.source.kind === 'event') { const event = state.events.find(entry => entry.id === item.source.id); if (event?.taskId) onOpenTask(event.taskId); else if (event?.leadId) onOpenLead(event.leadId); }
  };

  return (
    <div className="view exec">
      <header className="view-head">
        <div>
          <p className="eyebrow">Executive Desk · {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)}{brief.synthetic ? ' · synthetic demo' : ''}</p>
          <h1>{firstName(state, actor, 'Your')}’s desk</h1>
          <p className="lede">{brief.headline}</p>
        </div>
      </header>

      <div className="answers" role="list">
        <a role="listitem" href="#desk" className={`answer ${brief.needsYou ? 'is-hot' : ''}`}><small>What needs me?</small><b>{brief.needsYou}</b><span>{desk.length ? `${desk.length} decision${desk.length === 1 ? '' : 's'} on your desk` : 'No decisions waiting'}</span></a>
        <a role="listitem" href="#moving" className="answer"><small>What is moving without me?</small><b>{moving.length}</b><span>{delegated.length ? `${delegated.length} you delegated` : 'open tasks owned by others'}</span></a>
        <a role="listitem" href="#desk" className={`answer ${waitingPeople.size ? 'is-warn' : ''}`}><small>Who is waiting on a decision?</small><b>{waitingPeople.size}</b><span>{waitingPeople.size ? [...new Set(desk.flatMap(item => item.waiting.map(who => who.personId ? firstName(state, who.personId) : who.label)))].slice(0, 3).join(', ') : 'Nobody is waiting on you'}</span></a>
      </div>

      <section id="desk" className="exec-section" aria-labelledby="desk-title">
        <h2 id="desk-title" className="section-label">Decision Desk <span>{desk.length}</span></h2>
        {desk.length === 0 ? <Empty title="No decisions need your authority">Approvals, access requests, escalations and unowned priority work appear here.</Empty>
          : <div className="decisions">{desk.map((item, index) => <DecisionCard key={item.id} quest={quest} decision={item} index={index} onOpenSource={() => openSource(item)} />)}</div>}
      </section>

      <section id="moving" className="exec-section" aria-labelledby="moving-title">
        <h2 id="moving-title" className="section-label">Moving without you <span>{moving.length}</span></h2>
        {moving.length === 0 ? <p className="muted">No open work is owned by someone else yet.</p> : (
          <ul className="exec-list">
            {moving.slice(0, 8).map(task => (
              <li key={task.id}><button type="button" className="exec-row" onClick={() => onOpenTask(task.id)}>
                <Avatar state={state} id={task.owner} size="sm" /><span><b>{task.title}</b><small>{nameOf(state, task.owner)} · {task.status}{task.createdBy === actor ? ' · delegated by you' : ''}{task.status === 'blocked' ? ` · blocked ${duration(now - (task.blocker?.at ?? task.lastActivityAt))}` : ''}</small></span>
              </button></li>
            ))}
          </ul>
        )}
      </section>

      <section className="exec-section" aria-labelledby="brief-title">
        <div className="section-head">
          <h2 id="brief-title" className="section-label">Executive Brief</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={markBriefed} title="Remembered on this device only">Mark briefed now</button>
        </div>
        <div className="brief-grid">
          {brief.sections.filter(section => section.key !== 'decisions').map(section => (
            <article key={section.key} className={`brief-card status-${section.status}`}>
              <h3>{section.label} <span>{section.items.length}</span></h3>
              {section.note && <p className="brief-note">{section.note}{section.key === 'changes' && since ? ` Since ${new Date(since).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (this device).` : ''}</p>}
              {section.status === 'not-connected' ? null : section.items.length === 0 ? <p className="brief-empty">None.</p> : (
                <ul>{section.items.slice(0, 5).map((item: BriefItem) => (
                  <li key={item.id}><button type="button" className="brief-item" onClick={() => openSource(item)}>
                    <i className={`sev sev-${item.severity}`} aria-hidden="true" />
                    <span>{item.text}<small>{item.onDesk ? 'On your decision desk' : item.needsPrincipal ? 'Needs you' : item.handler ? `With ${firstName(state, item.handler)}` : 'With the team'}</small></span>
                  </button></li>
                ))}{section.items.length > 5 && <li className="brief-more">+{section.items.length - 5} more</li>}</ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="exec-section" aria-labelledby="signal-title">
        <h2 id="signal-title" className="section-label">Daily Signal</h2>
        <p className="signal-summary">{signal.summary}</p>
        <div className="signal-totals">
          <span><b>{signal.totals.completed}</b> completed</span><span><b>{signal.totals.handoffs}</b> handoffs</span><span><b>{signal.totals.helpRequests}</b> help requests</span><span><b>{signal.totals.approvals}</b> approvals</span><span><b>{signal.totals.leadActivity}</b> lead updates</span>
        </div>
        <ul className="sig-sources is-inline">{signal.sources.map(source => <li key={source.id} title={source.note}><i className={`sig-dot ${source.status === 'connected' ? 'is-live' : ''}`} aria-hidden="true" />{source.label}<small>{source.status === 'connected' ? (live ? 'live records' : 'synthetic') : 'not connected'}</small></li>)}</ul>
        <p className="muted">Only Task-HQ records are read. Calls, email, calendar and customer interactions are not connected, so nothing is shown for them rather than guessed.</p>
      </section>

      <section className="exec-section" aria-labelledby="measures-title">
        <h2 id="measures-title" className="section-label">Operational measures</h2>
        <div className="measure-grid">{measures.measures.map(item => <MeasureCell key={item.key} item={item} />)}</div>
        <p className="muted">From Task-HQ’s own records{measures.since ? ` since ${new Date(measures.since).toLocaleDateString()}` : ''}{measures.partial ? ' (partial: only the most recent 400 changes are kept)' : ''}. No baselines or savings are estimated; each figure shows how many records it’s based on.</p>
      </section>
    </div>
  );
}

function DecisionCard({ quest, decision, index, onOpenSource }: { quest: Quest; decision: Decision; index: number; onOpenSource: () => void }) {
  const { state, actor, dispatch } = quest;
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = decision.options.filter(option => option.supported);
  const refused = decision.options.filter(option => !option.supported);

  async function perform(action: Action | null) {
    if (!action) return;
    setBusy(true);
    const result = await dispatch(action);
    setBusy(false);
    if (result.ok) setActive(null);
  }
  // Choosing never performs anything: options with inputs open a form, the rest ask for confirmation.
  const choose = (option: DecisionOption) => setActive(active === option.key ? null : option.key);
  const chosen = decision.options.find(option => option.key === active);

  return (
    <article className={`decision sev-${decision.urgency}`} style={{ ['--i' as string]: Math.min(index, 8) }}>
      <header className="decision-head">
        <span className="decision-kind">{KIND_LABELS[decision.kind]}</span>
        <button type="button" className="link" onClick={onOpenSource}>Open {decision.source.kind === 'lead' ? 'lead' : 'task'}</button>
      </header>
      <h3 className="decision-what">{decision.what}</h3>
      <dl className="decision-facts">
        <div><dt>Why it matters</dt><dd>{decision.why}</dd></div>
        <div><dt>Who is waiting</dt><dd className="decision-waiting">{decision.waiting.length ? decision.waiting.map(who => <span key={who.label} className="person-chip">{who.personId && <Avatar state={state} id={who.personId} size="sm" />}{who.label}</span>) : 'Nobody directly'}</dd></div>
        <div><dt>If it waits</dt><dd>{decision.delay}</dd></div>
        <div><dt>Recommended</dt><dd>{decision.recommendation}</dd></div>
      </dl>
      <div className="decision-options" role="group" aria-label="Options">
        {supported.map(option => (
          <button key={option.key} type="button" disabled={busy} aria-pressed={active === option.key}
            className={`btn btn-sm ${option.recommended ? 'btn-primary' : 'btn-ghost'} ${active === option.key ? 'is-chosen' : ''}`} onClick={() => choose(option)}>
            {option.label}{option.recommended && <span className="rec-mark">Recommended</span>}
          </button>
        ))}
        {refused.map(option => <button key={option.key} type="button" className="btn btn-ghost btn-sm" disabled title={option.refusal}>{option.label}</button>)}
      </div>
      {refused.length > 0 && <p className="decision-refusal">{refused.map(option => `${option.label}: ${option.refusal}`).join(' ')}</p>}
      {chosen?.offer && chosen.offer.inputs.length > 0 && (
        <OfferForm quest={quest} item={chosen.offer} onCancel={() => setActive(null)} onSubmit={(values: Values) => void perform(actionFor(chosen.offer!, values, actor))} />
      )}
      {chosen && (!chosen.offer || chosen.offer.inputs.length === 0) && (
        <div className="confirm-bar" role="alert">
          <span>Confirm: <b>{chosen.label}</b>. {chosen.kind === 'approve' ? 'This completes the work and unlocks what waits on it.' : chosen.kind === 'delegate' ? 'The work moves to someone else; you stay informed.' : 'The people involved see the change right away.'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive(null)}>Cancel</button>
          <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={() => void perform(chosen.action ?? (chosen.offer ? actionFor(chosen.offer, {}, actor) : null))}>{busy ? 'Saving…' : 'Confirm'}</button>
        </div>
      )}
    </article>
  );
}

const UNIT: Record<Measure['unit'], string> = { minutes: 'min', hours: 'h', count: '', percent: '%', 'per-task': 'per task' };
function MeasureCell({ item }: { item: Measure }) {
  return (
    <article className={`measure ${item.value === null ? 'is-empty' : ''}`}>
      <small>{item.label}</small>
      <b>{item.value === null ? '—' : item.value}{item.value !== null && UNIT[item.unit] && <em>{UNIT[item.unit]}</em>}</b>
      <span>{item.note}</span>
      <i>n = {item.sample}</i>
    </article>
  );
}
