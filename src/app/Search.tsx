import { Select } from '../ui/Select.tsx';
import { useEffect, useMemo, useState } from 'react';
import type { Quest } from '../ui/useQuest.ts';
import type { InboxData } from './Inbox.tsx';
import { toolIndex } from '../core/tools/references.ts';
import type { ToolsState } from '../core/tools/estimating.ts';
import { messageIndex } from '../core/inbox.ts';
import { referenceScope } from '../core/references.ts';
import type { ReferenceDocument } from '../core/references.ts';
import { searchReferences, workspaceIndex } from '../core/reference-index.ts';
import type { SearchKind, SearchQuery, SearchResult } from '../core/reference-index.ts';
import { ReferenceInput } from '../ui/ReferenceEditor.tsx';
import { useLive } from './LiveContext.tsx';
const GROUPS: { id: SearchKind; label: string }[] = [{ id: 'tasks', label: 'Tasks' }, { id: 'messages', label: 'Messages' }, { id: 'relationships', label: 'Leads & relationships' }, { id: 'notes', label: 'Notes & comments' }, { id: 'activity', label: 'Activity & handoffs' }, { id: 'tools', label: 'Estimates & proposals' }];
function params() { return new URLSearchParams(location.hash.split('?')[1] ?? ''); }
function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  let at = 0; const out = [];
  for (const [a, b] of ranges) { if (a < at || b > text.length) continue; out.push(text.slice(at, a), <mark key={`${a}:${b}`}>{text.slice(a, b)}</mark>); at = b; }
  out.push(text.slice(at)); return <>{out}</>;
}
export function Search({ quest, data, tools, onOpen }: { quest: Quest; data: InboxData; tools?: ToolsState | null; onOpen: (result: SearchResult) => void }) {
  const live = useLive(), initial = params();
  const [text, setText] = useState(initial.get('q') ?? '');
  const [workspace, setWorkspace] = useState(initial.get('workspace') ?? '');
  const [person, setPerson] = useState(initial.get('person') ?? '');
  const [tag, setTag] = useState(initial.get('tag') ?? '');
  const [kind, setKind] = useState<SearchKind | ''>('');
  const [document, setDocument] = useState<ReferenceDocument>({ text: '', spans: [] });
  const [remote, setRemote] = useState<SearchResult[]>([]), [status, setStatus] = useState('');
  const index = useMemo(() => {
    const tasks = workspaceIndex(quest.state, quest.actor, quest.now);
    if (quest.state.focus?.employee === quest.actor) return tasks;
    if (tools) tasks.records.push(...toolIndex(tools, referenceScope(quest.state, quest.actor), quest.state.workspace.name).records);
    if (!data.messaging) return tasks;
    const messages = messageIndex(data.messaging, quest.actor, { id: data.current.id, scope: referenceScope(quest.state, quest.actor) });
    const scopes = new Map(tasks.scopes.map(s => [s.workspaceId, s]));
    for (const s of messages.scopes) { const old = scopes.get(s.workspaceId); scopes.set(s.workspaceId, old ? { ...old, people: [...new Map([...old.people, ...s.people].map(p => [p.id, p])).values()], tags: [...new Set([...old.tags, ...s.tags])] } : s); }
    return { records: [...tasks.records, ...messages.records], scopes: [...scopes.values()] };
  }, [quest.state, quest.actor, Math.floor(quest.now / 60000), data.messaging, data.current.id, tools]);
  const selectedPerson = document.text === text ? document.spans.find(s => s.kind === 'person')?.id : undefined;
  const query: SearchQuery = { text, kind, workspaceId: workspace || undefined, personId: person || selectedPerson, tag: tag || undefined, limit: 200 };
  const signature = JSON.stringify(query);
  useEffect(() => {
    const change = () => { const p = params(); setText(p.get('q') ?? ''); setWorkspace(p.get('workspace') ?? ''); setPerson(p.get('person') ?? ''); setTag(p.get('tag') ?? ''); setDocument({ text: '', spans: [] }); };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    setRemote([]);
    if (!live || (!text.trim() && !person && !tag)) { setStatus(''); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      setStatus('Searching authorized workspaces…');
      const orgs = live.searchOrgs ?? [live.org];
      const replies = await Promise.all(orgs.filter(o => !workspace || o.id === workspace).map(async org => {
        try { const r = await live.client.functions.invoke('dispatch', { body: { op: 'search', orgId: org.id, query: JSON.parse(signature) } });
          if (r.error || !r.data?.ok || !Array.isArray(r.data.results)) return { results: [] as SearchResult[], failed: true };
          return { results: (r.data.results as SearchResult[]).filter(r => r.workspaceId === org.id), failed: false };
        } catch { return { results: [] as SearchResult[], failed: true }; }
      }));
      if (!alive) return;
      setRemote(replies.flatMap(r => r.results));
      setStatus(replies.some(r => r.failed) ? 'Some shared sources are unavailable. Cross-workspace search needs the candidate server release; unavailable results are not counted.' : 'Current membership checked by each workspace server.');
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [live, signature]);
  const local = searchReferences(index, query);
  const results = [...new Map([...local, ...remote].map(r => [`${r.workspaceId}:${r.id}`, r])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const names = new Map<string, string>([[quest.state.workspace.tenantId, quest.state.workspace.name]]);
  for (const r of index.records) names.set(r.workspaceId, r.workspaceName);
  for (const o of live?.searchOrgs ?? []) names.set(o.id, o.name);
  const scope = { ...referenceScope(quest.state, quest.actor), people: [...new Map(index.scopes.flatMap(s => s.people).map(p => [p.id, p])).values()] };
  const searching = !!text.trim() || !!person || !!tag;
  return <div className="view global-search"><header className="view-head"><div><p className="eyebrow">Authorized workspaces · one search</p><h1>Search Task-HQ</h1><p className="lede">Find tasks, conversations, contacts and operational notes using words, @people or #tags.</p></div></header>
    <div className="panel search-controls">
      <ReferenceInput referenceScope={{ ...scope, canCreateTags: false }} type="text" autoFocus aria-label="Search authorized content" placeholder="Search words, @Abraham or #MapleAve" value={text} onChange={e => setText(e.target.value)} onReferencesChange={setDocument} />
      <div className="search-filters"><label>Workspace<Select aria-label="Search workspace" value={workspace} onChange={e => setWorkspace(e.target.value)}><option value="">All authorized workspaces</option>{[...names].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></label>
        <label>Content<Select aria-label="Search content type" value={kind} onChange={e => setKind(e.target.value as SearchKind | '')}><option value="">All types</option>{GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</Select></label>
        {(person || tag) && <button className="btn btn-sm" onClick={() => { setPerson(''); setTag(''); }}>Clear reference filter {tag ? `#${tag}` : scope.people.find(p => p.id === person)?.name ?? ''}</button>}
      </div>
    </div>
    <p className="boundary">{live ? status || 'Searches only current memberships. Messaging is unavailable until connected.' : 'Synthetic local search. Private channels are excluded before matching, counts and snippets.'}</p>
    <p role="status" className="search-status">{searching ? `${results.length}${results.length >= 200 ? '+' : ''} matching records available` : 'Enter a phrase, person or tag to search.'}</p>
    {searching && GROUPS.map(g => { const rows = results.filter(r => r.kind === g.id); return rows.length ? <section className="search-group" key={g.id}><h2>{g.label} <small>{rows.length}</small></h2><ul>{rows.map(r => <li key={`${r.workspaceId}:${r.id}`}><button className="search-result" onClick={() => onOpen(r)}><span className="search-result-meta">{r.workspaceName} · {new Date(r.updatedAt).toLocaleDateString()}</span><strong>{r.title}</strong><span><Highlight text={r.snippet} ranges={r.highlights} /></span></button></li>)}</ul></section> : null; })}
  </div>;
}
