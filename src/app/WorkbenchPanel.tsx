// Working setup for a task: what could help, why, and what is not actually connected.
// Discovery is rule based (core/workbench.ts) and labelled as such. Choosing a setup records one history
// line on the task through the existing comment action; templates are personal and stay in this browser.
import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../core/contract.ts';
import { CATALOG, applyTemplate, propose, saveTemplate, workbenchNote } from '../core/workbench.ts';
import type { WorkbenchTemplate } from '../core/workbench.ts';
import type { Quest } from '../ui/useQuest.ts';

const key = (actor: string) => `quest.workbench.templates.${actor}`;
const load = (actor: string): WorkbenchTemplate[] => { try { const raw = JSON.parse(localStorage.getItem(key(actor)) ?? '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; } };
const persist = (actor: string, list: WorkbenchTemplate[]) => { try { localStorage.setItem(key(actor), JSON.stringify(list)); } catch { /* private mode: templates last for this visit only */ } };

export function WorkbenchPanel({ quest, task, editable }: { quest: Quest; task: Task; editable: boolean }) {
  const { actor, now, dispatch } = quest;
  const proposal = useMemo(() => propose(task), [task.id, task.title, task.nextAction, task.description, task.type]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<WorkbenchTemplate[]>(() => load(actor));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChosen(new Set(proposal.picks.map(p => p.capabilityId))); setMessage(''); }, [proposal]);

  const byId = (id: string) => CATALOG.find(c => c.id === id)!;
  const toggle = (id: string) => setChosen(was => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const mine = templates.filter(t => t.owner === actor);

  async function use() {
    if (!chosen.size) { setMessage('Pick at least one.'); return; }
    setBusy(true);
    const result = await dispatch({ type: 'task/comment', id: task.id, note: workbenchNote([...chosen].map(id => byId(id).name), proposal.kind) });
    setBusy(false);
    setMessage(result.ok ? 'Recorded on the task.' : `Not saved: ${result.error}`);
  }
  function save() {
    try {
      const next = saveTemplate(templates, { name, kind: proposal.kind, capabilityIds: [...chosen], owner: actor, now });
      setTemplates(next); persist(actor, next); setName(''); setMessage('Template saved for you.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); }
  }
  function reuse(template: WorkbenchTemplate) {
    const { ids, dropped } = applyTemplate(template);
    setChosen(new Set(ids));
    setMessage(dropped.length ? `Left out: ${dropped.map(d => `${byId(d.id)?.name ?? d.id} (${d.why})`).join(' ')}` : `Applied “${template.name}”.`);
  }

  if (!open) return <button type="button" className="btn btn-quiet wb-open" onClick={() => setOpen(true)}>Working setup · {proposal.kind}</button>;
  return (
    <section className="wb" role="region" aria-labelledby={`wb-title-${task.id}`}>
      <div className="wb-head"><h3 id={`wb-title-${task.id}`}>Working setup</h3><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Close</button></div>
      <p className="wb-sub">Looks like <strong>{proposal.kind}</strong> work. Suggested by rules, not by an AI model. Nothing runs until you use it.</p>
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
        <button type="button" className="btn btn-primary" disabled={!editable || busy} onClick={use}>Use this setup</button>
        <input className="wb-name-input" value={name} placeholder="Save as template…" aria-label="Template name" maxLength={60} onChange={event => setName(event.target.value)} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
      <p className="wb-msg" role="status">{message}</p>
    </section>
  );
}
