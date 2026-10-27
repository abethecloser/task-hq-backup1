import { Select } from '../ui/Select.tsx';
import { FeedbackDemo } from './FeedbackDemo.tsx';
import { ReferencedText } from '../ui/ReferenceEditor.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Policy, Role } from '../core/contract.ts';
import { OPERATIONAL_ROLES } from '../core/contract.ts';
import { clock } from '../core/time.ts';
import { tagKey, validateAliases } from '../core/references.ts';
import { manages, nameOf, owns, person } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
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
        <Select value={kind} onChange={event => setKind(event.target.value)} aria-label="Filter activity">
          <option value="">All activity</option><option value="task">Tasks</option><option value="handoff">Handoffs</option><option value="help">Help</option>
          <option value="approval">Approvals</option><option value="ultra">Ultra Priority</option><option value="grant">Access requests</option><option value="lead">Leads</option>
        </Select>
      </header>
      <ol className="timeline">
        {events.map(event => (
          <li key={event.id} className={event.undone ? 'is-undone' : ''}>
            <time>{clock(event.at)}</time>
            <span className={`tl-kind k-${event.kind}`}>{event.kind}</span>
            <p><ReferencedText text={event.text} document={event.references?.text} /> <small>— {event.actor === 'system' ? 'Task-HQ' : nameOf(state, event.actor)}</small></p>
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

// Settings is a control center: an overview of categories, each summarizing what's set now,
// then one focused view at a time (#/settings/<category>). Workspace settings apply to everyone
// and are checked by the server; browser preferences stay on this device.
type Category = 'people' | 'work' | 'appearance' | 'policy' | 'data';
const CATEGORIES: Category[] = ['people', 'work', 'appearance', 'policy', 'data'];
const categoryFromHash = (): Category | null => { const id = location.hash.split('?')[0]!.split('/')[2] as Category; return CATEGORIES.includes(id) ? id : null; };

export function Settings({ quest, onPeople }: { quest: Quest; onPeople?: () => void }) {
  const { state, actor, backend } = quest;
  const live = useLive();
  // Owner and Admin run routine settings; Ultra Priority authority, access windows and the agent pilot stay with the Owner.
  const isManager = manages(person(state, actor));
  const isOwner = owns(person(state, actor));
  const [open, setOpen] = useState<Category | null>(categoryFromHash);
  // Each form reports its own unsaved state; a category is dirty when any of its forms is.
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({});
  const dirty = Object.values(dirtyForms).some(Boolean);
  const reportDirty = useCallback((form: string, value: boolean) => setDirtyForms(current => (current[form] === value ? current : { ...current, [form]: value })), []);
  const [leaving, setLeaving] = useState<Category | null | 'none'>('none');
  useEffect(() => {
    const sync = () => setOpen(categoryFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const go = (next: Category | null) => {
    if (dirty && next !== open) { setLeaving(next); return; }
    setLeaving('none'); setDirtyForms({}); setOpen(next);
    history.replaceState(null, '', next ? `#/settings/${next}` : '#/settings');
  };
  const policy = state.policy;
  const taxonomy = state.taxonomy;
  const workspaceName = live?.org.name ?? state.workspace.name;
  const role = live ? ROLE_LABELS[live.role] : person(state, actor)?.title ?? '';
  const cards: { id: Category; title: string; detail: string; summary: string; scope: 'workspace' | 'browser'; icon: string }[] = [
    { id: 'people', title: 'People & roles', detail: 'Members, invitations, roles and access requests', scope: 'workspace', icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
      summary: `${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}${live ? ` in ${live.org.name}` : ' · synthetic team'}` },
    { id: 'work', title: 'Work configuration', detail: backend.kind === 'live' ? 'Task types, tags and tag aliases' : 'Workspace, task types, tags and tag aliases', scope: 'workspace', icon: 'M4 5h16l-6 7v6l-4 2v-8z',
      summary: `${taxonomy?.types.length ?? 0} task types · ${taxonomy?.tags.length ?? 0} tags · ${Object.keys(taxonomy?.tagAliases ?? {}).length} aliases` },
    { id: 'appearance', title: 'Appearance', detail: 'Look and feel on this device', scope: 'browser', icon: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.9-.7-1.4-.7-2.2 0-.8.7-1.3 1.5-1.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01',
      summary: `${(typeof document !== 'undefined' && document.documentElement.dataset.look === 'brutalist') ? 'Brutalist' : 'Studio'} look` },
    { id: 'policy', title: 'Policy & access', detail: 'Ultra Priority, temporary access and attention rules', scope: 'workspace', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
      summary: `First response ${policy.leadResponseMinutes} min · stalled after ${policy.stalledHours} h · ${policy.ultraScope === 'company-wide' ? 'company-wide' : 'manager-context'} approvals` },
    { id: 'data', title: 'Data & backup', detail: 'Where this workspace’s data lives', scope: 'workspace', icon: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
      summary: `${backend.label} · revision ${state.rev}` },
  ];
  const card = cards.find(item => item.id === open);

  return (
    <div className="view settings-view">
      <header className="view-head settings-head">
        <div>
          <p className="eyebrow">{workspaceName}{role ? ` · ${role}` : ''}</p>
          {card ? <h1><button type="button" className="settings-crumb" onClick={() => go(null)}>Settings</button><span aria-hidden="true"> / </span>{card.title}</h1> : <h1>Settings</h1>}
          <p className="lede">{card ? card.detail : isManager ? 'Workspace settings apply to everyone and are checked by the server. Browser preferences stay on this device.' : 'You can view workspace settings; a manager or the owner changes them. Browser preferences are yours.'}</p>
        </div>
        {card && <ScopeBadge scope={card.scope} />}
      </header>

      {leaving !== 'none' && <div className="settings-leave" role="alertdialog" aria-label="Unsaved changes">
        <span>You have unsaved changes.</span>
        <button type="button" className="btn btn-sm" onClick={() => setLeaving('none')}>Keep editing</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => { setDirtyForms({}); setLeaving('none'); setOpen(leaving); history.replaceState(null, '', leaving ? `#/settings/${leaving}` : '#/settings'); }}>Discard changes</button>
      </div>}

      {!card
        ? <div className="settings-grid">
            {cards.map(item => (
              <button key={item.id} type="button" className="settings-card" onClick={() => go(item.id)}>
                <span className="settings-card-icon" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24"><path d={item.icon} /></svg></span>
                <span className="settings-card-title">{item.title}<ScopeBadge scope={item.scope} compact /></span>
                <span className="settings-card-detail">{item.detail}</span>
                <span className="settings-card-summary">{item.summary}</span>
              </button>
            ))}
          </div>
        : <div className="settings-focus">
            {open === 'people' && <PeopleSection quest={quest} onPeople={onPeople} />}
            {open === 'work' && <>
              {backend.kind !== 'live' && <WorkspacePanel quest={quest} isManager={isOwner} onDirty={value => reportDirty('workspace', value)} />}
              <TaxonomyPanel quest={quest} isManager={isManager} onDirty={value => reportDirty('taxonomy', value)} />
            </>}
            {open === 'appearance' && <section className="panel settings">
              <h3>Look</h3>
              <p className="muted">Studio is the default design. Brutalist uses heavy type, monospace labels, hard rules and square corners. Applies right away, in this browser only.</p>
              <LookSwitch />
              <p className="muted settings-note">The Home banner’s color or photo is set from the banner itself (Customize).</p>
              <details className="settings-secondary"><summary>Sensory feedback preview (synthetic)</summary><FeedbackDemo /></details>
            </section>}
            {open === 'policy' && <PolicyPanel quest={quest} isManager={isManager} isOwner={isOwner} onDirty={value => reportDirty('policy', value)} />}
            {open === 'data' && <DataPanel quest={quest} isManager={isManager} />}
          </div>}
    </div>
  );
}

function ScopeBadge({ scope, compact = false }: { scope: 'workspace' | 'browser'; compact?: boolean }) {
  return <span className={`scope-badge is-${scope} ${compact ? 'is-compact' : ''}`} title={scope === 'workspace' ? 'Applies to everyone in this workspace' : 'Only on this device, only for you'}>
    {scope === 'workspace' ? 'Workspace' : 'This browser'}</span>;
}

/** Save · Cancel · state, aligned with the form's content. */
function FormActions({ dirty, valid = true, status, onSave, onCancel, label = 'Save changes' }: {
  dirty: boolean; valid?: boolean; status: string; onSave: () => void; onCancel: () => void; label?: string;
}) {
  return (
    <div className="settings-actions">
      <span className={`settings-state ${dirty ? 'is-dirty' : ''}`} role="status">{dirty ? (valid ? 'Unsaved changes' : 'Fix the highlighted fields to save') : status}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={onCancel}>Cancel</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || !valid} onClick={onSave}>{label}</button>
    </div>
  );
}

/** After a save: the server's answer, in words. */
function useSaveStatus() {
  const [status, setStatus] = useState('');
  const report = (result: { ok: boolean; error?: string } | unknown) => {
    const outcome = result as { ok?: boolean; error?: string };
    setStatus(outcome && outcome.ok === false ? `Not saved: ${outcome.error ?? 'refused'}` : `Saved ${clock(Date.now())}`);
  };
  return { status, report };
}

function PeopleSection({ quest, onPeople }: { quest: Quest; onPeople?: () => void }) {
  const { state, backend } = quest;
  const live = useLive();
  return (
    <section className="panel settings">
      <h3>Members & access</h3>
      <p className="muted">{backend.kind === 'live'
        ? `Members, invitations, access requests and roles${live ? ` for ${live.org.name}` : ''} are managed in People & Access. Every change is checked by the server.`
        : 'The demo team is synthetic. Use the account menu’s “Working as” to try each person’s permissions.'}</p>
      <ul className="settings-people">{state.people.slice(0, 8).map(item => <li key={item.id}><b>{item.name}</b><small>{item.title}</small></li>)}</ul>
      {state.people.length > 8 && <p className="muted">and {state.people.length - 8} more</p>}
      {onPeople && <div className="settings-actions"><button type="button" className="btn btn-sm" onClick={onPeople}>Open People &amp; Access</button></div>}
    </section>
  );
}

function PolicyPanel({ quest, isManager, isOwner, onDirty }: { quest: Quest; isManager: boolean; isOwner: boolean; onDirty: (dirty: boolean) => void }) {
  const { state, dispatch } = quest;
  const [draft, setDraft] = useState<Policy>(state.policy);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.policy);
  // A change from elsewhere refreshes the form only when nothing is being edited here.
  useEffect(() => { if (!dirty) setDraft(state.policy); }, [state.policy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const { status, report } = useSaveStatus();
  const toggleRole = (key: 'ultraActivators' | 'ultraApprovers', role: Role) => setDraft(current => ({ ...current, [key]: current[key].includes(role) ? current[key].filter(item => item !== role) : [...current[key], role] }));
  const num = (key: keyof Policy) => (event: ChangeEvent<HTMLInputElement>) => setDraft(current => ({ ...current, [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) }));
  const whole = (value: number, min: number) => Number.isInteger(value) && value >= min;
  const errors = {
    grantSeconds: whole(draft.grantSeconds, 10) ? '' : 'At least 10 seconds.',
    maxGrantSeconds: !whole(draft.maxGrantSeconds, 30) ? 'At least 30 seconds.' : draft.maxGrantSeconds < draft.grantSeconds ? 'Can’t be shorter than the default.' : '',
    leadResponseMinutes: whole(draft.leadResponseMinutes, 1) ? '' : 'At least 1 minute.',
    stalledHours: whole(draft.stalledHours, 1) ? '' : 'At least 1 hour.',
  };
  const valid = Object.values(errors).every(message => !message);
  const field = (key: keyof typeof errors, label: string, min: number) => (
    <label className={`row-field ${errors[key] ? 'has-error' : ''}`}>{label}
      <input type="number" min={min} step={1} value={Number.isNaN(draft[key]) ? '' : draft[key]} aria-invalid={!!errors[key]} onChange={num(key)} />
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>
  );
  return (
    <>
      <section className="panel settings">
        <h3>Ultra Priority</h3>
        <p className="muted">Who can put work into focus, who approves access, and for how long.{!isOwner ? ' Only the owner changes these.' : ''}</p>
        <fieldset disabled={!isOwner}>
          <label className="row-field">Who decides access requests
            <Select value={draft.ultraScope} onChange={event => setDraft({ ...draft, ultraScope: event.target.value as Policy['ultraScope'] })}>
              <option value="manager-context">Only the manager who activated focus</option>
              <option value="company-wide">Any approver in the company</option>
            </Select>
          </label>
          {(['ultraActivators', 'ultraApprovers'] as const).map(key => (
            <div key={key} className="row-field">{key === 'ultraActivators' ? 'Who can activate Ultra Priority' : 'Who can approve, revoke and release'}
              <div className="checks">{OPERATIONAL_ROLES.map(role => <label key={role}><input type="checkbox" checked={draft[key].includes(role)} onChange={() => toggleRole(key, role)} />{presetFor(state).roleLabels[role]}</label>)}</div>
            </div>
          ))}
          {field('grantSeconds', 'Default temporary access (seconds)', 10)}
          {field('maxGrantSeconds', 'Longest access a manager may grant (seconds)', 30)}
        </fieldset>
      </section>
      <section className="panel settings">
        <h3>Attention rules</h3>
        <p className="muted">When work is flagged as needing a response or as stalled.{!isManager ? ' Only a manager changes these.' : ''}</p>
        <fieldset disabled={!isManager}>
          {field('leadResponseMinutes', 'First-response target (minutes)', 1)}
          {field('stalledHours', 'Flag work as stalled after (hours)', 1)}
          <label className="row-field check-row"><input type="checkbox" checked={draft.agentPilot} disabled={!isOwner} onChange={event => setDraft({ ...draft, agentPilot: event.target.checked })} />Show the simulated Agent pilot (off by default; Task-HQ never needs it)</label>
        </fieldset>
      </section>
      {isManager && <FormActions dirty={dirty} valid={valid} status={status} label="Save policy" onCancel={() => setDraft(state.policy)}
        onSave={() => void dispatch({ type: 'policy/update', changes: draft }).then(report)} />}
    </>
  );
}

function DataPanel({ quest, isManager }: { quest: Quest; isManager: boolean }) {
  const { state, dispatch, backend } = quest;
  const [confirmReset, setConfirmReset] = useState(false);
  const [outbox, setOutbox] = useState(0);
  useEffect(() => { void backend.outboxCount().then(setOutbox); }, [backend, state.rev]);
  return (
    <section className="panel settings">
      <h3>Where this data lives</h3>
      <p><b>{backend.label}.</b> {backend.detail}</p>
      {backend.kind === 'live'
        ? <>
          <p className="muted">Revision {state.rev}. Task data lives on the Task-HQ server: every change is checked against your role there and recorded in the audit log. This browser keeps only your sign-in, display preferences and any feedback captures you made here.</p>
          {isManager && <div className="settings-actions is-start"><button type="button" className="btn btn-sm" onClick={() => downloadBackup(state)}>Download workspace backup (.json)</button><small className="muted">A full copy of tasks, history, feedback and policy at revision {state.rev}.</small></div>}
        </>
        : <>
          <p className="muted">{outbox} change(s) recorded on this device. None have been delivered to teammates because no shared Task-HQ server is connected. Revision {state.rev} · last written by {state.writer}.</p>
          <p className="muted">Sign-in is not real: “Working as” lets you play each synthetic person to try the hand-offs. Authorization rules are enforced in Task-HQ’s shared rules on this device only.</p>
        </>}
      {confirmReset
        ? <div className="inline-form"><span>Replace all demo data with a fresh sample workspace?</span><button type="button" className="btn btn-danger btn-sm" onClick={() => { void dispatch({ type: 'demo/reset' }); setConfirmReset(false); }}>Yes, reset</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button></div>
        : backend.kind !== 'live' && <div className="settings-actions is-start"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}>Reset demo workspace…</button></div>}
    </section>
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

function WorkspacePanel({ quest, isManager, onDirty }: { quest: Quest; isManager: boolean; onDirty: (dirty: boolean) => void }) {
  const { state, dispatch } = quest;
  const workspace = state.workspace;
  const [name, setName] = useState(workspace.name);
  const [preset, setPreset] = useState<PresetId>(workspace.preset);
  const dirty = name !== workspace.name || preset !== workspace.preset;
  const saved = useRef(false);
  useEffect(() => { if (!dirty || saved.current) { saved.current = false; setName(workspace.name); setPreset(workspace.preset); } }, [workspace.name, workspace.preset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const { status, report } = useSaveStatus();
  const nameError = name.trim() ? '' : 'A workspace needs a name.';
  const features = entitlementsFor(state);
  return (
    <section className="panel settings">
      <h3>Workspace</h3>
      <p className="muted">{PRODUCT.name} is the platform; this is one customer workspace. Industry language and handoffs come from the preset, not the product.</p>
      <fieldset disabled={!isManager}>
        <label className={`row-field ${nameError ? 'has-error' : ''}`}>Workspace name<input value={name} maxLength={80} aria-invalid={!!nameError} onChange={event => setName(event.target.value)} />{nameError && <small className="field-error">{nameError}</small>}</label>
        <label className="row-field">Industry preset
          <Select value={preset} onChange={event => setPreset(event.target.value as PresetId)}>{(Object.keys(PRESETS) as PresetId[]).map(id => <option key={id} value={id}>{PRESETS[id].label}</option>)}</Select>
        </label>
        <p className="muted">Lead handoff in this preset: “{PRESETS[preset].leadHandoffAction}” creates an {PRESETS[preset].leadHandoffNoun}.</p>
      </fieldset>
      {isManager && <FormActions dirty={dirty} valid={!nameError} status={status} label="Save workspace" onCancel={() => { setName(workspace.name); setPreset(workspace.preset); }}
        onSave={() => { saved.current = true; void dispatch({ type: 'workspace/update', changes: { name: name.trim(), preset } }).then(report); }} />}
      <details className="settings-secondary"><summary>Workspace details</summary>
        <dl className="status-grid">
          <dt>Type</dt><dd>{workspace.kind === 'organization' ? 'Organization' : 'Individual'}</dd>
          <dt>Tenant</dt><dd>{workspace.tenantId} (local; a server would enforce isolation per tenant)</dd>
          <dt>Plan</dt><dd>Local demo — every feature on, no billing{features.maxMembers ? ` · up to ${features.maxMembers} members` : ''}</dd>
        </dl>
      </details>
    </section>
  );
}

/** Task types (with the words that suggest them) and known tags, used by the command input. */
function TaxonomyPanel({ quest, isManager, onDirty }: { quest: Quest; isManager: boolean; onDirty: (dirty: boolean) => void }) {
  const { state, dispatch, backend } = quest;
  const supported = backend.supports?.taskTaxonomy !== false;
  const fromState = () => ({
    types: (state.taxonomy?.types ?? []).map(item => ({ ...item, words: item.keywords.join(', ') })),
    tags: (state.taxonomy?.tags ?? []).join(', '),
    aliases: Object.entries(state.taxonomy?.tagAliases ?? {}).map(([a, t]) => `${a}=${t}`).join(', '),
  });
  const [form, setForm] = useState(fromState);
  const dirty = JSON.stringify(form) !== JSON.stringify(fromState());
  // After a save the stored version wins (it gains ids and normalized words); otherwise only refresh an untouched form.
  const saved = useRef(false);
  useEffect(() => { if (!dirty || saved.current) { saved.current = false; setForm(fromState()); } }, [state.taxonomy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const { status, report } = useSaveStatus();
  const pairs = form.aliases.split(',').map(pair => pair.trim()).filter(Boolean);
  const badAliases = pairs.filter(pair => { const parts = pair.split('=').map(p => p.trim()); return parts.length !== 2 || !parts[0] || !parts[1]; });
  const blankType = form.types.some(item => !item.label.trim() && item.words.trim());
  const nextTags = form.tags.split(/[\s,]+/).map(tag => tag.replace(/^#/, '').trim()).filter(Boolean);
  // The same alias rule the server enforces, so a refusal is explained before saving.
  const aliasRule = badAliases.length ? null : validateAliases({ types: [], tags: nextTags.map(tagKey), tagAliases: Object.fromEntries(pairs.map(pair => pair.split('=').map(p => p.trim()))) });
  const valid = badAliases.length === 0 && !blankType && !aliasRule;
  const setType = (index: number, changes: Partial<{ label: string; words: string }>) => setForm(current => ({ ...current, types: current.types.map((other, i) => (i === index ? { ...other, ...changes } : other)) }));
  const save = () => { saved.current = true; void dispatch({ type: 'taxonomy/update', taxonomy: {
    tagAliases: Object.fromEntries(pairs.map(pair => pair.split('=').map(p => p.trim()))),
    types: form.types.filter(item => item.label.trim()).map(item => ({ id: item.id || item.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label: item.label, keywords: item.words.split(',').map(word => word.trim()).filter(Boolean) })),
    tags: nextTags,
  } }).then(report); };
  return (
    <section className="panel settings">
      <h3>Task types & tags</h3>
      <p className="muted">The command input recognizes a word like “meeting” or “permit” as a task type only if it’s listed here.{supported ? '' : ' Saving these needs the next server update.'}{!isManager ? ' Only a manager changes these.' : ''}</p>
      <fieldset disabled={!isManager || !supported} className="taxonomy">
        <div className="taxonomy-head" aria-hidden="true"><span>Type</span><span>Words that suggest it</span><span /></div>
        {form.types.map((item, index) => (
          <div key={index} className={`taxonomy-row ${!item.label.trim() && item.words.trim() ? 'has-error' : ''}`}>
            <input aria-label="Type name" value={item.label} placeholder="e.g. Inspection" aria-invalid={!item.label.trim() && !!item.words.trim()} onChange={event => setType(index, { label: event.target.value })} />
            <input aria-label="Words that suggest it" value={item.words} placeholder="inspect, inspection" onChange={event => setType(index, { words: event.target.value })} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(current => ({ ...current, types: current.types.filter((_, i) => i !== index) }))}>Remove</button>
          </div>
        ))}
        {blankType && <small className="field-error">Give each type a name, or remove the row.</small>}
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(current => ({ ...current, types: [...current.types, { id: '', label: '', keywords: [], words: '' }] }))}>+ Add type</button></div>
        <label className="row-field">Known tags<input value={form.tags} placeholder="permits, safety, northside" onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} /></label>
        <details className="settings-secondary" open={badAliases.length > 0 || !!aliasRule || undefined}>
          <summary>Advanced: tag aliases &amp; matching</summary>
          <label className={`row-field ${badAliases.length || aliasRule ? 'has-error' : ''}`}>Explicit tag aliases<input value={form.aliases} aria-invalid={badAliases.length > 0 || !!aliasRule} onChange={event => setForm(current => ({ ...current, aliases: event.target.value }))} placeholder="maple-ave=mapleave, maple_ave=mapleave" />
            {badAliases.length > 0 && <small className="field-error">Use alias=tag, separated by commas. Check: {badAliases.join(', ')}</small>}
            {aliasRule && <small className="field-error">{aliasRule}</small>}</label>
          <p className="muted">Capitalization resolves automatically. Punctuation stays distinct unless explicitly aliased; an existing tag cannot be merged here.</p>
        </details>
      </fieldset>
      {isManager && supported && <FormActions dirty={dirty} valid={valid} status={status} label="Save types & tags" onCancel={() => setForm(fromState())} onSave={save} />}
    </section>
  );
}
