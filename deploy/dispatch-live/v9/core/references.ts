// One reference grammar for editors, persistence and retrieval. No identity/tag registry:
// people come from current membership; canonical tag ids are the existing taxonomy keys.
import type { Person, QuestState, Taxonomy } from './contract.ts';
export interface ReferenceSpan { kind: 'person' | 'tag'; id: string; workspaceId: string; start: number; end: number; label: string }
export interface ReferenceDocument { text: string; spans: ReferenceSpan[] }
export type ReferenceFields = Record<string, ReferenceDocument>;
export interface ReferenceScope { workspaceId: string; people: Person[]; tags: string[]; aliases?: Record<string, string>; canCreateTags: boolean }
export interface ReferenceSuggestion { kind: 'person' | 'tag'; id: string; label: string; detail: string; insert: string; create?: boolean }
export interface ReferenceSuggestions { start: number; end: number; items: ReferenceSuggestion[] }
export const tagKey = (tag: string) => tag.trim().replace(/^#/, '').normalize('NFC').toLowerCase();
export const validTag = (tag: string) => /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,29}$/u.test(tag);
export function canonicalTag(raw: string, scope: Pick<ReferenceScope, 'tags' | 'aliases'>): string | null {
  const key = tagKey(raw);
  const exact = scope.tags.find(t => tagKey(t) === key);
  if (exact) return tagKey(exact);
  const target = Object.entries(scope.aliases ?? {}).find(([alias]) => tagKey(alias) === key)?.[1];
  return target && scope.tags.some(t => tagKey(t) === tagKey(target)) ? tagKey(target) : null;
}
export function validateAliases(taxonomy: Taxonomy): string | null {
  if (taxonomy.tagAliases && (typeof taxonomy.tagAliases !== 'object' || Array.isArray(taxonomy.tagAliases) || Object.keys(taxonomy.tagAliases).length > 100)) return 'Supply up to 100 explicit aliases.';
  for (const [alias, target] of Object.entries(taxonomy.tagAliases ?? {})) {
    if (typeof target !== 'string') return 'Tag alias targets must be canonical tag names.';
    const a = tagKey(alias), t = tagKey(target);
    if (!validTag(a) || !taxonomy.tags.includes(t)) return 'Each tag alias must point to an existing canonical tag.';
    if (taxonomy.tags.includes(a) && a !== t) return 'An existing tag cannot be silently merged into another tag.';
    if (Object.keys(taxonomy.tagAliases ?? {}).filter(k => tagKey(k) === a).length > 1) return 'Tag aliases must be unique ignoring capitalization.';
  }
  return null;
}
export function referenceScope(state: QuestState, actor: string): ReferenceScope {
  const member = state.people.find(p => p.id === actor);
  return { workspaceId: state.workspace.tenantId, people: member ? state.people : [],
    tags: member ? [...new Set([...(state.taxonomy?.tags ?? []), ...state.tasks.flatMap(t => t.tags ?? []), ...state.leads.flatMap(l => l.relationshipTags ?? [])])].map(tagKey) : [],
    aliases: member ? state.taxonomy?.tagAliases : {}, canCreateTags: !!member && member.role !== 'reviewer' };
}
const folded = (s: string) => s.normalize('NFC').toLocaleLowerCase();
const boundary = (s: string | undefined) => !s || !/[\p{L}\p{N}_'-]/u.test(s);

/** Adjust ranges for a contiguous edit. Overlapping edits remove a link; identical
 * pasted tokens are resolved afresh. This never transfers an old id to new words. */
export function rebaseReferences(previous: ReferenceDocument, text: string): ReferenceDocument {
  if (previous.text === text) return { text, spans: previous.spans.map(s => ({ ...s })) };
  let start = 0;
  while (start < previous.text.length && start < text.length && previous.text[start] === text[start]) start++;
  let end = previous.text.length, nextEnd = text.length;
  while (end > start && nextEnd > start && previous.text[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  const delta = nextEnd - end;
  return { text, spans: previous.spans.flatMap(s => s.end <= start ? [{ ...s }] : s.start >= end ? [{ ...s, start: s.start + delta, end: s.end + delta }] : []) };
}
function allowed(span: ReferenceSpan, text: string, scope: ReferenceScope, historical = false) {
  if (!span || span.workspaceId !== scope.workspaceId || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || text.slice(span.start, span.end) !== span.label || !boundary(text[span.end]) || (span.start > 0 && /[\p{L}\p{N}_@#]/u.test(text[span.start - 1]!))) return false;
  if (span.kind === 'person') return scope.people.some(p => p.id === span.id && (historical || folded(`@${p.name}`) === folded(span.label) || folded(`@${p.name.split(/\s/)[0]}`) === folded(span.label)));
  return span.kind === 'tag' && canonicalTag(span.label, scope) === span.id;
}

/** Persisted ids survive a display-name change. Untrusted draft ids must still match
 * a currently visible identity's name. Unknown/ambiguous names remain ordinary text. */
export function referenceDocument(text: string, scope: ReferenceScope, previous?: ReferenceDocument, drafts: ReferenceDocument[] = []): ReferenceDocument {
  const old = previous ? rebaseReferences(previous, text).spans.filter(s => allowed(s, text, scope, true)) : [];
  const hinted: ReferenceSpan[] = [];
  for (const draft of drafts.slice(0, 64)) {
    if (!draft || typeof draft.text !== 'string' || draft.text.length > 8000 || !draft.text || !Array.isArray(draft.spans)) continue;
    const offset = text.indexOf(draft.text);
    if (offset < 0 || text.indexOf(draft.text, offset + 1) >= 0) continue;
    for (const s of draft.spans.slice(0, 100)) {
      if (!s || typeof s !== 'object') continue;
      const shifted = { ...s, start: s.start + offset, end: s.end + offset };
      if (allowed(shifted, text, scope)) hinted.push(shifted);
    }
  }
  const spans = [...old];
  for (const s of hinted) {
    // Conflicting hints fail closed instead of choosing an arbitrary same-name person.
    if (hinted.some(other => other.start === s.start && other.end === s.end && other.id !== s.id)) continue;
    if (!spans.some(other => s.start < other.end && s.end > other.start)) spans.push(s);
  }
  for (let i = 0; i < text.length; i++) {
    if (!['@', '#'].includes(text[i]!) || (i > 0 && /[\p{L}\p{N}_@#\/]/u.test(text[i - 1]!))) continue;
    if (spans.some(s => i >= s.start && i < s.end)) continue;
    if (text[i] === '#') {
      const match = /^#[\p{L}\p{N}][\p{L}\p{N}_-]{0,29}(?![\p{L}\p{N}_-])/u.exec(text.slice(i));
      const id = match && canonicalTag(match[0], scope);
      if (match && id) spans.push({ kind: 'tag', id, workspaceId: scope.workspaceId, start: i, end: i + match[0].length, label: match[0] });
      continue;
    }
    const matches = scope.people.map(p => ({ p, token: `@${p.name}` })).filter(({ token }) => folded(text.slice(i, i + token.length)) === folded(token) && boundary(text[i + token.length]));
    let selected: { p: Person; token: string } | undefined = matches.sort((a, b) => b.token.length - a.token.length)[0];
    if (selected && matches.filter(m => m.token.length === selected!.token.length).length > 1) selected = undefined;
    if (!selected) {
      const first = /^@[\p{L}\p{N}][\p{L}\p{N}_'-]*/u.exec(text.slice(i))?.[0];
      const people = first ? scope.people.filter(p => folded(`@${p.name.split(/\s/)[0]}`) === folded(first)) : [];
      if (first && people.length === 1) selected = { p: people[0]!, token: first };
    }
    if (selected) { spans.push({ kind: 'person', id: selected.p.id, workspaceId: scope.workspaceId, start: i, end: i + selected.token.length, label: text.slice(i, i + selected.token.length) }); i += selected.token.length - 1; }
  }
  return { text, spans: spans.sort((a, b) => a.start - b.start) };
}
export function referenceSuggestions(text: string, caret: number, scope: ReferenceScope): ReferenceSuggestions | null {
  const match = /(?:^|[\s(])([@#])([\p{L}\p{N}_'-]*(?: [\p{L}\p{N}_'-]*){0,3})$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const query = folded(match[2] ?? ''), trigger = match[1];
  let items: ReferenceSuggestion[];
  if (trigger === '@') items = scope.people.filter(p => folded(p.name).includes(query)).map(p => ({ kind: 'person', id: p.id, label: `@${p.name}`, detail: p.title, insert: `@${p.name} ` }));
  else {
    if (query.includes(' ')) return null;
    items = [...new Set(scope.tags.map(tagKey))].filter(t => t.includes(query) || Object.entries(scope.aliases ?? {}).some(([a, target]) => tagKey(target) === t && tagKey(a).includes(query))).map(t => ({ kind: 'tag', id: t, label: `#${t}`, detail: 'Organization tag', insert: `#${t} ` }));
    if (query && validTag(query) && !canonicalTag(query, scope) && scope.canCreateTags) items.push({ kind: 'tag', id: tagKey(query), label: `#${query}`, detail: 'Create organization tag when saved', insert: `#${query} `, create: true });
  }
  return items.length ? { start: caret - match[2]!.length - 1, end: caret, items: items.slice(0, 8) } : null;
}
export function tagsIn(text: string) { return [...text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,29})(?![\p{L}\p{N}_-])/gu)].map(m => tagKey(m[1]!)); }

/** Draft-only cache; cleared on actor/workspace change, never a search registry. */
export function createReferenceDrafts() {
  const drafts = new Map<string, ReferenceDocument>();
  return { set(key: string, document: ReferenceDocument) { drafts.delete(key); drafts.set(key, document); while (drafts.size > 64) drafts.delete(drafts.keys().next().value!); },
    documents: () => [...drafts.values()], clear: () => drafts.clear() };
}
export type ReferenceDrafts = ReturnType<typeof createReferenceDrafts>;

/** Carries confirmed ids through a plain-text preview transformation (e.g. removing
 * command dates). Same-label conflicts are left unresolved instead of mislinking. */
export function projectReferences(source: ReferenceDocument, text: string, scope: ReferenceScope): ReferenceDocument {
  const spans: ReferenceSpan[] = [];
  const groups = new Map<string, ReferenceSpan[]>();
  for (const s of source.spans) { const list = groups.get(s.label) ?? []; list.push(s); groups.set(s.label, list); }
  for (const [label, refs] of groups) {
    const ids = new Set(refs.map(r => r.id));
    if (ids.size !== 1) continue;
    let at = text.indexOf(label);
    while (at >= 0) { spans.push({ ...refs[0]!, start: at, end: at + label.length }); at = text.indexOf(label, at + label.length); }
  }
  return referenceDocument(text, scope, undefined, [{ text, spans }]);
}
