import { Select } from '../ui/Select.tsx';
import { ReferenceInput, ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { NewTask, QuestState } from '../core/contract.ts';
import { apply } from '../core/engine.ts';
import { parseCommand } from '../core/command.ts';
import { nameOf, projectName } from '../core/selectors.ts';
import { ResponsibilityCard } from '../ui/ResponsibilityCard.tsx';
import { localDate } from '../core/time.ts';
import { hasRole } from '../core/selectors.ts';
import { canAssignOthers } from '../core/permissions.ts';
import { PersonSelect } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { Draft } from '../core/command.ts';
import { Composer } from './Composer.tsx';

export function CreateTask({ quest, due, onClose, onCreated }: { quest: Quest; due?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { state, actor, now, dispatch } = quest;
  // Managers delegate: creating work doesn't make them its owner by default.
  const delegates = hasRole(state, actor, ['manager']);
  // Live members create work for themselves or leave it unassigned; assigning others needs a supervisor, admin or owner.
  const assigns = canAssignOthers(state, actor);
  const owners = assigns ? state : { ...state, people: state.people.filter(item => item.id === actor) };
  const [draft, setDraft] = useState<NewTask>({ title: '', owner: delegates ? '' : actor, due: due ?? localDate(now), priority: 'normal', nextAction: '', approver: '', nextOwner: '', projectId: '', dependsOn: [] });
  const set = (changes: Partial<NewTask>) => setDraft(current => ({ ...current, ...changes }));
  const taxonomyOk = quest.backend.supports?.taskTaxonomy !== false;
  const types = state.taxonomy?.types ?? [];
  // Proposed people from the one-line description are suggestions until chosen.
  const [proposed, setProposed] = useState<{ owner?: { id: string; name: string }; approver?: { id: string; name: string } }>({});
  function fill(parsed: Draft) {
    const member = (p: Draft['owner']) => (p && p.ref.kind === 'member' ? { id: p.ref.id, name: p.ref.name } : undefined);
    set({ title: parsed.title, priority: parsed.priority, ...(parsed.due ? { due: parsed.due } : {}),
      ...(taxonomyOk ? { type: parsed.type || undefined, tags: parsed.tags.map(item => item.tag), dueTime: parsed.dueTime || undefined } : {}),
      watchers: [] });
    setProposed({ owner: member(parsed.owner), approver: member(parsed.approver) });
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
      const result = await dispatch({ type: 'task/create', task: { ...draft, watchers } });
      if (result.ok) onCreated(result.state.tasks[0]!.id);
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
    recognition.onresult = event => { const text = event.results[0]?.[0]?.transcript?.trim(); if (text) fill(parseCommand(text, state, now, [], { single: true })[0]!); };
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
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal create-wide" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="modal-head"><div><span className="kicker">NEW TASK</span><h2 id="create-title">Create a task</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="cx">
          <div className="cx-form">
            <section className="cx-card cx-hero" aria-label="Describe the task">
              <div className="cx-hero-row">
                <div className="cx-hero-input create-composer"><Composer quest={quest} variant="form" onFill={fill} /></div>
                {Recognition && <button type="button" className={`cx-mic ${listening ? 'is-on' : ''}`} aria-label={listening ? 'Listening…' : 'Dictate the task'} aria-pressed={listening} onClick={listen}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11v1a6 6 0 0 0 12 0v-1M12 18v3" /></svg>
                </button>}
              </div>
            </section>

            <form id="create-task-form" className="cx-fields" onSubmit={submit}>
              <label className="field cx-title"><span>What needs to get done?</span><ReferenceInput autoFocus required maxLength={160} value={draft.title} onChange={event => set({ title: event.target.value })} placeholder="e.g. Confirm the dumpster drop-off for Maple Ave" /></label>

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

              <footer className="form-actions"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !ready} aria-busy={busy}>{busy ? 'Creating…' : 'Create task →'}</button></footer>
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
