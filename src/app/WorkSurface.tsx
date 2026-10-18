// Renders a composed Situation. It knows how to draw each approved block and
// how to collect inputs for capability offers; it decides nothing about what
// is allowed (that comes from compose.ts, which dry-runs the engine).
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { QuestState } from '../core/contract.ts';
import { actionFor, offer as makeOffer } from '../core/capabilities.ts';
import type { ActionOffer, Values } from '../core/capabilities.ts';
import { compose, composeForTask, composeOutcome } from '../core/compose.ts';
import type { ChainNode, Situation } from '../core/compose.ts';
import { firstName, nameOf } from '../core/selectors.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { addDays, clock, duration } from '../core/time.ts';
import { Avatar, PersonSelect } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { Latch, toneForAction } from '../ui/Behavior.tsx';
import type { Selection } from '../core/deck.ts';
import { InstrumentDeck } from './InstrumentDeck.tsx';

function useCompact() {
  const query = '(max-width: 760px)';
  const [compact, setCompact] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setCompact(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return compact;
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

// ── Hosts ──────────────────────────────────────────────────────────────────

/** My Work: the situation-first surface. */
export function WorkSurface({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, now } = quest;
  const viewport = useCompact() ? 'compact' : 'wide';
  const [justDid, setJustDid] = useState<string | null>(null);
  const [select, setSelect] = useState<string | null>(null);
  useEffect(() => { setJustDid(null); setSelect(null); }, [actor]);
  const { primary, queue } = useMemo(() => compose(state, actor, now, { justDid, select, viewport }), [state, actor, now, justDid, select, viewport]);

  return (
    <section className="work-surface" aria-label="Your current situation">
      <SituationView quest={quest} situation={primary} onOpen={onOpen} keyboard
        onPerformed={eventId => { setSelect(null); setJustDid(eventId); }}
        onContinue={() => { setJustDid(null); setSelect(null); }} />
      {(primary.taskId || primary.leadId) && <DeckDrawer quest={quest} selection={primary.leadId ? { leadId: primary.leadId } : { taskId: primary.taskId! }} />}
      {queue.length > 0 && (
        <div className="queue">
          <h3 className="group-title">{primary.kind === 'outcome' ? 'Your next situation' : 'Also waiting on you'} <span>{queue.length}</span></h3>
          <div className="queue-cards">
            {queue.slice(0, 6).map((item, index) => (
              <button key={item.key} type="button" className={`queue-card k-${item.kind}`} style={{ ['--i' as string]: index }}
                onClick={() => { setJustDid(null); setSelect(item.key); }}>
                <small>{item.kicker}</small><strong>{item.kind === 'lead-response' || item.kind === 'approval' || item.kind === 'help-request' ? item.headline : item.taskId ? state.tasks.find(task => task.id === item.taskId)?.title : item.headline}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Task drawer: the same composition, scoped to one task. */
export function TaskSituation({ quest, taskId, onOpen }: { quest: Quest; taskId: string; onOpen: (id: string) => void }) {
  const { state, actor, now } = quest;
  const [justDid, setJustDid] = useState<string | null>(null);
  const situation = (justDid && composeOutcome(state, actor, now, justDid)) || composeForTask(state, actor, now, taskId, { viewport: 'compact' });
  if (!situation) return null;
  return <SituationView quest={quest} situation={situation} onOpen={onOpen} variant="drawer" onPerformed={setJustDid} onContinue={() => setJustDid(null)} />;
}

/** The instrument deck for the current situation, opened on demand and remembered on this device. */
function DeckDrawer({ quest, selection }: { quest: Quest; selection: Selection }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('quest.deck.open') === '1'; } catch { return false; } });
  return (
    <details className="deck-details" open={open} onToggle={event => { const next = (event.target as HTMLDetailsElement).open; setOpen(next); try { localStorage.setItem('quest.deck.open', next ? '1' : '0'); } catch { /* per-session only */ } }}>
      <summary>Instrument deck for this situation</summary>
      {open && <InstrumentDeck quest={quest} selection={selection} variant="embedded" />}
    </details>
  );
}

// ── Situation view ─────────────────────────────────────────────────────────

export function SituationView({ quest, situation, onOpen, onPerformed, onContinue, variant = 'surface', keyboard = false }: {
  quest: Quest; situation: Situation; onOpen: (id: string) => void; onPerformed?: (eventId: string | null) => void; onContinue?: () => void;
  variant?: 'surface' | 'drawer' | 'focus'; keyboard?: boolean;
}) {
  const { state, actor, now, dispatch } = quest;
  const [moreOpen, setMoreOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [afterOpen, setAfterOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [channel, setChannel] = useState('phone');
  const [frozen, setFrozen] = useState<Situation | null>(null);
  useEffect(() => { setMoreOpen(false); setActive(null); setAfterOpen(false); }, [situation.key]);

  async function run(item: ActionOffer, values: Values = {}, fromLatch = false) {
    const action = actionFor(item, item.capability === 'lead.attempt' ? { channel, ...values } : values, actor);
    if (!action) return false;
    if (fromLatch) setFrozen(situation); // keep this composition while the latch shows what happened
    const result = await dispatch(action);
    if (!result.ok) { setFrozen(null); return false; }
    setActive(null);
    if (fromLatch) setTimeout(() => { setFrozen(null); onPerformed?.(result.eventId); }, 650);
    else onPerformed?.(result.eventId);
    return true;
  }
  function trigger(item: ActionOffer) {
    // Optional-only inputs (e.g. a resolution note) never block the action.
    if (item.inputs.every(input => !input.required)) void run(item);
    else setActive(active === item.key ? null : item.key);
  }

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('.drawer, .modal')) return;
      const hit = [...situation.actions, ...situation.more].find(item => item.shortcut === event.key.toLowerCase());
      if (hit) { event.preventDefault(); if (situation.more.includes(hit)) setMoreOpen(true); trigger(hit); }
      if (event.key === 'Enter' && situation.kind === 'outcome' && onContinue) { event.preventDefault(); onContinue(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const s = frozen ?? situation;
  return (
    <div className={`situation v-${variant} k-${s.kind} layout-${s.layout}`} key={s.key} data-kind={s.kind}>
      <header className="situation-head">
        <span className={`situation-kicker k-${s.kind}`}>{s.kind === 'critical-focus' && <span className="pulse" />}{s.kicker}</span>
        {s.taskId && variant !== 'drawer' && s.kind !== 'outcome' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(s.taskId!)}>Details</button>}
      </header>
      <h2 className="situation-headline">{s.headline}</h2>
      {s.detail && <p className="situation-detail">{s.detail}</p>}
      {s.why && <p className="situation-why">{s.why}</p>}

      {s.blocks.includes('lead-timer') && s.timer && <ResponseTimer quest={quest} timer={s.timer} />}
      {s.blocks.includes('outcome') && s.outcome && <OutcomeStage state={state} situation={s} onOpen={onOpen} />}
      {s.blocks.includes('chain') && s.chain.length > 1 && (
        <ChainTrack state={state} situation={s} open={afterOpen} onToggle={() => setAfterOpen(!afterOpen)} onOpen={onOpen} />
      )}

      {s.actions.length > 0 && (
        <div className={`situation-actions ${s.blocks.includes('contact') ? 'is-contact' : ''}`}>
          {s.blocks.includes('contact') && s.actions.some(item => item.capability === 'lead.attempt') && (
            <label className="channel">Contacted by
              <select value={channel} onChange={event => setChannel(event.target.value)} aria-label="Contact channel">
                <option value="phone">Phone</option><option value="text">Text</option><option value="email">Email</option><option value="in-person">In person</option>
              </select>
            </label>
          )}
          {s.actions.map(item => (item.tone === 'primary' && !item.inputs.some(input => input.required)
            ? <span key={item.key} className="offer-latch"><Latch label={item.label} tone={toneForAction(item.label, item.capability)} hint={item.hint} successLabel={successFor(item)} onCommit={() => run(item, {}, true)} /></span>
            : <OfferButton key={item.key} item={item} active={active === item.key} onTrigger={() => trigger(item)} />))}
        </div>
      )}
      {[...s.actions, ...s.more].filter(item => item.key === active).map(item => <OfferForm key={item.key} quest={quest} item={item} onSubmit={values => void run(item, values)} onCancel={() => setActive(null)} />)}
      {s.kind === 'outcome' && onContinue && (
        <button type="button" className="btn btn-dark continue" onClick={onContinue}>Continue to what’s next <span aria-hidden="true">→</span><kbd>Enter</kbd></button>
      )}

      {s.blocks.includes('focus-boundary') && <p className="boundary">Task-HQ pauses its own sections only. Other tabs and apps are not blocked.</p>}

      <div className="situation-reveal">
        {s.more.length > 0 && <button type="button" className="reveal" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>{moreOpen ? 'Fewer options' : `More options (${s.more.length})`}</button>}
        {s.history.length > 0 && <button type="button" className="reveal" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? 'Hide history' : `History (${s.history.length})`}</button>}
        {s.blocks.includes('people') && s.people.filter(item => item.id).length > 0 && (
          <span className="people">{s.people.filter(item => item.id).map(item => <span key={`${item.role}-${item.id}`} className="person-chip"><Avatar state={state} id={item.id} size="sm" /><small>{item.role}</small>{firstName(state, item.id)}</span>)}</span>
        )}
      </div>
      {moreOpen && (
        <div className="more-tools">
          {s.more.map(item => <OfferButton key={item.key} item={item} active={active === item.key} onTrigger={() => trigger(item)} />)}
        </div>
      )}
      {historyOpen && <History quest={quest} situation={s} onOpen={onOpen} />}
      {keyboard && <p className="shortcuts" aria-hidden="true">{[...s.actions, ...s.more].filter(item => item.shortcut).map(item => <span key={item.key}><kbd>{item.shortcut!.toUpperCase()}</kbd> {item.label}</span>)}</p>}
    </div>
  );
}

function successFor(item: ActionOffer) {
  const tone = toneForAction(item.label, item.capability);
  if (tone === 'complete') return 'Done';
  if (tone === 'assist') return 'Resolved';
  if (item.capability === 'lead.attempt') return 'Logged';
  if (item.capability === 'lead.take' || item.capability === 'lead.assign') return 'Yours';
  if (item.capability === 'lead.advance') return 'Handed on';
  return /start/i.test(item.label) ? 'Started' : 'Done';
}

function OfferButton({ item, active, onTrigger }: { item: ActionOffer; active: boolean; onTrigger: () => void }) {
  const big = item.tone === 'primary';
  return (
    <button type="button" className={`offer ${big ? 'offer-primary' : 'offer-secondary'} ${active ? 'is-active' : ''}`} onClick={onTrigger} title={item.hint} aria-expanded={item.inputs.some(input => input.required) ? active : undefined}>
      <span>{item.label}{item.inputs.some(input => input.required) && '…'}</span>{big && <span className="offer-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export function OfferForm({ quest, item, onSubmit, onCancel }: { quest: Quest; item: ActionOffer; onSubmit: (values: Values) => void; onCancel: () => void }) {
  const { state, now } = quest;
  const [values, setValues] = useState<Values>(() => Object.fromEntries(item.inputs.map(input => [input.name, input.kind === 'date' ? addDays(now, 1) : input.kind === 'choice' ? input.options?.[0]?.value ?? '' : ''])));
  const ready = item.inputs.every(input => !input.required || values[input.name]?.trim());
  function submit(event: FormEvent) { event.preventDefault(); if (ready) onSubmit(values); }
  return (
    <form className="offer-form" onSubmit={submit} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
      {item.inputs.map((input, index) => (
        <label key={input.name} className="field"><span>{input.label}</span>
          {input.kind === 'text' && <input autoFocus={index === 0} value={values[input.name] ?? ''} maxLength={300} placeholder={input.placeholder} onChange={event => setValues({ ...values, [input.name]: event.target.value })} />}
          {input.kind === 'date' && <input type="date" value={values[input.name] ?? ''} onChange={event => setValues({ ...values, [input.name]: event.target.value })} />}
          {input.kind === 'person' && <PersonSelect state={state} label={input.label} value={values[input.name] ?? ''} emptyLabel={input.required ? 'Choose…' : 'The team'} onChange={id => setValues({ ...values, [input.name]: id })} />}
          {input.kind === 'choice' && <select value={values[input.name] ?? ''} onChange={event => setValues({ ...values, [input.name]: event.target.value })}>{input.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
        </label>
      ))}
      <div className="offer-form-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!ready}>{item.label}</button></div>
    </form>
  );
}

// ── Blocks ─────────────────────────────────────────────────────────────────

function nodeState(node: ChainNode) {
  if (node.status === 'done') return 'done';
  if (node.position === 'current') return 'current';
  return node.locked || node.position === 'after' ? 'waiting' : 'open';
}

function ChainTrack({ state, situation, open, onToggle, onOpen }: { state: QuestState; situation: Situation; open: boolean; onToggle: () => void; onOpen: (id: string) => void }) {
  const nodes = open ? [...situation.chain, ...situation.downstream] : situation.chain;
  const currentDone = situation.chain.find(node => node.position === 'current')?.status === 'done';
  const label = (node: ChainNode) => {
    if (node.position === 'before') return `Before · ${STATUS_LABELS[node.status]}`;
    if (node.position === 'current') return `Now · ${STATUS_LABELS[node.status]}`;
    if (node.status === 'done') return `${node.depth > 1 ? 'Later' : 'Next'} · Done`;
    return node.depth > 1 ? 'Later · waits on the chain' : currentDone ? `Next · ${node.locked ? 'still waiting' : 'ready'}` : 'Next · waits for this';
  };
  return (
    <div className="chain" aria-label="Dependency chain">
      <ol className="chain-track">
        {nodes.map((node, index) => (
          <li key={node.taskId} className={`chain-node n-${nodeState(node)} p-${node.position}`} style={{ ['--i' as string]: index }}>
            {index > 0 && <span className="chain-link" aria-hidden="true" />}
            <button type="button" onClick={() => onOpen(node.taskId)} aria-label={`${node.title}, ${STATUS_LABELS[node.status]}, ${nameOf(state, node.owner)}`}>
              <small>{label(node)}</small>
              <strong>{node.title}</strong>
              <span className="chain-owner"><Avatar state={state} id={node.owner} size="sm" />{firstName(state, node.owner)}</span>
            </button>
          </li>
        ))}
      </ol>
      {situation.downstream.length > 0 && <button type="button" className="reveal" aria-expanded={open} onClick={onToggle}>{open ? 'Show less' : `What happens after? (${situation.downstream.length} more)`}</button>}
    </div>
  );
}

function OutcomeStage({ state, situation, onOpen }: { state: QuestState; situation: Situation; onOpen: (id: string) => void }) {
  const o = situation.outcome!;
  if (o.tone === 'response') {
    const within = (o.responseMs ?? 0) <= (o.targetMs ?? 0);
    return (
      <div className={`outcome-stage response ${within ? 'is-within' : 'is-over'}`}>
        <div className="response-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, ((o.responseMs ?? 0) / (o.targetMs || 1)) * 100)}%` }} /><i style={{ left: '100%' }} /></div>
        <p><b>{duration(o.responseMs ?? 0)}</b> to first response · target {duration(o.targetMs ?? 0)}</p>
      </div>
    );
  }
  return (
    <div className={`outcome-stage tone-${o.tone}`}>
      <div className={`outcome-done ${o.tone === 'handed-on' ? 'is-handed' : ''}`}><span className="stamp" aria-hidden="true">✓</span><small>{o.tone === 'handed-on' ? 'Responded & handed on' : 'Done'}</small><strong>{o.done}</strong><span className="chain-owner"><Avatar state={state} id={o.doneBy} size="sm" />{firstName(state, o.doneBy)}</span></div>
      {o.unlocked.length > 0 && (
        <>
          <div className="outcome-link" aria-hidden="true"><span className="traveler"><Avatar state={state} id={o.unlocked[0]!.owner} size="sm" /></span></div>
          <div className="outcome-next">
            {o.unlocked.map(item => (
              <button key={item.taskId} type="button" onClick={() => onOpen(item.taskId)}>
                <small>Ready for {firstName(state, item.owner, 'nobody yet')}</small><strong>{item.title}</strong>
                <span className="chain-owner"><Avatar state={state} id={item.owner} size="md" />{nameOf(state, item.owner, 'Unassigned')}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ResponseTimer({ quest, timer }: { quest: Quest; timer: NonNullable<Situation['timer']> }) {
  const elapsed = (timer.stoppedAt ?? quest.now) - timer.startedAt;
  const ratio = Math.min(1, elapsed / timer.targetMs);
  const late = elapsed > timer.targetMs;
  const c = 2 * Math.PI * 54;
  return (
    <div className={`response-timer ${late ? 'is-late' : ''}`} role="timer" aria-label={`${duration(elapsed)} since the lead arrived; target ${duration(timer.targetMs)}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" className="rt-track" /><circle cx="60" cy="60" r="54" className="rt-fill" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} /></svg>
      <div><b>{duration(elapsed)}</b><small>{late ? `over the ${duration(timer.targetMs)} target` : `of ${duration(timer.targetMs)} target`}</small></div>
    </div>
  );
}

function History({ quest, situation, onOpen }: { quest: Quest; situation: Situation; onOpen: (id: string) => void }) {
  const { state, actor, now, dispatch } = quest;
  return (
    <ol className="situation-history">
      {situation.history.map(event => {
        const undo = event.undo && !event.undone && event.actor === actor ? makeOffer(state, actor, now, 'undo', { eventId: event.id }, { label: 'Undo' }) : null;
        return (
          <li key={event.id} className={event.undone ? 'is-undone' : ''}>
            <time>{clock(event.at)}</time>
            <p>{event.text}</p>
            {event.taskId && event.taskId !== situation.taskId && <button type="button" className="link" onClick={() => onOpen(event.taskId!)}>Open</button>}
            {undo && <button type="button" className="link" onClick={() => void dispatch(actionFor(undo, {}, actor)!)}>Undo</button>}
          </li>
        );
      })}
    </ol>
  );
}
