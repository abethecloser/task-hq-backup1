import type { ToolsState } from './estimating.ts';
import type { ReferenceDocument, ReferenceFields, ReferenceScope } from '../references.ts';
import { canonicalTag, referenceDocument, tagsIn } from '../references.ts';
import type { SearchIndex } from '../reference-index.ts';
const values = (record: ToolsState['estimates'][number] | ToolsState['proposals'][number]) => 'title' in record ? { title: record.title, history: record.history.map(h => h.text).join('\n'), approval: record.approval?.note ?? '' } : { scope: record.scope.map(s => `${s.service} ${s.description}`).join('\n'), sections: record.sections.map(s => `${s.title} ${s.body}`).join('\n'), payment: record.payment, history: record.history.map(h => h.text).join('\n'), decision: record.decision?.note ?? '', approval: record.approval?.note ?? '' };
export function indexToolChanges(previous: ToolsState, next: ToolsState, scope: ReferenceScope, drafts: ReferenceDocument[]) {
  const newTags = scope.canCreateTags ? [...new Set([...next.estimates, ...next.proposals].flatMap(r => Object.values(values(r)).flatMap(v => tagsIn(v ?? ''))).filter(t => !canonicalTag(t, scope)))] : [];
  const extended = { ...scope, tags: [...new Set([...scope.tags, ...newTags])] };
  const fields = (data: Record<string, string | undefined>, old?: ReferenceFields) => Object.fromEntries(Object.entries(data).map(([key, text]) => [key, referenceDocument(text ?? '', extended, old?.[key], drafts)]));
  return { tags: newTags, state: { ...next, estimates: next.estimates.map(r => ({ ...r, references: fields(values(r), previous.estimates.find(e => e.id === r.id)?.references) })), proposals: next.proposals.map(r => ({ ...r, references: fields(values(r), previous.proposals.find(e => e.id === r.id)?.references) })) } };
}
export function toolIndex(state: ToolsState, scope: ReferenceScope, name: string): SearchIndex {
  const records: SearchIndex['records'] = [];
  if (!scope.people.length || state.orgId !== `demo-${scope.workspaceId}`) return { records, scopes: [] };
  for (const r of [...state.estimates, ...state.proposals]) {
    const fields = Object.fromEntries(Object.entries(values(r)).map(([key, text]) => [key, referenceDocument(text ?? '', scope, r.references?.[key])]));
    records.push({ id: `tool:${r.id}`, workspaceId: scope.workspaceId, workspaceName: name, kind: 'tools', title: 'title' in r ? r.title : r.number, fields, target: { view: 'tools', id: `${'title' in r ? 'estimate' : 'proposal'}:${r.id}` }, updatedAt: r.updatedAt });
  }
  return { records, scopes: [scope] };
}
