import { Select } from '../ui/Select.tsx';
import { ReferencedText } from '../ui/ReferenceEditor.tsx';
import { useState } from 'react';
import type { Quest } from '../ui/useQuest.ts';
import { LeadCard } from './SpeedToLead.tsx';
import { responseLeague } from '../core/relationships.ts';
import { coordinates, manages, observes } from '../core/selectors.ts';

export function WorkLabels({ quest }: { quest: Quest }) {
  const [label, setLabel] = useState('');
  const [personId, setPerson] = useState('');
  // Same rule as the engine: Owner and Admin configure labels (work titles grant nothing).
  const manager = manages(quest.state.people.find(p => p.id === quest.actor));
  return <section className="panel relationship-panel"><h3>Work-role labels</h3><p>Organization-scoped descriptions only. Labels do not grant permissions or create memberships.</p>
    <p>{quest.state.people.map(p => `${p.name}: ${quest.state.workLabels?.[p.id] ?? p.title}`).join(' · ')}</p>
    {quest.backend.supports?.workLabels === false ? <p className="boundary">Custom label configuration awaits the candidate server release.</p> : manager ? <form className="inline-form" onSubmit={async e => { e.preventDefault(); const r = await quest.dispatch({ type: 'roles/label', personId: personId || undefined, label }); if (r.ok) setLabel(''); }}>
      <Select aria-label="Label applies to" value={personId} onChange={e => setPerson(e.target.value)}><option value="">Define label only</option>{quest.state.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <input aria-label="Search or enter work-role label" list="work-label-options" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} required placeholder="Search or enter custom role" />
      <datalist id="work-label-options">{[...new Set(['Operations & Systems Lead', ...quest.state.people.map(p => p.title), ...(quest.state.workRoles ?? [])])].map(l => <option key={l} value={l} />)}</datalist><button className="btn btn-sm" disabled={!label.trim()}>Save label</button>
    </form> : <p className="muted">An owner or admin configures these labels.</p>}
  </section>;
}

export function Relationships({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [tags, setTags] = useState('');
  const records = quest.state.leads.filter(l => `${l.name} ${l.phone} ${l.email ?? ''} ${l.need} ${(l.relationshipTags ?? []).join(' ')} ${quest.state.people.find(p => p.id === l.assignee)?.name ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const lead = quest.state.leads.find(l => l.id === selected);
  const me = quest.state.people.find(p => p.id === quest.actor);
  // Same rule as the engine: the lead owner, or a supervisor, admin or owner.
  const tagsEditable = !!lead && quest.backend.supports?.leadOwnership !== false && !observes(me) && (lead.assignee === quest.actor || coordinates(me));
  return <div className="view"><header className="view-head"><div><p className="eyebrow">Existing inquiry identities · {quest.backend.kind === 'live' ? 'Workspace records' : 'Synthetic local records'}</p><h1>Relationship Vault</h1><p className="lede">Contacts, opportunities and next actions share the First Response records.</p></div></header>
    <input className="vault-search" autoFocus aria-label="Search relationships" placeholder="Search name, contact, owner, opportunity or tag" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="relationship-list">{records.map(l => <button key={l.id} aria-pressed={selected === l.id} className={`panel relationship-choice ${selected === l.id ? 'is-selected' : ''}`} onClick={() => { setSelected(l.id); setTags((l.relationshipTags ?? []).join(', ')); }}><strong>{l.name}</strong><span>{l.email || l.phone || 'Contact details missing'}</span><span>{l.need} · {l.stage}</span><small>{l.relationshipTags?.map(t => `#${t}`).join(' ') || 'No tags'}</small></button>)}</div>
    {!records.length && <p className="empty">No relationships match. Add a synthetic inquiry in First Response to begin.</p>}
    {lead && <section className="relationship-panel"><h3>Relationship details & next actions</h3><LeadCard quest={quest} lead={lead} onOpen={onOpen} />
      {tagsEditable && <form className="inline-form" onSubmit={e => { e.preventDefault(); void quest.dispatch({ type: 'lead/tags', id: lead.id, tags: tags.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean) }); }}><input aria-label="Relationship tags" placeholder="Tags, separated by commas" value={tags} onChange={e => setTags(e.target.value)} /><button className="btn btn-sm">Save tags</button></form>}
      <h3>Relationship history</h3><ol className="history">{quest.state.events.filter(e => e.leadId === lead.id).map(e => <li key={e.id}><time>{new Date(e.at).toLocaleString()}</time> <ReferencedText text={e.text} document={e.references?.text} /></li>)}</ol>
      <h3>Linked tasks</h3>{quest.state.tasks.filter(t => t.leadId === lead.id).map(t => <p key={t.id}><button className="link" onClick={() => onOpen(t.id)}>{t.title} · {t.status} · {t.due || 'No date'}</button></p>)}
    </section>}
  </div>;
}

export function ResponseLeague({ quest }: { quest: Quest }) {
  const rows = responseLeague(quest.state);
  return <details className="panel relationship-panel"><summary>Response League · optional outcome preview</summary><p className="boundary">{quest.backend.kind === 'live' ? 'Workspace preview' : 'Synthetic preview'} · no prizes or external reporting. Reached contact: 10; completed follow-up: 20; completed handoff: 30. Each outcome counts once per inquiry, contact credited to its logger and completed tasks to their recorded owners. Claims and attempt counts earn zero.</p>
    <ol>{rows.map(row => <li key={row.id}><strong>{row.name} · {row.points} points</strong> <progress max={100} value={row.points % 100} aria-label={`${row.name}: ${row.points % 100} of 100 points toward next level`} /> Level {1 + Math.floor(row.points / 100)}</li>)}</ol>
  </details>;
}
