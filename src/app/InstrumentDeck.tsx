import { Select } from '../ui/Select.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
// Contextual Instrument Deck: renders a validated DeckSpec using only the
// registered instruments below. Business changes always go preview → confirm →
// engine; deck settings (P-level, interval, personal focus) stay on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { Section } from '../core/contract.ts';
import { SECTION_LABELS } from '../core/contract.ts';
import { actionFor, check } from '../core/capabilities.ts';
import type { ActionOffer, Values } from '../core/capabilities.ts';
import { DEFAULT_DECK_PREFS, clampDuration, composeDeck, resolveContext, taskPriorityFor } from '../core/deck.ts';
import type { DeckContext, DeckPrefs, Selection } from '../core/deck.ts';
import { INSTRUMENTS, DURATION_RANGE } from '../core/instruments.ts';
import type { InstrumentId, InstrumentSpec } from '../core/instruments.ts';
import { examplesFor, parseIntent } from '../core/intent.ts';
import type { Intent } from '../core/intent.ts';
import { firstName, nameOf } from '../core/selectors.ts';
import { addDays, clock, duration } from '../core/time.ts';
import { Avatar, PersonSelect } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { Latch, Switch, toneForAction } from '../ui/Behavior.tsx';
import type { BehaviorTone } from '../ui/Behavior.tsx';
import { useSoundPreference } from '../ui/sound.ts';
import { presetFor } from '../core/workspace.ts';

// ── Deck preferences: P-level and interval persist per lead/task on this device; focus never does ──
const PREFS_KEY = 'quest.deck.v1';
function loadPrefs(key: string): DeckPrefs {
  try {
    const saved = (JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, Partial<DeckPrefs>>)[key];
    return { ...DEFAULT_DECK_PREFS, priority: Number(saved?.priority) || DEFAULT_DECK_PREFS.priority, durationMin: clampDuration(Number(saved?.durationMin) || DEFAULT_DECK_PREFS.durationMin), focus: { on: false, startedAt: null } };
  } catch { return { ...DEFAULT_DECK_PREFS }; }
}
function savePrefs(key: string, prefs: DeckPrefs) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    all[key] = { priority: prefs.priority, durationMin: prefs.durationMin };
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  } catch { /* preferences stay in memory */ }
}

interface Pending { offer: ActionOffer; preview: string; source: 'rocker' | 'intent' | 'dial' | 'access' }
interface Feedback { tone: 'ok' | 'error' | 'info'; text: string; at: number }

export function InstrumentDeck({ quest, selection, variant = 'full' }: { quest: Quest; selection: Selection | null; variant?: 'full' | 'embedded' }) {
  const { state, actor, now, dispatch } = quest;
  const context = useMemo(() => resolveContext(state, actor, selection, now), [state, actor, selection, now]);
  const [prefs, setPrefsState] = useState<DeckPrefs>(() => loadPrefs(context.key));
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [rockerReset, setRockerReset] = useState(0);
  const keyRef = useRef(context.key);

  useEffect(() => {
    if (keyRef.current === context.key) return;
    keyRef.current = context.key;
    setPrefsState(loadPrefs(context.key));
    setPending(null);
    setFeedback(null);
  }, [context.key]);
  useEffect(() => { setPending(null); }, [actor]);

  const setPrefs = useCallback((change: Partial<DeckPrefs>) => {
    setPrefsState(current => { const next = { ...current, ...change }; savePrefs(context.key, next); return next; });
  }, [context.key]);

  // Personal interval ends on its own; nothing else changes when it does.
  useEffect(() => {
    if (prefs.focus.on && prefs.focus.startedAt && now >= prefs.focus.startedAt + prefs.durationMin * 60_000) {
      setPrefs({ focus: { on: false, startedAt: null } });
      setFeedback({ tone: 'info', text: `Your ${prefs.durationMin}-minute interval finished.`, at: now });
    }
  }, [now, prefs, setPrefs]);

  const spec = useMemo(() => composeDeck(context, prefs, quest.backend.authority), [context, prefs, quest.backend.authority]);

  async function confirm(values: Values) {
    if (!pending) return false;
    const action = actionFor(pending.offer, values, actor);
    if (!action) return false;
    const result = await dispatch(action);
    if (result.ok) {
      setFeedback({ tone: 'ok', text: `Done — Task-HQ recorded it: ${result.message}`, at: Date.now() });
      setTimeout(() => setPending(null), 700); // let the latch show what happened
      return true;
    }
    setFeedback({ tone: 'error', text: `Not applied: ${result.error}`, at: Date.now() });
    setRockerReset(value => value + 1); // controls return to authoritative values
    return false;
  }

  function handleIntent(intent: Intent) {
    if (intent.kind === 'setting') { setPrefs(intent.change); setFeedback({ tone: 'info', text: intent.summary, at: Date.now() }); }
    if (intent.kind === 'action') { setPending({ offer: intent.offer, preview: intent.preview, source: 'intent' }); setFeedback(null); }
  }

  const render = (item: InstrumentSpec, index: number) => {
    const common = { style: { ['--i' as string]: index } };
    const def = INSTRUMENTS[item.instrument];
    const shell = (body: ReactNode, wide = false) => (
      <section key={`${item.id}-${spec.signature}`} {...common} className={`instrument i-${item.instrument} ${wide ? 'is-wide' : ''}`} aria-label={`${def.title}. ${def.a11y}`} data-state={item.state}>
        <header><span>{def.title}</span><small>{item.state.replace('-', ' ')}</small></header>
        {body}
      </section>
    );
    const map: Record<InstrumentId, () => ReactNode> = {
      'priority-dial': () => shell(<PriorityDial value={String(item.value)} locked={item.state === 'locked'} context={context}
        onChange={level => { setPrefs({ priority: level }); setFeedback({ tone: 'info', text: `Deck priority P${level}.${context.kind === 'lead' ? ' The lead itself has no priority field.' : ''}`, at: Date.now() }); }}
        onApply={target => {
          const result = check(state, actor, now, 'task.priority', context.subject, { label: `Set task priority to ${target === 'high' ? 'High' : 'Normal'}`, preset: { priority: target } });
          if (result.ok) setPending({ offer: result.offer, preview: `Apply deck ${String(item.value)} to the task: priority becomes ${target === 'high' ? 'High' : 'Normal'} (P1–P2 → High, P3–P5 → Normal).`, source: 'dial' });
          else setFeedback({ tone: 'error', text: `Task-HQ won’t allow that: ${result.error}`, at: Date.now() });
        }} />),
      'duration-fader': () => shell(<DurationFader value={Number(item.value)} running={item.state === 'running'} prefs={prefs} now={now} context={context} state={state}
        onChange={minutes => setPrefs({ durationMin: minutes })}
        onToggle={() => setPrefs({ focus: prefs.focus.on ? { on: false, startedAt: null } : { on: true, startedAt: Date.now() } })} />),
      'action-rocker': () => shell(<ActionRocker key={`${spec.signature}-${rockerReset}`} context={context} onCommit={offer => setPending({ offer, preview: previewFor(offer, context, quest), source: 'rocker' })} />, true),
      'status-display': () => shell(<StatusDisplay quest={quest} context={context} />),
      'context-timeline': () => shell(<ContextTimeline context={context} />, true),
      'response-meter': () => shell(<ResponseMeter context={context} />),
      'dependency-map': () => shell(<DependencyMap quest={quest} context={context} />, true),
      'access-panel': () => shell(<AccessPanel quest={quest} context={context} onRequest={(offer, values) => setPending({ offer: { ...offer, preset: { ...offer.preset, ...values }, inputs: [] }, preview: `Ask ${nameOf(state, context.focus?.activatedBy ?? '')} for ${SECTION_LABELS[(values.section ?? 'company-work') as Section]} for ${duration((context.focus?.grantSeconds ?? 60) * 1000)}: “${values.note}”. You stay on the critical task until it’s approved.`, source: 'access' })} />),
    };
    return map[item.instrument]();
  };

  return (
    <div className={`deck v-${variant} c-${context.kind} u-${context.urgency.level}`}>
      <header className="deck-head">
        <div>
          <span className="deck-mode">{context.kind === 'none' ? 'Instrument deck' : `${{ lead: 'Lead', dependency: 'Dependency handoff', focus: 'Only Priority', task: 'Task', none: '' }[context.kind]} mode`}</span>
          <h2>{context.title}</h2>
          {context.subtitle && <p>{context.subtitle}</p>}
        </div>
        <div className="deck-flags">
          {context.urgency.reasons.map(reason => <span key={reason} className="deck-flag"><span className={`beh-dot tone-${context.kind === 'focus' && /only priority/i.test(reason) ? 'stop' : 'assist'}`} aria-hidden="true" />{reason}</span>)}
          <SoundToggle />
          <span className="deck-flag is-local" title={quest.backend.detail}>{quest.backend.authority === 'local-demo' ? 'Local demo · this device' : 'Server verified'}</span>
        </div>
      </header>

      <IntentStrip quest={quest} context={context} prefs={prefs} onIntent={handleIntent} />

      {pending && <PreviewCard quest={quest} pending={pending} onConfirm={confirm} onCancel={() => { setPending(null); setRockerReset(value => value + 1); }} />}
      {feedback && <p className={`deck-feedback f-${feedback.tone}`} role="status" key={feedback.at}>{feedback.text}</p>}

      {context.kind === 'none'
        ? <p className="deck-empty">{context.subtitle}</p>
        : <div className="deck-grid" key={spec.signature}>{spec.instruments.map(render)}</div>}
    </div>
  );
}

function previewFor(offer: ActionOffer, context: DeckContext, quest: Quest) {
  const who = nameOf(quest.state, quest.actor);
  if (offer.capability === 'lead.attempt') return `Record a contact attempt on ${context.title} by ${who}. This only logs what you did — Task-HQ will not call, text or email anyone.`;
  if (offer.capability === 'lead.follow-up') return `Create a follow-up task for ${context.title}. Pick the date before confirming.`;
  if (offer.capability === 'lead.take') return `Make ${who} the owner of ${context.title}.`;
  if (offer.capability === 'lead.advance') { const preset = presetFor(quest.state); return `${preset.leadHandoffAction}: ${context.title}. An ${preset.leadHandoffNoun} goes to the next owner.`; }
  return `${offer.label}: ${context.title}.`;
}

// ── Intent strip ───────────────────────────────────────────────────────────

function IntentStrip({ quest, context, prefs, onIntent }: { quest: Quest; context: DeckContext; prefs: DeckPrefs; onIntent: (intent: Intent) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Intent | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    const intent = parseIntent(text, context, quest.state, quest.now, prefs);
    setResult(intent);
    onIntent(intent);
    if (intent.kind !== 'unsupported') setText('');
  }
  return (
    <form className="intent" onSubmit={submit}>
      <label htmlFor="intent-input">What do you want to move forward?</label>
      <div className="intent-row">
        <ReferenceInput id="intent-input" value={text} onChange={event => setText(event.target.value)} placeholder={context.kind === 'lead' ? '“Who owns this lead?” · “Set 15 minutes” · “Record a contact attempt”' : '“What should happen next?” · “Start this task” · “Show what this unlocks”'} autoComplete="off" maxLength={120} />
        <button className="btn btn-dark" disabled={!text.trim()}>Go</button>
      </div>
      {result?.kind === 'query' && <p className="intent-answer" role="status">{result.answer}</p>}
      {result?.kind === 'unsupported' && (
        <div className="intent-answer is-refused" role="status">
          <p>{result.message}</p>
          <div className="intent-examples">{examplesFor(context.kind).map(example => <button key={example} type="button" className="chip" onClick={() => setText(example)}>{example}</button>)}</div>
        </div>
      )}
    </form>
  );
}

function PreviewCard({ quest, pending, onConfirm, onCancel }: { quest: Quest; pending: Pending; onConfirm: (values: Values) => Promise<boolean>; onCancel: () => void }) {
  const { state, now } = quest;
  const [values, setValues] = useState<Values>(() => Object.fromEntries(pending.offer.inputs.map(input => [input.name, pending.offer.preset[input.name] ?? (input.kind === 'date' ? addDays(now, 1) : input.kind === 'choice' ? input.options?.[0]?.value ?? '' : '')])));
  const ready = pending.offer.inputs.every(input => !input.required || values[input.name]?.trim());
  return (
    <form className="preview" onSubmit={event => event.preventDefault()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
      <span className="kicker">PREVIEW — NOTHING HAS CHANGED YET</span>
      <strong>{pending.offer.label}</strong>
      <p>{pending.preview}</p>
      {pending.offer.inputs.length > 0 && (
        <div className="preview-inputs">
          {pending.offer.inputs.map((input, index) => (
            <label key={input.name} className="field"><span>{input.label}</span>
              {input.kind === 'choice' && <Select autoFocus={index === 0} value={values[input.name] ?? ''} onChange={event => setValues({ ...values, [input.name]: event.target.value })}>{input.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}
              {input.kind === 'text' && <input autoFocus={index === 0} value={values[input.name] ?? ''} placeholder={input.placeholder} maxLength={300} onChange={event => setValues({ ...values, [input.name]: event.target.value })} />}
              {input.kind === 'date' && <input type="date" value={values[input.name] ?? ''} onChange={event => setValues({ ...values, [input.name]: event.target.value })} />}
              {input.kind === 'person' && <PersonSelect state={state} label={input.label} value={values[input.name] ?? ''} emptyLabel={input.required ? 'Choose…' : 'The team'} onChange={id => setValues({ ...values, [input.name]: id })} />}
            </label>
          ))}
        </div>
      )}
      <div className="preview-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <Latch size="md" label={`Confirm: ${pending.offer.label}`} tone={toneForAction(pending.offer.label, pending.offer.capability)} disabled={!ready} disabledLabel="Fill in the required details" successLabel="Recorded" onCommit={() => onConfirm(values)} />
      </div>
    </form>
  );
}

// ── Instruments ────────────────────────────────────────────────────────────

const ANGLES = [135, 67.5, 0, -67.5, -135]; // P1 … P5

function PriorityDial({ value, locked, context, onChange, onApply }: { value: string; locked: boolean; context: DeckContext; onChange: (level: number) => void; onApply: (target: 'high' | 'normal') => void }) {
  const level = Number(value.slice(1));
  const ref = useRef<HTMLDivElement>(null);
  const set = (next: number) => { if (!locked && next >= 1 && next <= 5 && next !== level) onChange(next); };
  function onKey(event: KeyboardEvent) {
    const map: Record<string, number> = { ArrowUp: level - 1, ArrowRight: level - 1, ArrowDown: level + 1, ArrowLeft: level + 1, Home: 1, End: 5 };
    if (event.key in map) { event.preventDefault(); set(map[event.key]!); }
  }
  function fromPointer(event: PointerEvent) {
    const box = ref.current?.getBoundingClientRect();
    if (!box || locked) return;
    const angle = (Math.atan2(event.clientX - (box.left + box.width / 2), -(event.clientY - (box.top + box.height / 2))) * 180) / Math.PI;
    const nearest = ANGLES.reduce((best, a, index) => (Math.abs(a - angle) < Math.abs(ANGLES[best]! - angle) ? index : best), 0);
    set(nearest + 1);
  }
  const mapped = taskPriorityFor(level);
  return (
    <div className="dial-wrap">
      <div ref={ref} className={`dial ${locked ? 'is-locked' : ''}`} role="slider" tabIndex={locked ? -1 : 0} aria-label="Deck priority" aria-valuemin={1} aria-valuemax={5} aria-valuenow={level} aria-valuetext={`${value}${locked ? ', locked by Only Priority' : ''}`} aria-disabled={locked}
        onKeyDown={onKey} onPointerDown={event => { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); fromPointer(event); }} onPointerMove={event => { if (event.buttons) fromPointer(event); }}>
        {ANGLES.map((angle, index) => <i key={angle} className={`detent ${index + 1 === level ? 'is-on' : ''}`} style={{ transform: `rotate(${angle}deg) translateY(-64px)` }}><b style={{ transform: `rotate(${-angle}deg)` }}>P{index + 1}</b></i>)}
        <span className="knob" style={{ transform: `rotate(${ANGLES[level - 1]}deg)` }}><span className="pointer" /></span>
        <span className="dial-value">{value}</span>
      </div>
      <p className="instrument-note">{locked ? 'Locked at P1 while Only Priority is active.' : context.kind === 'lead' ? 'Deck designation only — leads have no priority field.' : context.businessPriority ? <>Task priority: <b>{context.businessPriority === 'high' ? 'High' : 'Normal'}</b>{mapped !== context.businessPriority && <> · <button type="button" className="link" onClick={() => onApply(mapped)}>Apply {value} → {mapped === 'high' ? 'High' : 'Normal'}</button></>}</> : null}</p>
    </div>
  );
}

function DurationFader({ value, running, prefs, now, context, state, onChange, onToggle }: { value: number; running: boolean; prefs: DeckPrefs; now: number; context: DeckContext; state: Quest['state']; onChange: (minutes: number) => void; onToggle: () => void }) {
  const pct = ((value - DURATION_RANGE.min) / (DURATION_RANGE.max - DURATION_RANGE.min)) * 100;
  const remaining = running && prefs.focus.startedAt ? prefs.focus.startedAt + value * 60_000 - now : 0;
  const steps = (DURATION_RANGE.max - DURATION_RANGE.min) / DURATION_RANGE.step;
  return (
    <div className="fader-wrap">
      <div className="fader">
        <div className="fader-track">{Array.from({ length: steps + 1 }, (_, index) => <i key={index} style={{ left: `${(index / steps) * 100}%` }} />)}<span className="fader-fill" style={{ width: `${pct}%` }} /><span className="fader-thumb" style={{ left: `${pct}%` }} /></div>
        <input type="range" min={DURATION_RANGE.min} max={DURATION_RANGE.max} step={DURATION_RANGE.step} value={value} disabled={running} aria-label="Work interval in minutes" aria-valuetext={`${value} minutes`} onChange={event => onChange(Number(event.target.value))} />
      </div>
      <div className="fader-read"><b>{running ? duration(Math.max(0, remaining)) : `${value} min`}</b><small>{running ? 'left in your interval' : 'selected interval'}</small>
        <Switch checked={running} onChange={onToggle} label="Focus interval" tone="progress" />
      </div>
      <p className="instrument-note">Personal interval — {context.kind === 'lead' ? `the ${state.policy.leadResponseMinutes}-minute response target is unchanged.` : 'due dates are unchanged.'} Nothing is locked.</p>
    </div>
  );
}

function ActionRocker({ context, onCommit }: { context: DeckContext; onCommit: (offer: ActionOffer) => void }) {
  const [index, setIndex] = useState(0);
  const actions = context.actions;
  if (!actions.length) return <p className="instrument-note">No action for you here — {context.nextStep || 'nothing is waiting on you.'}</p>;
  const current = actions[Math.min(index, actions.length - 1)]!;
  return (
    <div className="rocker-wrap">
      <div className="rocker" role="radiogroup" aria-label="Authorized next actions" style={{ ['--n' as string]: actions.length, ['--pos' as string]: Math.min(index, actions.length - 1) }}>
        <span className="rocker-paddle" aria-hidden="true" />
        {actions.map((item, position) => (
          <button key={item.key} type="button" role="radio" aria-checked={position === index} className={position === index ? 'is-on' : ''}
            onClick={() => setIndex(position)} onKeyDown={event => { if (event.key === 'ArrowRight') setIndex((index + 1) % actions.length); if (event.key === 'ArrowLeft') setIndex((index - 1 + actions.length) % actions.length); }}>
            {item.label}
          </button>
        ))}
      </div>
      <button type="button" className="rocker-commit" onClick={() => onCommit(current)}><span className={`beh-dot tone-${toneForAction(current.label, current.capability)}`} aria-hidden="true" />Review “{current.label}” <span aria-hidden="true">→</span></button>
      <p className="instrument-note">Only actions Task-HQ accepts for you right now. You’ll see a preview before anything changes.</p>
    </div>
  );
}

function stateTone(context: DeckContext): BehaviorTone {
  if (context.kind === 'focus') return 'stop';
  if (context.urgency.level === 'critical') return 'assist';
  if (/responded|handed|done/i.test(context.stateLabel)) return 'complete';
  return 'progress';
}

function SoundToggle() {
  const [on, setOn] = useSoundPreference();
  return <span className="deck-sound"><Switch checked={on} onChange={setOn} label="Sound" tone="neutral" /></span>;
}

function StatusDisplay({ quest, context }: { quest: Quest; context: DeckContext }) {
  const { state } = quest;
  return (
    <dl className="status-grid">
      <dt>{context.ownerLabel}</dt><dd><Avatar state={state} id={context.owner} size="sm" /> {context.owner ? nameOf(state, context.owner) : 'Nobody yet'}</dd>
      <dt>State</dt><dd><span className={`beh-dot tone-${stateTone(context)}`} aria-hidden="true" />{context.stateLabel}</dd>
      {context.elapsedMs !== undefined && <><dt>{context.stateLabel.startsWith('Responded') || context.stateLabel.startsWith('Handed') ? 'First response' : 'Since arrival'}</dt><dd className={context.elapsedMs > (context.targetMs ?? Infinity) ? 'text-danger' : ''}>{duration(context.elapsedMs)}</dd></>}
      {context.focus && <><dt>In focus for</dt><dd>{duration(quest.now - context.focus.since)} · by {firstName(state, context.focus.activatedBy)}</dd></>}
      <dt>Verified next step</dt><dd>{context.actions[0]?.label ?? context.nextStep}</dd>
      <dt>Data</dt><dd>{quest.backend.authority === 'local-demo' ? 'Local demo · this device only' : 'Shared backend (server verified)'}</dd>
    </dl>
  );
}

function ResponseMeter({ context }: { context: DeckContext }) {
  const elapsed = context.elapsedMs ?? 0;
  const target = context.targetMs ?? 1;
  const over = elapsed > target;
  return (
    <div className={`meter ${over ? 'is-over' : ''}`} role="timer" aria-label={`${duration(elapsed)} since arrival, target ${duration(target)}`}>
      <b>{duration(elapsed)}</b><small>{over ? `over the ${duration(target)} target` : `of ${duration(target)} target`}</small>
      <div className="meter-bar"><span style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} /></div>
    </div>
  );
}

function DependencyMap({ quest, context }: { quest: Quest; context: DeckContext }) {
  const { state } = quest;
  const node = (title: string, owner: string, status: string, tone: string) => (
    <div className={`dep-node t-${tone}`}><small>{status}</small><strong>{title}</strong><span><Avatar state={state} id={owner} size="sm" /> {firstName(state, owner)}</span></div>
  );
  return (
    <div className="dep-map">
      <div className="dep-col">{context.relations.waitsOn.length ? context.relations.waitsOn.map(item => <div key={item.taskId}>{node(item.title, item.owner, item.status === 'done' ? 'Done' : 'Blocking', item.status === 'done' ? 'done' : 'blocking')}</div>) : <p className="instrument-note">Waits on nothing</p>}</div>
      <span className="dep-arrow" aria-hidden="true">→</span>
      <div className="dep-col">{node(context.title, context.owner, 'This task', 'current')}</div>
      <span className="dep-arrow" aria-hidden="true">→</span>
      <div className="dep-col">{context.relations.unlocks.length ? context.relations.unlocks.map(item => <div key={item.taskId}>{node(item.title, item.owner, item.status === 'done' ? 'Done' : 'Unlocks', item.status === 'done' ? 'done' : 'next')}</div>) : <p className="instrument-note">Unlocks nothing</p>}</div>
    </div>
  );
}

function AccessPanel({ quest, context, onRequest }: { quest: Quest; context: DeckContext; onRequest: (offer: ActionOffer, values: Values) => void }) {
  const f = context.focus;
  const [section, setSection] = useState<Section>('company-work');
  const [note, setNote] = useState('');
  if (!f) return null;
  if (f.active) return <p className="instrument-note"><b>{SECTION_LABELS[f.active.section]}</b> is open for {duration((f.active.expiresAt ?? quest.now) - quest.now)}.</p>;
  if (f.pending) return <p className="instrument-note">Waiting for {nameOf(quest.state, f.activatedBy)} to decide on <b>{SECTION_LABELS[f.pending.section]}</b>.</p>;
  if (!f.request) return <p className="instrument-note">No access requests are allowed right now.</p>;
  return (
    <form className="access-mini" onSubmit={event => { event.preventDefault(); if (note.trim()) onRequest(f.request!, { section, note }); }}>
      <Select value={section} onChange={event => setSection(event.target.value as Section)} aria-label="Access to">{(Object.keys(SECTION_LABELS) as Section[]).map(id => <option key={id} value={id}>{SECTION_LABELS[id]}</option>)}</Select>
      <ReferenceInput value={note} onChange={event => setNote(event.target.value)} placeholder="Why you need it" maxLength={200} aria-label="Reason" />
      <button className="btn btn-ghost btn-sm" disabled={!note.trim()}>Preview request</button>
      <p className="instrument-note">Duration comes from the policy ({duration(f.grantSeconds * 1000)}); only an approver decides.</p>
    </form>
  );
}

function ContextTimeline({ context }: { context: DeckContext }) {
  return (
    <ol className="timeline-mini">
      {context.actions.slice(0, 3).map(item => <li key={item.key} className="is-upcoming"><time>Possible</time><p>{item.label} <em>(not done yet)</em></p></li>)}
      {context.events.map(event => <li key={event.id} className={event.undone ? 'is-undone' : ''}><time>{clock(event.at)}</time><p>{event.text}</p></li>)}
      {!context.events.length && <li><p className="instrument-note">No recorded events yet.</p></li>}
    </ol>
  );
}
