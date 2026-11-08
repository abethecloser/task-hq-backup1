// Clarify, on the task page: turns an unfinished next-action note into a reviewed, structured one.
//
//   suggest → answer questions / edit → compare before and after → approve
//
// Nothing is written until Approve. The suggestion comes from a ClarifyProvider (rule-based today,
// swappable later) and is checked by core/clarify.ts; saving goes through the same engine actions as
// every other edit, so permissions, history and undo are unchanged. The person's answers and edits
// live here and survive errors, stale wording and closing the panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Task } from '../core/contract.ts';
import { MAX_NEXT_ACTION, clarifyWith, isAmbiguous, plan, refine, revise, ruleGenerator } from '../core/clarify.ts';
import type { Clarification, ClarifyProvider, PlanFailure, QuestionId } from '../core/clarify.ts';
import type { Quest } from '../ui/useQuest.ts';

type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'saving' | 'done';
type Answers = Partial<Record<QuestionId, string>>;

const ruleProvider: ClarifyProvider = (task, state) => ruleGenerator(task, state);
const sameAnswers = (a: Answers, b: Answers) => (['what', 'who', 'detail'] as const).every(key => (a[key] ?? '').trim() === (b[key] ?? '').trim());

const WAITING: Partial<Record<PlanFailure, string>> = {
  'open-questions': 'Answer the questions above and update the suggestion, or write the next action yourself.',
  empty: 'Write the next action first.',
  unchanged: 'This is the same as the current wording.',
};

export function ClarifyPanel({ quest, task, editable, provider = ruleProvider }: { quest: Quest; task: Task; editable: boolean; provider?: ClarifyProvider }) {
  const { state, actor, now, dispatch } = quest;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [base, setBase] = useState<Clarification | null>(null);
  const [typed, setTyped] = useState<Answers>({});
  const [applied, setApplied] = useState<Answers>({});
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState('');
  const commentSaved = useRef(false);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }); }, [open]);

  const generate = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhase('loading'); setError(''); setOpen(true);
    try {
      const made = await clarifyWith(state, task.id, provider, controller.signal);
      if (controller.signal.aborted) return;
      if (!made) { setError('This task is no longer available.'); setPhase(base ? 'ready' : 'error'); return; }
      commentSaved.current = false;
      setBase(made); setPhase('ready');
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error && failure.message ? failure.message : 'Couldn’t draft a suggestion.');
      setPhase(base ? 'ready' : 'error');
    }
  }, [state, task.id, provider, base]);

  const discard = () => {
    request.current?.abort();
    commentSaved.current = false;
    setBase(null); setTyped({}); setApplied({}); setEdit(null); setError(''); setPhase('idle'); setOpen(false);
  };

  const refined = useMemo(() => (base ? refine(base, applied) : null), [base, applied]);
  const current = refined ? (edit !== null ? revise(refined, edit) : refined) : null;
  const verdict = useMemo(() => (current ? plan(state, current, actor, nowRef.current) : null), [state, current, actor]);
  const stale = !!base && phase !== 'saving' && phase !== 'done' && task.nextAction !== base.original;
  const hasDraft = !!base || Object.values(typed).some(Boolean) || edit !== null;

  if (!open && phase !== 'done') {
    if (!editable || (!isAmbiguous(task) && !hasDraft)) return null;
    return (
      <div className="clarify-hint">
        <span>{hasDraft ? 'You have an unsaved clarification for this task.' : 'This reads like an unfinished note rather than a next step.'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (base ? setOpen(true) : void generate())}>{hasDraft ? 'Resume' : 'Clarify'}</button>
      </div>
    );
  }

  const after = (current?.proposal.nextAction ?? '').trim();
  const suggestion = refined?.proposal.nextAction ?? '';
  const answersChanged = !sameAnswers(typed, applied);

  async function approve() {
    if (!current) return;
    const result = plan(state, current, actor, nowRef.current);
    if (!result.ok) { setError(result.error); return; }
    setPhase('saving'); setError('');
    for (const [index, action] of result.actions.entries()) {
      if (index === 0 && commentSaved.current) continue;
      const saved = await dispatch(action);
      if (!saved.ok) {
        setPhase('ready');
        setError(index === 1 ? `${saved.error} The original wording is already saved in the conversation, and your draft is kept here.` : `${saved.error} Your draft is kept here.`);
        return;
      }
      if (index === 0) commentSaved.current = true;
    }
    setPhase('done');
  }

  const close = (event?: KeyboardEvent) => { event?.stopPropagation(); setOpen(false); };

  return (
    <section className="clarify" role="region" aria-labelledby={`clarify-title-${task.id}`} aria-busy={phase === 'loading' || phase === 'saving'}
      onKeyDown={event => { if (event.key === 'Escape' && phase !== 'saving') { event.preventDefault(); close(event); } }}>
      <header className="clarify-head">
        <h3 id={`clarify-title-${task.id}`} ref={heading} tabIndex={-1}>Clarify next action</h3>
        <span className="pill clarify-badge">Nothing is saved until you approve</span>
      </header>

      <div className="clarify-original">
        <small>Original wording{phase === 'done' ? ' · kept in the task conversation' : ' · stays in the task conversation'}</small>
        <q>{base?.original ?? task.nextAction}</q>
      </div>

      {phase === 'loading' && !base && <p className="clarify-note" role="status">Reading the instruction…</p>}

      {phase === 'error' && !base && (
        <div className="clarify-alert" role="alert">
          <p>{error}</p>
          <div className="clarify-actions"><button type="button" className="btn btn-sm" onClick={() => void generate()}>Try again</button><button type="button" className="btn btn-ghost btn-sm" onClick={discard}>Close</button></div>
        </div>
      )}

      {phase === 'done' && (
        <div className="clarify-done" role="status">
          <strong>Next action updated.</strong>
          <p>{after}</p>
          <small>The original wording was added to the conversation, and Undo is available from the notification.</small>
          <div className="clarify-actions"><button type="button" className="btn btn-sm" onClick={discard}>Done</button></div>
        </div>
      )}

      {base && phase !== 'done' && (
        <>
          {stale && (
            <div className="clarify-alert" role="alert">
              <p>The next action changed to “{task.nextAction}” after this was drafted, so it can’t be saved over it. Your answers are kept.</p>
              <div className="clarify-actions">
                <button type="button" className="btn btn-sm" onClick={() => void generate()} disabled={phase === 'loading'}>Draft again from the new wording</button>
              </div>
            </div>
          )}

          {base.reasons.length > 0 && (
            <div className="clarify-block">
              <h4>Why this is unclear</h4>
              <ul>{base.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </div>
          )}

          {base.questions.length > 0 && (
            <form className="clarify-block" onSubmit={event => { event.preventDefault(); if (answersChanged) setApplied({ ...typed }); }}>
              <h4>Questions</h4>
              {base.questions.map(question => (
                <label className="field" key={question.id}>
                  <span>{question.ask}{applied[question.id]?.trim() ? ' ✓' : ''}</span>
                  <input value={typed[question.id] ?? ''} maxLength={200} disabled={phase === 'saving'} aria-describedby={`clarify-why-${question.id}`}
                    onChange={event => setTyped(previous => ({ ...previous, [question.id]: event.target.value }))} />
                  <small className="field-hint" id={`clarify-why-${question.id}`}>{question.why}</small>
                </label>
              ))}
              <div className="clarify-actions"><button type="submit" className="btn btn-sm" disabled={!answersChanged || phase === 'saving'}>Update suggestion</button></div>
            </form>
          )}

          <div className="clarify-block">
            <label className="field">
              <span>Proposed next action</span>
              <textarea rows={2} value={edit ?? suggestion} maxLength={MAX_NEXT_ACTION + 40} disabled={phase === 'saving'} aria-describedby="clarify-source" aria-invalid={after.length > MAX_NEXT_ACTION}
                onChange={event => setEdit(event.target.value.replace(/\s*\n+\s*/g, ' '))} />
            </label>
            <div className="clarify-meta" id="clarify-source">
              <small>{edit !== null ? 'Your wording.' : refined?.proposal.source === 'answer' ? 'Built from your answers.' : 'Suggested from the task title and wording. Check it before approving.'}</small>
              <small className={after.length > MAX_NEXT_ACTION ? 'is-over' : ''}>{after.length}/{MAX_NEXT_ACTION}</small>
              {edit !== null && edit !== suggestion && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Reset to suggestion</button>}
            </div>
          </div>

          <div className="clarify-diff" aria-label="Before and after">
            <div className="is-before"><small>Before</small><q>{task.nextAction || '(empty)'}</q></div>
            <div className="is-after"><small>After</small>{after ? <strong>{after}</strong> : <em>Nothing yet</em>}</div>
          </div>

          {error && !stale && <p className="clarify-error" role="alert">{error}</p>}
          {verdict && !verdict.ok && !stale && !error && <p className="clarify-note" role="status">{WAITING[verdict.code] ?? verdict.error}</p>}

          <div className="clarify-actions is-footer">
            <button type="button" className="btn btn-primary" onClick={() => void approve()} disabled={!verdict?.ok || stale || phase === 'saving' || phase === 'loading'}>{phase === 'saving' ? 'Saving…' : 'Approve and save'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => close()} disabled={phase === 'saving'}>Close, keep draft</button>
            <button type="button" className="btn btn-ghost" onClick={discard} disabled={phase === 'saving'}>Discard</button>
          </div>
        </>
      )}
    </section>
  );
}
