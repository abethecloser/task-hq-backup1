import { Select } from '../ui/Select.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { NewTask, QuestState } from '../core/contract.ts';
import { apply } from '../core/engine.ts';
import { nameOf, projectName } from '../core/selectors.ts';
import { ResponsibilityCard } from '../ui/ResponsibilityCard.tsx';
import { localDate } from '../core/time.ts';
import { hasRole } from '../core/selectors.ts';
import { canAssignOthers } from '../core/permissions.ts';
import { PersonSelect } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { Draft } from '../core/command.ts';
import { Composer } from './Composer.tsx';
import { MAX_ITEMS, MAX_ITEM_LENGTH, joinChecklist } from '../core/checklist.ts';

// An unfinished task survives a reload in this tab (sessionStorage), exactly as left,
// including a cleared due date. Closing or creating discards it.
interface SavedDraft { draft: NewTask; entryText: string; manual: (keyof NewTask)[]; steps?: string[] }
const draftKey = (tenant: string, actor: string) => `quest.createDraft.${tenant}.${actor}`;
const FULL_KEY = 'quest.createFull';
function readDraft(key: string): SavedDraft | null {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as SavedDraft : null; } catch { return null; }
}
function forgetDraft(key: string) { try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ } }
/** True when a create dialog was open with a draft before the page reloaded. */
export function hasCreateDraft(tenant: string, actor: string) { return !!readDraft(draftKey(tenant, actor)); }
export function discardCreateDraft(tenant: string, actor: string) { forgetDraft(draftKey(tenant, actor)); }

export function CreateTask({ quest, due, projectId, onClose, onCreated, inline = false }: {
  quest: Quest; due?: string; projectId?: string; onClose: () => void; onCreated: (id: string) => void;
  /** Render as the center workspace (creating state of the task workspace) instead of a dialog. */
  inline?: boolean;
}) {
  const { state, actor, now, dispatch } = quest;
  // Managers delegate: creating work doesn't make them its owner by default.
  const delegates = hasRole(state, actor, ['manager']);
  // Live members create work for themselves or leave it unassigned; assigning others needs a supervisor, admin or owner.
  const assigns = canAssignOthers(state, actor);
  const owners = assigns ? state : { ...state, people: state.people.filter(item => item.id === actor) };
  const storageKey = draftKey(state.workspace.tenantId, actor);
  const [saved] = useState(() => readDraft(storageKey));
  const [draft, setDraft] = useState<NewTask>(() => saved ? { ...saved.draft, ...(due ? { due } : {}), ...(projectId ? { projectId } : {}) }
    : { title: '', owner: delegates ? '' : actor, due: due ?? localDate(now), priority: 'normal', nextAction: '', approver: '', nextOwner: '', projectId: projectId ?? '', dependsOn: [] });
  const manual = useRef(new Set<keyof NewTask>(saved?.manual ?? []));
  const set = (changes: Partial<NewTask>) => {
    for (const key of Object.keys(changes) as (keyof NewTask)[]) manual.current.add(key);
    setDraft(current => ({ ...current, ...changes }));
  };
  const [entryText, setEntryText] = useState(saved?.entryText ?? '');
  // Checklist steps, saved into the description the same way the task page stores them (core/checklist.ts).
  const [steps, setSteps] = useState<string[]>(saved?.steps ?? []);
  const [step, setStep] = useState('');
  const addStep = () => { const text = step.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH); if (text && steps.length < MAX_ITEMS) { setSteps(current => [...current, text]); setStep(''); } };
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, entryText, manual: [...manual.current], steps } satisfies SavedDraft)); } catch { /* storage unavailable */ }
  }, [storageKey, draft, entryText, steps]);
  const close = () => { forgetDraft(storageKey); onClose(); };
  // Full-page view is a per-device preference.
  const [full, setFull] = useState(() => { try { return localStorage.getItem(FULL_KEY) === '1'; } catch { return false; } });
  const toggleFull = () => setFull(value => { try { localStorage.setItem(FULL_KEY, value ? '0' : '1'); } catch { /* storage unavailable */ } return !value; });
  const taxonomyOk = quest.backend.supports?.taskTaxonomy !== false;
  const types = state.taxonomy?.types ?? [];
  // Live inference updates untouched fields only. A manual choice (including
  // Unassigned) remains authoritative when primary text changes or is removed.
  const [proposed, setProposed] = useState<{ owner?: { id: string; name: string }; approver?: { id: string; name: string } }>({});
  function fill(parsed: Draft | undefined) {
    const member = (p: Draft['owner']) => (p && p.ref.kind === 'member' ? { id: p.ref.id, name: p.ref.name } : undefined);
    const inferred = parsed?.owner?.confirmed ? member(parsed.owner) : undefined;
    const changes: Partial<NewTask> = {
      title: parsed?.title ?? '', priority: parsed?.priority ?? 'normal',
      due: parsed?.due || due || localDate(now), owner: inferred?.id ?? (delegates ? '' : actor),
      ...(taxonomyOk ? { type: parsed?.type || undefined, tags: parsed?.tags.map(item => item.tag) ?? [], dueTime: parsed?.dueTime || undefined } : {}),
    };
    setDraft(current => {
      const untouched = Object.fromEntries(Object.entries(changes).filter(([key]) => !manual.current.has(key as keyof NewTask)));
      return { ...current, ...untouched };
    });
    setProposed({ owner: parsed?.owner && !parsed.owner.confirmed ? member(parsed.owner) : undefined, approver: parsed ? member(parsed.approver) : undefined });
  }

  // Assigning work to someone else keeps you posted by default: you watch it.
  const [watch, setWatch] = useState(true);
  const delegated = !!draft.owner && draft.owner !== actor;
  // One create per submit: a double tap or Enter while saving must not make a second task.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      const watchers = [...new Set([...(draft.watchers ?? []), ...(delegated && watch ? [actor] : [])])];
      const description = joinChecklist(draft.description ?? '', steps.map(text => ({ text, done: false })));
      const result = await dispatch({ type: 'task/create', task: { ...draft, watchers, ...(description ? { description } : {}) } });
      if (result.ok) { forgetDraft(storageKey); onCreated(result.state.tasks[0]!.id); }
    } finally { saving.current = false; setBusy(false); }
  }

  // The same engine the server runs, asked as this person, so the preview never promises what Create would refuse.
  const watchers = useMemo(() => [...new Set([...(draft.watchers ?? []), ...(delegated && watch ? [actor] : [])])], [draft.watchers, delegated, watch, actor]);
  const dry = useMemo(() => {
    let n = 0;
    return apply(state as QuestState, { type: 'task/create', task: { ...draft, title: draft.title.trim() || 'Untitled task', watchers } }, { actor, now, newId: () => `preview-${++n}` });
  }, [state, draft, watchers, actor, now]);
  const refusal = dry.ok ? '' : dry.error;
  const [previewOpen, setPreviewOpen] = useState(false);

  // Voice entry only where the browser provides it; the transcript fills the form like typed text.
  const Recognition = (globalThis as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
    ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  const [listening, setListening] = useState(false);
  function listen() {
    if (!Recognition || listening) return;
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.onresult = event => { const text = event.results[0]?.[0]?.transcript?.trim(); if (text) setEntryText(text); };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true); recognition.start();
  }

  const checks: { label: string; ok: boolean; note?: string }[] = [
    { label: 'Title', ok: !!draft.title.trim() },
    { label: 'Assigned', ok: !!draft.owner, note: draft.owner ? undefined : 'Optional — nobody will act until someone is assigned' },
    { label: 'Due date', ok: !!draft.due, note: draft.due ? undefined : 'Optional' },
    { label: 'Allowed for you', ok: !refusal, note: refusal || undefined },
  ];
  const ready = !!draft.title.trim() && !refusal;
  const owner = draft.owner ?? '';
  const dueText = draft.due ? `${new Date(`${draft.due}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${draft.dueTime ? ` · ${draft.dueTime}` : ''}` : 'No due date';

  return (
    <>
      {!full && !inline && <button className="scrim scrim-modal" aria-label="Close" onClick={close} />}
      <section className={inline ? 'view create-workspace' : `modal create-wide ${full ? 'is-full' : ''}`} role={inline ? 'region' : 'dialog'} aria-modal={inline ? undefined : true} aria-labelledby="create-title">
        <header className="modal-head"><div><span className="kicker">NEW TASK</span><h2 id="create-title">Create a task</h2></div>
          <div className="modal-head-actions">
            {!inline && <button type="button" className="icon-btn" aria-pressed={full} aria-label={full ? 'Exit full page' : 'Expand to full page'} title={full ? 'Exit full page' : 'Expand to full page'} onClick={toggleFull}>
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
            </button>}
            <button type="button" className="icon-btn" aria-label="Close" onClick={close}>×</button>
          </div>
        </header>
        <div className="cx">
          <div className="cx-form">
            <section className="cx-card cx-hero" aria-label="Describe it for me (optional)">
              <p className="muted">Describe it for me (optional) · Fill task details from plain words.</p>
              <div className="cx-hero-row">
                <div className="cx-hero-input create-composer"><Composer quest={quest} variant="form" value={entryText} onTextChange={setEntryText} onFill={fill} /></div>
                {Recognition && <button type="button" className={`cx-mic ${listening ? 'is-on' : ''}`} aria-label={listening ? 'Listening…' : 'Dictate the task'} aria-pressed={listening} onClick={listen}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11v1a6 6 0 0 0 12 0v-1M12 18v3" /></svg>
                </button>}
              </div>
            </section>

            <form id="create-task-form" className="cx-fields" onSubmit={submit}>
              <label className="field cx-title"><span>Task title</span><ReferenceInput autoFocus required maxLength={160} value={draft.title} onChange={event => set({ title: event.target.value })} placeholder="e.g. Confirm the dumpster drop-off for Maple Ave" /></label>

              <section className="cx-card" aria-labelledby="cx-routing">
                <h3 id="cx-routing" className="cx-sec"><i>01</i> Routing</h3>
                <div className="cx-grid">
                  <label className="field"><span>Assigned to</span><PersonSelect state={owners} label="Assigned to" value={owner} emptyLabel={delegates ? 'Choose later (unassigned)' : 'Unassigned'} onChange={next => set({ owner: next })} />
                    {assigns && proposed.owner && owner !== proposed.owner.id && <button type="button" className="proposal-chip" onClick={() => set({ owner: proposed.owner!.id })}>Proposed: {proposed.owner.name} · <b>Use</b></button>}</label>
                  <div className="field"><span id="cx-priority">Priority</span>
                    <span className="cx-seg" role="group" aria-labelledby="cx-priority">
                      {(['normal', 'high'] as const).map(value => <button key={value} type="button" className={draft.priority === value ? 'is-on' : ''} aria-pressed={draft.priority === value} onClick={() => set({ priority: value })}>{value === 'normal' ? 'Normal' : 'High'}</button>)}
                    </span></div>
                  <label className="field"><span>Project</span><Select value={draft.projectId ?? ''} onChange={event => set({ projectId: event.target.value })}><option value="">No project</option>{state.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
                  {taxonomyOk && types.length > 0 && <label className="field"><span>Type</span><Select value={draft.type ?? ''} onChange={event => set({ type: event.target.value || undefined })}><option value="">No type</option>{types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
                  <div className="field"><span>Status</span><span className="cx-static">Ready · starts the lifecycle</span></div>
                </div>
              </section>

              <section className="cx-card" aria-labelledby="cx-schedule">
                <h3 id="cx-schedule" className="cx-sec"><i>02</i> Schedule</h3>
                <div className="cx-grid">
                  <label className="field"><span>Due date</span><input type="date" value={draft.due ?? ''} onChange={event => set({ due: event.target.value, ...(event.target.value || !taxonomyOk ? {} : { dueTime: undefined }) })} /></label>
                  {taxonomyOk && <label className="field"><span>Time</span><input type="time" value={draft.dueTime ?? ''} disabled={!draft.due} aria-label="Due time" onChange={event => set({ dueTime: event.target.value || undefined })} /></label>}
                  <div className="field"><span>Reminder</span><span className="cx-static is-off">Not connected yet</span></div>
                </div>
              </section>

              <section className="cx-card" aria-labelledby="cx-detail">
                <h3 id="cx-detail" className="cx-sec"><i>03</i> Detail</h3>
                <label className="field"><span>Next action</span><ReferenceInput maxLength={200} value={draft.nextAction ?? ''} onChange={event => set({ nextAction: event.target.value })} placeholder="The first physical step" /></label>
                <label className="field"><span>Notes</span><ReferenceTextarea rows={3} value={draft.description ?? ''} maxLength={1000} onChange={event => set({ description: event.target.value })} placeholder="Context, @people and #tags" /></label>
                <div className="field cx-checklist"><span>Checklist <small className="field-hint">{steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : 'Optional steps to tick off'}</small></span>
                  {steps.length > 0 && <ol className="cx-steps">{steps.map((text, at) => <li key={`${at}-${text}`}><span>{text}</span><button type="button" className="icon-btn" aria-label={`Remove “${text}”`} onClick={() => setSteps(current => current.filter((_, index) => index !== at))}>×</button></li>)}</ol>}
                  {steps.length < MAX_ITEMS && <span className="cx-step-add"><input value={step} maxLength={MAX_ITEM_LENGTH} placeholder="Add a step" aria-label="Add a checklist step" onChange={event => setStep(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addStep(); } }} /><button type="button" className="btn btn-sm" disabled={!step.trim()} onClick={addStep}>Add</button></span>}
                </div>
                <div className="cx-grid">
                  <label className="field"><span>Next-step owner</span><small className="field-hint">Receives the handoff afterward.</small><PersonSelect state={state} label="Next-step owner" value={draft.nextOwner ?? ''} onChange={nextOwner => set({ nextOwner })} /></label>
                  <label className="field"><span>Approver</span><small className="field-hint">Reviews before it is complete.</small><PersonSelect state={state} label="Approver" value={draft.approver ?? ''} emptyLabel="No approval needed" onChange={approver => set({ approver })} />
                    {proposed.approver && draft.approver !== proposed.approver.id && <button type="button" className="proposal-chip" onClick={() => set({ approver: proposed.approver!.id })}>Proposed: {proposed.approver.name} · <b>Use</b></button>}</label>
                  <label className="field"><span>Decision owner</span><small className="field-hint">Makes the call if one is needed.</small><PersonSelect state={state} label="Decision owner" value={draft.decisionOwner ?? ''} onChange={decisionOwner => set({ decisionOwner })} /></label>
                  <label className="field"><span>Starts after</span><small className="field-hint">Waits for another task.</small>
                    <Select value={draft.dependsOn?.[0] ?? ''} onChange={event => set({ dependsOn: event.target.value ? [event.target.value] : [] })}>
                      <option value="">No dependency</option>
                      {state.tasks.filter(task => task.status !== 'done').map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
                    </Select></label>
                </div>
                {delegated && <label className="check-row watch-check"><input type="checkbox" checked={watch} onChange={event => setWatch(event.target.checked)} />Watch this task: follow its comments and changes</label>}
              </section>

              <footer className="form-actions"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={busy || !ready} aria-busy={busy}>{busy ? 'Creating…' : 'Create task →'}</button></footer>
            </form>
          </div>

          <aside className={`cx-preview ${previewOpen ? 'is-open' : ''}`} aria-label="Task preview">
            <button type="button" className="cx-preview-toggle" aria-expanded={previewOpen} onClick={() => setPreviewOpen(value => !value)}>
              <span>Dispatch preview</span><b>{owner ? `${nameOf(state, owner)} acts first` : 'Unassigned'}</b><i aria-hidden="true">{previewOpen ? '▴' : '▾'}</i>
            </button>
            <div className="cx-preview-body">
              <p className="cx-kicker">TASK PREVIEW</p>
              <h3 className={`cx-preview-title ${draft.title.trim() ? '' : 'is-empty'}`}>{draft.title.trim() || 'Untitled task'}</h3>
              <ResponsibilityCard state={state} actor={actor} task={{ status: 'ready', owner, approver: draft.approver ?? '', nextOwner: draft.nextOwner ?? '', nextAction: draft.nextAction ?? '', blocker: null, dependsOn: draft.dependsOn ?? [] }} />
              <dl className="cx-facts">
                <div><dt>Priority</dt><dd>{draft.priority === 'high' ? 'High' : 'Normal'}</dd></div>
                <div><dt>Due</dt><dd>{dueText}</dd></div>
                <div><dt>Project</dt><dd>{(draft.projectId && projectName(state, draft.projectId)) || '—'}</dd></div>
                {taxonomyOk && draft.type && <div><dt>Type</dt><dd>{types.find(item => item.id === draft.type)?.label ?? draft.type}</dd></div>}
              </dl>
              {steps.length > 0 && <><p className="cx-kicker">CHECKLIST · 0/{steps.length}</p><ul className="cx-preview-steps">{steps.map((text, at) => <li key={`${at}-${text}`}>{text}</li>)}</ul></>}
              <p className="cx-kicker">DISPATCH</p>
              <ul className="cx-dispatch">
                <li className={owner ? 'is-on' : 'is-off'}><b>In their task list</b><small>{owner ? `Appears in ${owner === actor ? 'your' : `${nameOf(state, owner)}’s`} My work. No alert is sent.` : 'Assign someone first.'}</small></li>
                <li className={watchers.length ? 'is-on' : 'is-off'}><b>Watchers</b><small>{watchers.length ? `${watchers.length} follow${watchers.length === 1 ? 's' : ''} its comments and changes.` : 'Nobody is watching yet.'}</small></li>
                <li className="is-unavailable"><b>Email</b><small>Unavailable — not connected</small></li>
                <li className="is-unavailable"><b>WhatsApp</b><small>Unavailable — not connected</small></li>
              </ul>
              <p className="cx-kicker">READY TO CREATE</p>
              <ul className="cx-checks">{checks.map(check => <li key={check.label} className={check.ok ? 'is-ok' : 'is-todo'}><span aria-hidden="true">{check.ok ? '●' : '○'}</span><b>{check.label}</b>{check.note && <small>{check.note}</small>}</li>)}</ul>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

interface SpeechRec { lang: string; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void }
