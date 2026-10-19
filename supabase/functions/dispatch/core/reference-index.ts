// Ephemeral index over authorized source records, rebuilt on revision changes. Never
// caches bodies across users and never computes counts/snippets before visibility.
import type { QuestState } from './contract.ts';
import type { ReferenceDocument, ReferenceFields, ReferenceScope } from './references.ts';
import { canonicalTag, referenceDocument, referenceScope, tagKey } from './references.ts';
import { activeGrant, inFocus } from './selectors.ts';
export type SearchKind = 'tasks' | 'messages' | 'relationships' | 'notes' | 'activity' | 'tools';
export interface SearchTarget { view: string; id: string; channelId?: string; messageId?: string }
export interface SearchRecord { id: string; workspaceId: string; workspaceName: string; kind: SearchKind; title: string; fields: ReferenceFields; target: SearchTarget; updatedAt: number }
export interface SearchResult extends Omit<SearchRecord, 'fields'> { snippet: string; highlights: [number, number][]; matchedReferences: string[] }
export interface SearchQuery { text: string; kind?: SearchKind | ''; workspaceId?: string; personId?: string; tag?: string; limit?: number }
export interface SearchIndex { records: SearchRecord[]; scopes: ReferenceScope[] }
export function workspaceIndex(state: QuestState, actor: string, now: number): SearchIndex {
  const scope = referenceScope(state, actor);
  if (!scope.people.some(p => p.id === actor)) return { records: [], scopes: [] };
  const focused = inFocus(state, actor), grant = activeGrant(state, actor, now);
  const taskVisible = (id: string) => !focused || state.focus?.taskId === id || grant?.section === 'company-work' || grant?.section === 'needs-attention';
  const leadVisible = !focused || grant?.section === 'leads';
  const records: SearchRecord[] = [];
  const fields = (values: Record<string, string>, saved?: ReferenceFields): ReferenceFields => Object.fromEntries(Object.entries(values).map(([key, text]) => [key, referenceDocument(text, scope, saved?.[key])]));
  const add = (id: string, kind: SearchKind, title: string, values: Record<string, string>, target: SearchTarget, at: number, saved?: ReferenceFields) => records.push({ id, kind, title, fields: fields(values, saved), target, updatedAt: at, workspaceId: state.workspace.tenantId, workspaceName: state.workspace.name });
  for (const t of state.tasks) if (taskVisible(t.id)) add(`task:${t.id}`, 'tasks', t.title, { title: t.title, description: t.description, nextAction: t.nextAction, waitingOn: t.waitingOn, tags: (t.tags ?? []).map(t => `#${t}`).join(' ') }, { view: 'task', id: t.id }, t.updatedAt, t.references);
  for (const lead of state.leads) if (leadVisible) {
    add(`lead:${lead.id}`, 'relationships', lead.name, { name: lead.name, need: lead.need, blocker: lead.blocker, tags: (lead.relationshipTags ?? []).map(t => `#${t}`).join(' ') }, { view: 'leads', id: lead.id }, lead.updatedAt, lead.references);
    lead.attempts.forEach((a, i) => add(`attempt:${lead.id}:${i}`, 'notes', `${lead.name} · contact note`, { note: a.note }, { view: 'leads', id: lead.id }, a.at, a.references));
  }
  if (!focused) for (const f of state.feedback) {
    add(`feedback:${f.id}`, 'notes', f.title, { title: f.title, body: f.body }, { view: 'feedback', id: f.id }, f.updatedAt, f.references);
    for (const r of f.replies) add(`reply:${f.id}:${r.id}`, 'notes', `${f.title} · reply`, { body: r.body }, { view: 'feedback', id: f.id }, r.at, r.references);
  }
  for (const e of state.events) {
    if (e.undone || (e.taskId && !taskVisible(e.taskId)) || (e.leadId && !leadVisible) || (focused && !e.taskId && !e.leadId)) continue;
    // An orphaned event never exposes the contents of a deleted parent.
    if ((e.taskId && !state.tasks.some(t => t.id === e.taskId)) || (e.leadId && !state.leads.some(l => l.id === e.leadId))) continue;
    add(`event:${e.id}`, e.actionType === 'task/comment' ? 'notes' : 'activity', e.kind === 'handoff' ? 'Handoff' : 'Activity annotation', { text: e.text }, e.taskId ? { view: 'task', id: e.taskId } : e.leadId ? { view: 'leads', id: e.leadId } : { view: 'activity', id: e.id }, e.at, e.references);
  }
  return { records, scopes: [scope] };
}
function plainHighlights(text: string, terms: string[]): [number, number][] {
  const out: [number, number][] = [], lower = text.toLocaleLowerCase();
  for (const term of terms.filter(Boolean)) { let at = lower.indexOf(term.toLocaleLowerCase()); while (at >= 0) { out.push([at, at + term.length]); at = lower.indexOf(term.toLocaleLowerCase(), at + term.length); } }
  return out.sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((a, span) => { const last = a[a.length - 1]; if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else a.push([...span]); return a; }, []);
}
export function searchReferences(index: SearchIndex, query: SearchQuery): SearchResult[] {
  const raw = query.text.trim().slice(0, 300);
  const results: SearchResult[] = [];
  for (const record of index.records) {
    if ((query.workspaceId && record.workspaceId !== query.workspaceId) || (query.kind && record.kind !== query.kind)) continue;
    const scope = index.scopes.find(s => s.workspaceId === record.workspaceId);
    if (!scope) continue;
    const parsed = referenceDocument(raw, scope);
    const refs = parsed.spans;
    const tags = [...raw.matchAll(/(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map(m => canonicalTag(m[1]!, scope) ?? tagKey(m[1]!));
    if (query.tag) tags.push(canonicalTag(query.tag, scope) ?? tagKey(query.tag));
    const people = [...refs.filter(r => r.kind === 'person').map(r => r.id), ...(query.personId ? [query.personId] : [])];
    const documents = Object.values(record.fields), spans = documents.flatMap(d => d.spans);
    if (people.some(id => !spans.some(s => s.kind === 'person' && s.id === id)) || tags.some(id => !spans.some(s => s.kind === 'tag' && s.id === id))) continue;
    let plain = raw;
    for (const ref of [...refs].sort((a, b) => b.start - a.start)) plain = plain.slice(0, ref.start) + ' ' + plain.slice(ref.end);
    plain = plain.replace(/(?:^|\s)#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu, ' ');
    const terms = plain.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const haystack = `${record.title} ${documents.map(d => d.text).join(' ')}`.toLocaleLowerCase();
    if (terms.some(term => !haystack.includes(term))) continue;
    const best = documents.find(d => d.spans.some(s => people.includes(s.id) || tags.includes(s.id)) || terms.some(t => d.text.toLocaleLowerCase().includes(t))) ?? documents[0] ?? { text: '', spans: [] };
    const at = Math.min(...[...plainHighlights(best.text, terms).map(s => s[0]), ...best.spans.filter(s => people.includes(s.id) || tags.includes(s.id)).map(s => s.start), 100000]);
    const start = Math.max(0, (at === 100000 ? 0 : at) - 55), end = Math.min(best.text.length, start + 240);
    const prefix = start ? '…' : '', snippet = prefix + best.text.slice(start, end) + (end < best.text.length ? '…' : '');
    const highlights = plainHighlights(snippet, terms);
    for (const s of best.spans) if ((people.includes(s.id) || tags.includes(s.id)) && s.start >= start && s.end <= end) highlights.push([s.start - start + prefix.length, s.end - start + prefix.length]);
    results.push({ ...record, fields: undefined, snippet, highlights: highlights.sort((a, b) => a[0] - b[0]), matchedReferences: [...new Set(spans.filter(s => people.includes(s.id) || tags.includes(s.id)).map(s => s.id))] } as SearchResult);
  }
  return results.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, Math.min(200, Math.max(1, query.limit ?? 100)));
}
