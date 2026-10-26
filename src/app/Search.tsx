import { useEffect, useMemo, useRef, useState } from 'react';
import type { Quest } from '../ui/useQuest.ts';
import type { InboxData } from './Inbox.tsx';
import { toolIndex } from '../core/tools/references.ts';
import type { ToolsState } from '../core/tools/estimating.ts';
import { messageIndex } from '../core/inbox.ts';
import { referenceScope } from '../core/references.ts';
import type { ReferenceDocument } from '../core/references.ts';
import { searchReferences, workspaceIndex } from '../core/reference-index.ts';
import type { SearchKind, SearchQuery, SearchResult } from '../core/reference-index.ts';
import { ReferenceInput, SEARCH_EVENT } from '../ui/ReferenceEditor.tsx';
import type { SearchRequest } from '../ui/ReferenceEditor.tsx';
import { useDropdown } from '../ui/useDropdown.tsx';
import { useLive } from './LiveContext.tsx';
const GROUPS: { id: SearchKind; label: string }[] = [{ id: 'tasks', label: 'Tasks' }, { id: 'messages', label: 'Messages' }, { id: 'relationships', label: 'Leads & relationships' }, { id: 'notes', label: 'Notes & comments' }, { id: 'activity', label: 'Activity & handoffs' }, { id: 'tools', label: 'Estimates & proposals' }];
/** Rows shown per group in the top-bar results; the heading keeps the full count. */
const PER_GROUP = 6;
function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  let at = 0; const out = [];
  for (const [a, b] of ranges) { if (a < at || b > text.length) continue; out.push(text.slice(at, a), <mark key={`${a}:${b}`}>{text.slice(a, b)}</mark>); at = b; }
  out.push(text.slice(at)); return <>{out}</>;
}
/** One search for the whole app, in the top bar: results drop down under the field and open in place. */
export function TopSearch({ quest, data, tools, onOpen }: { quest: Quest; data: InboxData; tools?: ToolsState | null; onOpen: (result: SearchResult) => void }) {
  const live = useLive();
  const [text, setText] = useState('');
  const [reference, setReference] = useState<SearchRequest>({});
  const [document, setDocument] = useState<ReferenceDocument>({ text: '', spans: [] });
  const [remote, setRemote] = useState<SearchResult[]>([]), [status, setStatus] = useState('');
  const [shown, setShown] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLFormElement>(null), input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null);
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
  const query: SearchQuery = { text, kind: '', workspaceId: reference.workspace || undefined, personId: reference.person || selectedPerson, tag: reference.tag || undefined, limit: 200 };
  const signature = JSON.stringify(query);
  useEffect(() => {
    const take = (request: SearchRequest) => { setText(''); setDocument({ text: '', spans: [] }); setReference(request); setShown(true); setActive(0); input.current?.focus(); };
    const onRequest = (event: Event) => take((event as CustomEvent<SearchRequest>).detail ?? {});
    window.addEventListener(SEARCH_EVENT, onRequest);
    // Old #/search links (bookmarks, shared URLs) open here; the page itself no longer exists.
    if (location.hash.startsWith('#/search')) { const p = new URLSearchParams(location.hash.split('?')[1] ?? ''); setText(p.get('q') ?? ''); setReference({ workspace: p.get('workspace') ?? undefined, person: p.get('person') ?? undefined, tag: p.get('tag') ?? undefined }); setShown(true); }
    return () => window.removeEventListener(SEARCH_EVENT, onRequest);
  }, []);
  useEffect(() => {
    setRemote([]);
    if (!live || (!text.trim() && !reference.person && !reference.tag)) { setStatus(''); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      setStatus('Searching authorized workspaces…');
      const orgs = live.searchOrgs ?? [live.org];
      const replies = await Promise.all(orgs.filter(o => !reference.workspace || o.id === reference.workspace).map(async org => {
        try { const r = await live.client.functions.invoke('dispatch', { body: { op: 'search', orgId: org.id, query: JSON.parse(signature) } });
          if (r.error || !r.data?.ok || !Array.isArray(r.data.results)) return { results: [] as SearchResult[], failed: true };
          return { results: (r.data.results as SearchResult[]).filter(r => r.workspaceId === org.id), failed: false };
        } catch { return { results: [] as SearchResult[], failed: true }; }
      }));
      if (!alive) return;
      setRemote(replies.flatMap(r => r.results));
      setStatus(replies.some(r => r.failed) ? 'Some shared sources are unavailable; their results are not counted.' : '');
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [live, signature]);
  const searching = !!text.trim() || !!reference.person || !!reference.tag;
  const local = searching ? searchReferences(index, query) : [];
  const results = [...new Map([...local, ...remote].map(r => [`${r.workspaceId}:${r.id}`, r])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = GROUPS.map(g => { const all = results.filter(r => r.kind === g.id); return { ...g, total: all.length, rows: all.slice(0, PER_GROUP) }; }).filter(g => g.total);
  const flat = groups.flatMap(g => g.rows);
  const scope = { ...referenceScope(quest.state, quest.actor), people: [...new Map(index.scopes.flatMap(s => s.people).map(p => [p.id, p])).values()] };
  const label = reference.tag ? `#${reference.tag}` : reference.person ? `@${scope.people.find(p => p.id === reference.person)?.name ?? 'person'}` : '';
  const close = () => setShown(false);
  useDropdown({ open: shown && searching, onClose: close, trigger: () => input.current, content: () => panel.current, region: () => root.current });
  function pick(result: SearchResult | undefined) {
    if (!result) return;
    setShown(false); setText(''); setReference({}); setDocument({ text: '', spans: [] }); input.current?.blur();
    onOpen(result);
  }
  return (
    <form ref={root} className={`search-field top-search ${label ? 'has-reference' : ''}`} role="search"
      onSubmit={event => { event.preventDefault(); pick(flat[active] ?? flat[0]); }}>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /></svg>
      {label && <button type="button" className="top-search-ref" aria-label={`Remove ${label}`} onClick={() => { setReference({}); input.current?.focus(); }}>{label} <span aria-hidden="true">×</span></button>}
      <ReferenceInput ref={input} referenceScope={{ ...scope, canCreateTags: false }} type="text" value={text}
        placeholder="Search tasks, people, projects" aria-label="Search"
        role="combobox" aria-expanded={shown && searching} aria-controls="top-search-results" aria-autocomplete="list" aria-activedescendant={shown && flat[active] ? `top-search-${active}` : undefined}
        onReferencesChange={setDocument} onFocus={() => setShown(true)}
        onChange={event => { setText(event.target.value); setShown(true); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { if (shown && searching) { event.preventDefault(); close(); } else input.current?.blur(); }
          else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && flat.length) { event.preventDefault(); setShown(true); setActive(current => (current + (event.key === 'ArrowDown' ? 1 : flat.length - 1)) % flat.length); }
          else if (event.key === 'Backspace' && !text && label) setReference({});
        }} />
      {shown && searching && (
        <div ref={panel} className="top-search-results" id="top-search-results" role="listbox" aria-label="Search results">
          {groups.length === 0 && <p className="top-search-none">No matches{label ? ` for ${label}` : ''}.</p>}
          {groups.map(g => (
            <section className="top-search-group" key={g.id} aria-label={g.label}>
              <h2>{g.label} <small>{g.total}</small></h2>
              {g.rows.map(r => { const at = flat.indexOf(r); return (
                <button type="button" key={`${r.workspaceId}:${r.id}`} id={`top-search-${at}`} role="option" aria-selected={at === active} className={`search-result ${at === active ? 'is-active' : ''}`}
                  onPointerEnter={() => setActive(at)} onClick={() => pick(r)}>
                  <span className="search-result-meta">{r.workspaceName} · {new Date(r.updatedAt).toLocaleDateString()}</span>
                  <strong>{r.title}</strong>
                  <span><Highlight text={r.snippet} ranges={r.highlights} /></span>
                </button>
              ); })}
            </section>
          ))}
          {status && <p className="top-search-note">{status}</p>}
        </div>
      )}
    </form>
  );
}
