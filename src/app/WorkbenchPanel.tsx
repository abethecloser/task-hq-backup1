// Working setup for a task. Three layers, kept distinct:
//   Organization (QuestBase): the environment's persistent functional brains, consumed through
//     core/org-capabilities.ts. Task HQ only reads them and records a human's task-scoped delegation.
//   Task roles (core/participants.ts): bounded readings of this task, coordinated by the Overseer.
//   Tools and frameworks (core/workbench.ts).
// Discovery and every reading are rule based and labelled so: selecting a brain or role never means a model
// is connected. Approving writes one history line through the existing comment action; templates are
// personal and stay in this browser. Personal and organization environments are never mixed.
import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../core/contract.ts';
import { nameOf } from '../core/selectors.ts';
import { AUTHORITY_LEVELS, AUTHORITY_LABELS, effectiveAuthority, participantById, rank } from '../core/participants.ts';
import type { Authority, ParticipantId } from '../core/participants.ts';
import { checkSnapshot, delegate, delegationNote, noProvider } from '../core/org-capabilities.ts';
import type { ContextScope, OrgSnapshot } from '../core/org-capabilities.ts';
import { SAMPLE_ORG, fixtureProvider } from '../core/org-fixtures.ts';
import { CATALOG, analyze, applyTemplate, saveTemplate, workbenchNote } from '../core/workbench.ts';
import type { WorkbenchTemplate } from '../core/workbench.ts';
import { useLive } from './LiveContext.tsx';
import type { Quest } from '../ui/useQuest.ts';

const key = (actor: string) => `quest.workbench.templates.${actor}`;
const load = (actor: string): WorkbenchTemplate[] => { try { const raw = JSON.parse(localStorage.getItem(key(actor)) ?? '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; } };
const persist = (actor: string, list: WorkbenchTemplate[]) => { try { localStorage.setItem(key(actor), JSON.stringify(list)); } catch { /* private mode: templates last for this visit only */ } };

export function WorkbenchPanel({ quest, task, editable }: { quest: Quest; task: Task; editable: boolean }) {
  const { state, actor, now, dispatch } = quest;
  const live = useLive();
  // The sample organization exists only in the demo. A signed-in workspace gets exactly what QuestBase provides: today, nothing.
  const provider = live ? noProvider : fixtureProvider;
  const contexts: Record<'organization' | 'personal', ContextScope> = useMemo(() => ({
    organization: live ? { kind: 'organization', id: live.org.id, name: live.org.name } : SAMPLE_ORG,
    personal: { kind: 'personal', id: actor, name: 'Personal QuestSpace' },
  }), [live, actor]);
  const [environment, setEnvironment] = useState<'organization' | 'personal'>('organization');
  const context = contexts[environment];

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OrgSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSnapshot(null); setSnapshotError('');
    provider(context, controller.signal).then(raw => { if (!controller.signal.aborted) setSnapshot(checkSnapshot(raw, context)); })
      .catch(error => { if (!controller.signal.aborted) setSnapshotError(error instanceof Error ? error.message : 'Could not read capabilities.'); });
    return () => controller.abort();
  }, [open, provider, context]);

  const minute = Math.floor(now / 60000);
  const { proposal, brief, org } = useMemo(() => analyze(state, task, now, CATALOG, snapshot ?? undefined), [state, task, minute, snapshot]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState<Partial<Record<ParticipantId, Authority>>>({});
  const [brains, setBrains] = useState<Record<string, Authority>>({});
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>(() => load(actor));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // New analysis (another task, or the task changed): start from the full recommendation; the person trims it.
  // Organization brains start unselected: choosing one is a delegation, so it is always the person's act.
  const signature = `${task.id}|${proposal.kind}|${brief.recommended.map(r => r.id).join(',')}|${proposal.picks.map(p => p.capabilityId).join(',')}`;
  useEffect(() => {
    setChosen(new Set(proposal.picks.map(p => p.capabilityId)));
    setTeam(Object.fromEntries(brief.recommended.map(r => [r.id, r.authority])));
    setMessage('');
  }, [signature]);
  useEffect(() => { setBrains({}); }, [task.id, environment]);

  const byId = (id: string) => CATALOG.find(c => c.id === id)!;
  const toggle = (id: string) => setChosen(was => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleTeam = (id: ParticipantId, authority: Authority) => setTeam(was => { const next = { ...was }; if (id in next) delete next[id]; else next[id] = authority; return next; });
  const toggleBrain = (id: string, level: Authority) => setBrains(was => { const next = { ...was }; if (id in next) delete next[id]; else next[id] = level; return next; });
  const mine = templates.filter(t => t.owner === actor);
  const selectedIds = Object.keys(team) as ParticipantId[];
  const brainIds = Object.keys(brains);

  async function use() {
    if (!chosen.size && !selectedIds.length && !brainIds.length) { setMessage('Pick at least one.'); return; }
    let orgNote = '';
    try {
      const grants = brainIds.map(id => {
        const brain = snapshot!.brains.find(b => b.id === id)!;
        const d = delegate({ task, context, brain, roleCeiling: null, roleId: null, requested: brains[id]!, grantedBy: actor, now });
        return { name: brain.name, authority: d.authority };
      });
      orgNote = delegationNote(grants, context, nameOf(state, actor));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delegate.'); return; }
    setBusy(true);
    const specialists = selectedIds.map(id => ({ name: participantById(id)!.name, authority: effectiveAuthority(participantById(id)!, team[id]!) }));
    const result = await dispatch({ type: 'task/comment', id: task.id, note: workbenchNote([...chosen].map(id => byId(id).name), proposal.kind, specialists, orgNote) });
    setBusy(false);
    setMessage(result.ok ? 'Recorded on the task.' : `Not saved: ${result.error}`);
  }
  function save() {
    try {
      const next = saveTemplate(templates, { name, kind: proposal.kind, capabilityIds: [...chosen], participantIds: selectedIds, owner: actor, now });
      setTemplates(next); persist(actor, next); setName(''); setMessage('Template saved for you.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); }
  }
  function reuse(template: WorkbenchTemplate) {
    const { ids, dropped } = applyTemplate(template);
    setChosen(new Set(ids));
    if (template.participantIds) setTeam(Object.fromEntries(template.participantIds.flatMap(id => { const p = participantById(id); return p ? [[id, p.defaultAuthority]] : []; })));
    setMessage(dropped.length ? `Left out: ${dropped.map(d => `${byId(d.id)?.name ?? d.id} (${d.why})`).join(' ')}` : `Applied “${template.name}”.`);
  }

  if (!open) return <button type="button" className="btn btn-quiet wb-open" onClick={() => setOpen(true)}>Working setup · {proposal.kind}</button>;
  const standalone = brief.decisions.filter(d => !d.startsWith('Resolve:'));
  const needsPerson = brief.decisions.length > 0;
  const sample = snapshot?.source === 'fixture';
  return (
    <section className="wb" role="region" aria-labelledby={`wb-title-${task.id}`}>
      <div className="wb-head"><h3 id={`wb-title-${task.id}`}>Working setup</h3><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Close</button></div>
      <p className="wb-sub">Looks like <strong>{proposal.kind}</strong> work. Suggested by rules, not by an AI model. Nothing runs until you approve.</p>

      <label className="wb-env">Environment <select value={environment} aria-label="Environment" onChange={event => setEnvironment(event.target.value as 'organization' | 'personal')}>
        <option value="organization">{contexts.organization.name}</option><option value="personal">{contexts.personal.name}</option>
      </select></label>

      <div className="wb-org" aria-label="Organizational capabilities">
        <h4>{context.kind === 'personal' ? 'Your own capabilities' : 'Organization capabilities'}</h4>
        {snapshotError && <p className="wb-flag is-decision">{snapshotError}</p>}
        {!snapshot && !snapshotError && <p className="wb-sub">Reading capabilities…</p>}
        {sample && <p className="wb-sample">Sample data for contract testing. These brains are not provided by QuestBase and nothing runs behind them.</p>}
        {org && org.note && !org.suggested.length && <p className="wb-sub">{org.note}</p>}
        {org && org.suggested.length > 0 && <ul className="wb-list">
          {org.suggested.map(({ brain, why }) => {
            const on = brain.id in brains; const level = brains[brain.id] ?? 'observe';
            return (
              <li key={brain.id}>
                <label><input type="checkbox" checked={on} onChange={() => toggleBrain(brain.id, brain.ceiling === 'execute' ? 'propose' : brain.ceiling)} /> <span className="wb-name">{brain.name}</span> <span className={`wb-state is-${brain.state}`}>{brain.state}</span></label>
                <small>{why}</small>
                <small>Accountable: {brain.accountable.join(', ') || 'not recorded'} · escalates to {brain.escalatesTo || 'not recorded'}</small>
                {on && <div className="wb-auth"><label>Delegate for this task only <select value={level} aria-label={`${brain.name} delegated authority`} onChange={event => setBrains(was => ({ ...was, [brain.id]: event.target.value as Authority }))}>
                  {AUTHORITY_LEVELS.map(l => { const blocked = rank(l) > rank(brain.ceiling) || l === 'execute'; return <option key={l} value={l} disabled={blocked}>{l}{rank(l) > rank(brain.ceiling) ? ` (above ${brain.name}’s ceiling)` : l === 'execute' ? ' (needs a connected runtime)' : ''}</option>; })}
                </select></label><small>{AUTHORITY_LABELS[level]} You are the person authorizing this.</small></div>}
              </li>);
          })}
        </ul>}
        {org && org.unusable.length > 0 && <ul className="wb-plain">{org.unusable.map(u => <li key={u.brain.id}><span className="wb-state is-unavailable">{u.brain.state}</span> {u.why}</li>)}</ul>}
      </div>

      <div className="wb-overseer" aria-label="Overseer summary">
        <h4>Overseer’s picture</h4>
        <ul className="wb-plain">{brief.picture.map(line => <li key={line}>{line}</li>)}</ul>
        {brief.conflicts.length > 0 && <ul className="wb-flags">{brief.conflicts.map(c => <li key={c}><strong>Conflict:</strong> {c}</li>)}</ul>}
        {brief.missing.length > 0 && <p className="wb-flag"><strong>Missing:</strong> {brief.missing.join(', ')}.</p>}
        {needsPerson && <p className="wb-flag is-decision"><strong>Needs your decision:</strong> {[...(brief.conflicts.length ? [`${brief.conflicts.length} conflict${brief.conflicts.length === 1 ? '' : 's'} above`] : []), ...standalone].join('; ')}.</p>}
      </div>

      <h4>Task roles</h4>
      <ul className="wb-list">
        {brief.recommended.map(rec => {
          const p = participantById(rec.id)!; const on = rec.id in team; const level = team[rec.id] ?? rec.authority;
          const findings = brief.findings.filter(f => f.participant === rec.id);
          return (
            <li key={rec.id}>
              <label><input type="checkbox" checked={on} onChange={() => toggleTeam(rec.id, rec.authority)} /> <span className="wb-name">{p.name}</span> <span className={`wb-state is-${rec.state}`}>{rec.state}</span></label>
              <small>{rec.why}</small>
              {on && <div className="wb-auth"><label>Authority <select value={level} aria-label={`${p.name} authority`} onChange={event => setTeam(was => ({ ...was, [rec.id]: effectiveAuthority(p, event.target.value as Authority) }))}>
                {AUTHORITY_LEVELS.map(l => <option key={l} value={l} disabled={rank(l) > rank(p.ceiling)}>{l}{rank(l) > rank(p.ceiling) ? ' (needs a connected runtime)' : ''}</option>)}
              </select></label><small>{AUTHORITY_LABELS[level]}</small></div>}
              {on && findings.length > 0 && <ul className="wb-findings">{findings.map((f, i) => <li key={i} className={`is-${f.severity}`}>{f.text} <em>from {f.evidence.join(', ')}</em></li>)}</ul>}
            </li>);
        })}
      </ul>

      <h4>Tools and frameworks</h4>
      <ul className="wb-list">
        {proposal.picks.map(pick => { const entry = byId(pick.capabilityId); return (
          <li key={pick.capabilityId}>
            <label><input type="checkbox" checked={chosen.has(entry.id)} onChange={() => toggle(entry.id)} /> <span className="wb-name">{entry.name}</span> <span className={`wb-state is-${entry.state}`}>{entry.state}</span></label>
            <small>{pick.why}</small>
          </li>); })}
      </ul>
      {proposal.missing.length > 0 && <div className="wb-missing"><h4>Would help, not available</h4><ul>{proposal.missing.map(m => <li key={m.capabilityId}><span className="wb-state is-unavailable">{byId(m.capabilityId).state}</span> {m.why}</li>)}</ul></div>}
      {mine.length > 0 && <div className="wb-templates"><h4>Your templates</h4>{mine.map(t => <button key={t.id} type="button" className="btn btn-quiet" onClick={() => reuse(t)}>{t.name}</button>)}</div>}
      <div className="wb-actions">
        <button type="button" className="btn btn-primary" disabled={!editable || busy || (brainIds.length > 0 && !snapshot)} onClick={use}>Approve this setup</button>
        <input className="wb-name-input" value={name} placeholder="Save as template…" aria-label="Template name" maxLength={60} onChange={event => setName(event.target.value)} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
      <p className="wb-msg" role="status">{message}</p>
    </section>
  );
}
