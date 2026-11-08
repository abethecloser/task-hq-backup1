// Working setup for a task: what could help, who (which specialist role) should look, why, and what is not
// actually connected. Discovery and every specialist reading are rule based (core/workbench.ts,
// core/participants.ts) and labelled as such: selecting a specialist never means a model is connected.
// Choosing a setup records one history line through the existing comment action; templates are personal
// and stay in this browser.
import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../core/contract.ts';
import { AUTHORITY_LEVELS, AUTHORITY_LABELS, effectiveAuthority, participantById, rank } from '../core/participants.ts';
import type { Authority, ParticipantId } from '../core/participants.ts';
import { CATALOG, analyze, applyTemplate, saveTemplate, workbenchNote } from '../core/workbench.ts';
import type { WorkbenchTemplate } from '../core/workbench.ts';
import type { Quest } from '../ui/useQuest.ts';

const key = (actor: string) => `quest.workbench.templates.${actor}`;
const load = (actor: string): WorkbenchTemplate[] => { try { const raw = JSON.parse(localStorage.getItem(key(actor)) ?? '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; } };
const persist = (actor: string, list: WorkbenchTemplate[]) => { try { localStorage.setItem(key(actor), JSON.stringify(list)); } catch { /* private mode: templates last for this visit only */ } };

export function WorkbenchPanel({ quest, task, editable }: { quest: Quest; task: Task; editable: boolean }) {
  const { state, actor, now, dispatch } = quest;
  const minute = Math.floor(now / 60000);
  const { proposal, brief } = useMemo(() => analyze(state, task, now), [state, task, minute]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState<Partial<Record<ParticipantId, Authority>>>({});
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>(() => load(actor));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // New analysis (another task, or the task changed): start from the full recommendation; the person trims it.
  const signature = `${task.id}|${proposal.kind}|${brief.recommended.map(r => r.id).join(',')}|${proposal.picks.map(p => p.capabilityId).join(',')}`;
  useEffect(() => {
    setChosen(new Set(proposal.picks.map(p => p.capabilityId)));
    setTeam(Object.fromEntries(brief.recommended.map(r => [r.id, r.authority])));
    setMessage('');
  }, [signature]);

  const byId = (id: string) => CATALOG.find(c => c.id === id)!;
  const toggle = (id: string) => setChosen(was => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleTeam = (id: ParticipantId, authority: Authority) => setTeam(was => { const next = { ...was }; if (id in next) delete next[id]; else next[id] = authority; return next; });
  const mine = templates.filter(t => t.owner === actor);
  const selectedIds = Object.keys(team) as ParticipantId[];

  async function use() {
    if (!chosen.size && !selectedIds.length) { setMessage('Pick at least one.'); return; }
    setBusy(true);
    const specialists = selectedIds.map(id => ({ name: participantById(id)!.name, authority: effectiveAuthority(participantById(id)!, team[id]!) }));
    const result = await dispatch({ type: 'task/comment', id: task.id, note: workbenchNote([...chosen].map(id => byId(id).name), proposal.kind, specialists) });
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
  return (
    <section className="wb" role="region" aria-labelledby={`wb-title-${task.id}`}>
      <div className="wb-head"><h3 id={`wb-title-${task.id}`}>Working setup</h3><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Close</button></div>
      <p className="wb-sub">Looks like <strong>{proposal.kind}</strong> work. Suggested by rules, not by an AI model. Nothing runs until you use it.</p>

      <div className="wb-overseer" aria-label="Overseer summary">
        <h4>Overseer’s picture</h4>
        <ul className="wb-plain">{brief.picture.map(line => <li key={line}>{line}</li>)}</ul>
        {brief.conflicts.length > 0 && <ul className="wb-flags">{brief.conflicts.map(c => <li key={c}><strong>Conflict:</strong> {c}</li>)}</ul>}
        {brief.missing.length > 0 && <p className="wb-flag"><strong>Missing:</strong> {brief.missing.join(', ')}.</p>}
        {needsPerson && <p className="wb-flag is-decision"><strong>Needs your decision:</strong> {[...(brief.conflicts.length ? [`${brief.conflicts.length} conflict${brief.conflicts.length === 1 ? '' : 's'} above`] : []), ...standalone].join('; ')}.</p>}
      </div>

      <h4>Specialists</h4>
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
        <button type="button" className="btn btn-primary" disabled={!editable || busy} onClick={use}>Approve this setup</button>
        <input className="wb-name-input" value={name} placeholder="Save as template…" aria-label="Template name" maxLength={60} onChange={event => setName(event.target.value)} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
      <p className="wb-msg" role="status">{message}</p>
    </section>
  );
}
