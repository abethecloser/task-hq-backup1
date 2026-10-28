import { Select } from '../ui/Select.tsx';
import { useDropdown } from '../ui/useDropdown.tsx';
import { ReferenceInput, ReferenceTextarea } from '../ui/ReferenceEditor.tsx';
// Universal command input. Type what needs to happen; review the drafts; create them
// through the engine. Parsing and autocomplete are local and deterministic
// (src/core/command.ts). Nothing is created, assigned, notified or sent until the person
// presses Create on the reviewed drafts — and the engine (on the server, when live)
// still decides what is allowed.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Action, QuestState } from '../core/contract.ts';
import { apply } from '../core/engine.ts';
import { dueLabel, newTaskFrom, parseCommand, parseTaskEntry, taskEntryScope, suggestAt } from '../core/command.ts';
import type { Draft, PersonRef, StagedPerson, SuggestState } from '../core/command.ts';
import { errorText } from '../live/LiveRoot.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { useLive } from './LiveContext.tsx';
import { isOrgAdmin } from './authority.ts';

type Variant = 'home' | 'registry' | 'form';
const PLACEHOLDER: Record<Variant, string> = {
  home: 'What needs to happen?  Try: Meeting with @Maya tomorrow 9am #permits !high',
  registry: 'Add tasks in plain words — @person #tag /type !high tomorrow 9am',
  form: 'e.g. Inspect Elm St Friday 2pm !high',
};

/** Staged (not yet invited) people, for owners/admins in a live workspace. */
function useStaged(): { people: StagedPerson[]; canPlan: boolean; contactFor: (id: string) => string | null } {
  const live = useLive();
  const [people, setPeople] = useState<StagedPerson[]>([]);
  const admin = !!live && isOrgAdmin(live.role);
  useEffect(() => {
    if (!live || !admin) return;
    let alive = true;
    void live.client.rpc('org_staging_overview', { p_org: live.org.id }).then(({ data, error }) => {
      if (!alive || error || !Array.isArray(data)) return;
      setPeople((data as { id: string; full_name: string; email: string | null; state: string }[]).filter(item => item.state !== 'active').map(item => ({ id: item.id, name: item.full_name, email: item.email })));
    });
    return () => { alive = false; };
  }, [live, admin]);
  return { people, canPlan: admin && people.length > 0, contactFor: id => (people.some(item => item.id === id) ? id : null) };
}

export function Composer({ quest, variant, onFill, value, onTextChange, initialText = '', single = false, onCreated }: {
  quest: Quest; variant: Variant; onFill?: (draft: Draft | undefined) => void;
  value?: string; onTextChange?: (text: string) => void;
  /** Start with this text already reviewed (e.g. "Make a task" from a message). */
  initialText?: string;
  /** Read the text as one task instead of splitting it into clauses. */
  single?: boolean;
  onCreated?: (tasks: { id: string; title: string }[]) => void;
}) {
  const { state, actor, now, dispatch, backend } = quest;
  const live = useLive();
  const staged = useStaged();
  const taxonomyOk = backend.supports?.taskTaxonomy !== false;
  const [localText, setLocalText] = useState(initialText);
  const text = value ?? localText;
  const setText = (next: string) => { setLocalText(next); onTextChange?.(next); };
  const fillRef = useRef(onFill); fillRef.current = onFill;
  const [focused, setFocused] = useState(false);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [cursor, setCursor] = useState(0);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: { id: string; title: string; eventId: string | null }[]; failed?: string; planned: string[] } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const popup = useRef<HTMLUListElement>(null);
  useDropdown({ open: !!suggest, onClose: () => setSuggest(null), trigger: () => input.current, content: () => popup.current });
  const reviewer = state.people.find(item => item.id === actor)?.role === 'reviewer';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (variant !== 'form' && initialText.trim()) setDrafts(parseCommand(initialText, state, now, staged.people, { single })); }, [initialText]);

  // Primary task entry stays live; other Composer surfaces keep explicit review.
  // Reading reference drafts also preserves an identity explicitly chosen in autocomplete.
  useEffect(() => {
    if (variant === 'form') fillRef.current?.(parseTaskEntry(text, state, actor, now, quest.referenceDrafts.documents()));
  }, [text, state, actor, variant]);

  function refreshSuggest(value: string, caret: number) {
    const next = suggestAt(value, caret, state, staged.people);
    setSuggest(next && (next.trigger === '/' || next.trigger === '!') ? next : null);
    setCursor(0);
  }
  function pick(index: number) {
    if (!suggest) return;
    const item = suggest.items[index];
    if (!item) return;
    const next = text.slice(0, suggest.start) + item.insert + text.slice(suggest.end);
    setText(next); setSuggest(null);
    requestAnimationFrame(() => { const caret = suggest.start + item.insert.length; input.current?.setSelectionRange(caret, caret); input.current?.focus(); });
  }
  function review() {
    if (!text.trim()) return;
    const parsed = parseCommand(text, state, now, staged.people, { single, documents: quest.referenceDrafts.documents() });
    if (variant === 'form') return;
    for (const d of parsed) if (d.references) quest.referenceDrafts.set(`composer-preview:${d.key}`, d.references);
    setDrafts(parsed); setResult(null); setSuggest(null);
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggest) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(value => (value + 1) % suggest.items.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(value => (value - 1 + suggest.items.length) % suggest.items.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(cursor); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSuggest(null); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (variant !== 'form') review(); return; }
    if (event.key === 'Escape') { event.stopPropagation(); if (drafts) setDrafts(null); else input.current?.blur(); }
  }

  const update = (key: string, change: Partial<Draft>) => setDrafts(current => current && current.map(item => (item.key === key ? { ...item, ...change } : item)));

  // Engine dry-run of the whole reviewed batch, in order, as this person.
  const checks = useMemo(() => {
    if (!drafts) return {} as Record<string, string>;
    const out: Record<string, string> = {}; let current: QuestState = state; const ids: Record<string, string> = {}; let n = 0;
    for (const draft of drafts.filter(item => item.include)) {
      const action: Action = { type: 'task/create', task: newTaskFrom(draft, ids, { taxonomy: taxonomyOk }) };
      const dry = apply(current, action, { actor, now, newId: () => `dry-${++n}` });
      if (!dry.ok) { out[draft.key] = dry.error; continue; }
      current = dry.state; ids[draft.key] = current.tasks[0]!.id;
    }
    return out;
  }, [drafts, state, actor, now, taxonomyOk]);

  const creating = useRef(false);
  async function create() {
    // Synchronous guard: a second tap before the re-render must not create the batch twice.
    if (!drafts || creating.current) return;
    creating.current = true;
    setBusy(true);
    const created: { id: string; title: string; eventId: string | null }[] = []; const ids: Record<string, string> = {}; let failed: string | undefined;
    for (const draft of drafts.filter(item => item.include)) {
      const res = await dispatch({ type: 'task/create', task: newTaskFrom(draft, ids, { taxonomy: taxonomyOk }) });
      if (!res.ok) { failed = `“${draft.title}” wasn’t created: ${res.error}`; break; }
      const taskId = res.state.events.find(event => event.id === res.eventId)?.taskId;
      const task = res.state.tasks.find(item => item.id === taskId);
      if (!task) { failed = `“${draft.title}” may have been created, but Task-HQ couldn’t confirm it. Reload before retrying.`; break; }
      ids[draft.key] = task.id;
      created.push({ id: task.id, title: task.title, eventId: res.eventId });
    }
    creating.current = false;
    setBusy(false);
    setResult({ created, failed, planned: [] });
    if (created.length) onCreated?.(created);
    if (!failed) { setDrafts(null); setText(''); }
  }
  async function undoAll() {
    if (!result) return;
    for (const item of [...result.created].reverse()) if (item.eventId) await dispatch({ type: 'undo', eventId: item.eventId });
    setResult(null);
  }
  async function planForStaged(draft: Draft, contactId: string, name: string) {
    if (!live) return;
    const { error } = await live.client.rpc('save_staged_assignment', { p_contact: contactId, p_assignment: null, p_title: draft.title, p_next_action: '', p_due: draft.due || null, p_priority: draft.priority, p_notes: `From the command input: “${draft.source}”` });
    if (error) { update(draft.key, { notes: [...draft.notes, errorText(error)] }); return; }
    update(draft.key, { include: false, notes: [...draft.notes, `Planned for ${name} (not assigned). It appears under their planned work in People & Access.`] });
  }

  if (reviewer) return null;
  const included = drafts?.filter(item => item.include) ?? [];
  const refused = included.filter(item => checks[item.key]);
  const expanded = focused || !!text || !!drafts;

  return (
    <section className={`composer v-${variant} ${expanded ? 'is-open' : ''}`} aria-label="Command input">
      <div className="composer-box">
        <ReferenceTextarea referenceScope={variant === 'form' ? taskEntryScope(state, actor) : undefined} ref={input} rows={1} value={text} placeholder={PLACEHOLDER[variant]} aria-label={variant === 'form' ? 'Describe it for me (optional)' : 'Describe what needs to happen'}
          aria-autocomplete="list" aria-expanded={!!suggest} aria-controls="composer-suggest" aria-activedescendant={suggest ? `composer-opt-${cursor}` : undefined}
          onChange={event => { setText(event.target.value); refreshSuggest(event.target.value, event.target.selectionStart); }}
          onSelect={event => refreshSuggest(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setSuggest(null); }} />
        {variant !== 'form' && <button type="button" className="btn btn-primary btn-sm composer-go" disabled={!text.trim()} onClick={review}>Review <kbd>↵</kbd></button>}
        {suggest && (
          <ul ref={popup} id="composer-suggest" className="composer-suggest" role="listbox" aria-label="Suggestions">
            {suggest.items.map((item, index) => (
              <li key={`${item.kind}-${item.label}`} id={`composer-opt-${index}`} role="option" aria-selected={index === cursor}
                className={`${index === cursor ? 'is-active' : ''} ${item.kind === 'person' && /Not invited/.test(item.detail) ? 'is-staged' : ''}`}
                onMouseDown={event => { event.preventDefault(); pick(index); }} onMouseEnter={() => setCursor(index)}>
                <b>{item.label}</b><small>{item.detail}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {expanded && !drafts && !result && (
        <p className="composer-hints"><span><kbd>@</kbd> person</span><span><kbd>#</kbd> tag</span><span><kbd>/</kbd> type</span><span><kbd>!</kbd> priority</span><span>tomorrow 9am · friday · 10/24</span><span>“then …” chains work</span><span><kbd>⇧↵</kbd> new line for a list</span></p>
      )}

      {drafts && (
        <div className="composer-review" role="region" aria-label="Review before creating">
          <header className="composer-review-head">
            <span className="section-label">{drafts.length > 1 ? `Plan · ${drafts.length} tasks` : 'Review'}</span>
            <span className="muted">Nothing is created, assigned or sent until you press Create. Proposed owners and reviewers apply only when you confirm them.</span>
          </header>
          {drafts.map((draft, index) => (
            <DraftCard key={draft.key} quest={quest} draft={draft} previous={index > 0 ? drafts[index - 1]! : null} refusal={draft.include ? checks[draft.key] : undefined}
              taxonomyOk={taxonomyOk} onChange={change => update(draft.key, change)}
              onPlanStaged={staged.canPlan ? (contactId, name) => void planForStaged(draft, contactId, name) : undefined} />
          ))}
          <footer className="composer-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setDrafts(null)}>Back to editing</button>
            <span className="muted">{refused.length ? `${refused.length} won’t be allowed — fix or untick ${refused.length === 1 ? 'it' : 'them'}.` : ''}</span>
            <button type="button" className="btn btn-primary" disabled={busy || !included.length || refused.length > 0} onClick={() => void create()}>
              {busy ? 'Creating…' : `Create ${included.length} task${included.length === 1 ? '' : 's'}`}
            </button>
          </footer>
        </div>
      )}
      {result && (
        <div className={`composer-result ${result.failed ? 'is-error' : ''}`} role="status">
          {result.created.length > 0 && <span>Created {result.created.map(item => `“${item.title}”`).join(', ')}.</span>}
          {result.failed && <span>{result.failed} Earlier tasks in the list were kept.</span>}
          {result.created.length > 0 && <button type="button" className="link" onClick={() => void undoAll()}>Undo {result.created.length > 1 ? 'all' : ''}</button>}
          <button type="button" className="link" onClick={() => setResult(null)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}

function refName(ref: PersonRef) { return ref.kind === 'member' || ref.kind === 'staged' ? ref.name : ref.text; }

function DraftCard({ quest, draft, previous, refusal, taxonomyOk, onChange, onPlanStaged }: {
  quest: Quest; draft: Draft; previous: Draft | null; refusal?: string; taxonomyOk: boolean;
  onChange: (change: Partial<Draft>) => void; onPlanStaged?: (contactId: string, name: string) => void;
}) {
  const { state, now } = quest;
  const members = state.people.filter(item => item.role !== 'reviewer');
  const types = state.taxonomy?.types ?? [];
  const [tagInput, setTagInput] = useState('');
  const pickPerson = (field: 'owner' | 'approver', id: string) => {
    const person = members.find(item => item.id === id);
    onChange({ [field]: person ? { ref: { kind: 'member', id: person.id, name: person.name }, from: 'chosen', confirmed: true } : null });
  };
  const proposal = (field: 'owner' | 'approver', label: string) => {
    const value = draft[field];
    const chosen = value?.confirmed && value.ref.kind === 'member' ? value.ref.id : '';
    return (
      <div className="draft-field">
        <span className="draft-label">{label}</span>
        <Select value={chosen} onChange={event => pickPerson(field, event.target.value)} aria-label={`${label} for ${draft.title}`}>
          <option value="">{field === 'owner' ? 'Unassigned' : 'No review'}</option>
          {members.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        {value && !value.confirmed && value.ref.kind === 'member' && (
          <button type="button" className="proposal-chip" onClick={() => onChange({ [field]: { ...value, confirmed: true } })} title={`From “${value.from}”`}>
            Proposed: {value.ref.name} · <b>Confirm</b>
          </button>
        )}
        {value && value.ref.kind === 'staged' && (
          <span className="proposal-chip is-staged">{value.ref.name} · not invited
            {onPlanStaged && <button type="button" className="link" onClick={() => onPlanStaged(value.ref.kind === 'staged' ? value.ref.id : '', value.ref.kind === 'staged' ? value.ref.name : '')}>Plan for them instead</button>}
          </span>
        )}
        {value && value.ref.kind === 'ambiguous' && (
          <span className="proposal-chip is-warn">“{value.ref.text}” is ambiguous — choose above</span>
        )}
      </div>
    );
  };

  return (
    <article className={`draft ${draft.include ? '' : 'is-off'} ${refusal ? 'is-refused' : ''}`}>
      <header className="draft-head">
        <label className="draft-include"><input type="checkbox" checked={draft.include} onChange={event => onChange({ include: event.target.checked })} aria-label={`Include ${draft.title}`} /></label>
        <ReferenceInput referenceDocument={draft.references} onReferencesChange={doc => onChange({ references: doc })} className="draft-title" value={draft.title} maxLength={160} onChange={event => onChange({ title: event.target.value })} aria-label="Task name" />
        {draft.priority === 'high' && <span className="tag tag-high">High</span>}
      </header>
      <div className="draft-grid">
        {proposal('owner', 'Owner')}
        {proposal('approver', 'Review by')}
        <div className="draft-field">
          <span className="draft-label">Due</span>
          <span className="draft-when">
            <input type="date" value={draft.due} onChange={event => onChange({ due: event.target.value, dueTime: event.target.value ? draft.dueTime : '' })} aria-label="Due date" />
            <input type="time" value={draft.dueTime} disabled={!draft.due || !taxonomyOk} onChange={event => onChange({ dueTime: event.target.value })} aria-label="Due time" />
          </span>
          <small className="muted">{dueLabel(draft.due, draft.dueTime, now)}{draft.when ? ` · read from “${draft.when}”` : ''}</small>
        </div>
        <div className="draft-field">
          <span className="draft-label">Priority</span>
          <span className="segmented">
            {(['normal', 'high'] as const).map(value => <button key={value} type="button" className={draft.priority === value ? 'is-on' : ''} aria-pressed={draft.priority === value} onClick={() => onChange({ priority: value })}>{value === 'high' ? 'High' : 'Normal'}</button>)}
          </span>
        </div>
        {(types.length > 0 || draft.type) && (
          <div className="draft-field">
            <span className="draft-label">Type</span>
            <Select value={draft.type} disabled={!taxonomyOk} onChange={event => onChange({ type: event.target.value })} aria-label="Task type">
              <option value="">No type</option>
              {types.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </Select>
          </div>
        )}
        <div className="draft-field">
          <span className="draft-label">Tags</span>
          <span className="draft-tags">
            {draft.tags.map(item => (
              <button key={item.tag} type="button" className={`chip ${item.known ? '' : 'is-new'}`} title={item.known ? 'Remove tag' : 'New tag — remove'} onClick={() => onChange({ tags: draft.tags.filter(other => other.tag !== item.tag) })}>#{item.tag}{!item.known && <em> new</em>} ×</button>
            ))}
            <input value={tagInput} placeholder="+ tag" disabled={!taxonomyOk} aria-label="Add tag" onChange={event => setTagInput(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ',') return;
                event.preventDefault();
                const tag = tagInput.trim().toLowerCase().replace(/^#/, '');
                if (tag && !draft.tags.some(item => item.tag === tag)) onChange({ tags: [...draft.tags, { tag, known: (state.taxonomy?.tags ?? []).includes(tag) }] });
                setTagInput('');
              }} />
          </span>
        </div>
      </div>
      {draft.with.length > 0 && (
        <p className="draft-with"><span className="draft-label">With</span>
          {draft.with.map(ref => (
            <span key={refName(ref)} className={`person-chip ${ref.kind !== 'member' ? 'is-warn' : ''}`}>
              {refName(ref)}{ref.kind === 'staged' ? ' · not invited' : ref.kind === 'member' ? ' · reference' : ref.kind === 'ambiguous' ? ' · which one?' : ' · not found'}
              {ref.kind === 'member' && <button type="button" className="link" aria-label={`Remove ${ref.name}`} onClick={() => onChange({ with: draft.with.filter(item => item !== ref) })}>×</button>}
            </span>
          ))}
        </p>
      )}
      {previous && (
        <label className="draft-after"><input type="checkbox" checked={draft.after === previous.key} onChange={event => onChange({ after: event.target.checked ? previous.key : null })} />
          Starts after “{previous.title}”</label>
      )}
      {!taxonomyOk && (draft.type || draft.tags.length > 0 || draft.dueTime) && <p className="draft-note">Type, tags and time cannot be saved on the current shared server. The task will be created without them; these values are not queued for later.</p>}
      {draft.notes.length > 0 && <ul className="draft-notes">{draft.notes.map(note => <li key={note}>{note}</li>)}</ul>}
      {refusal && <p className="draft-refusal" role="alert">Won’t be allowed: {refusal}</p>}
    </article>
  );
}
