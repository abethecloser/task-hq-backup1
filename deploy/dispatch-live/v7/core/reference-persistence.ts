import type { Action, QuestState } from './contract.ts';
import { canonicalTag, referenceDocument, referenceScope, tagsIn } from './references.ts';
import type { ReferenceDocument, ReferenceFields } from './references.ts';

/** Runs only after engine authorization. Metadata is server-derived, not trusted
 * from the client, and lives on the original record/event alongside its text. */
export function indexReferenceChanges(base: QuestState, next: QuestState, actor: string, drafts: ReferenceDocument[] = []): QuestState {
  let scope = referenceScope(next, actor);
  const texts: string[] = [];
  const changedTasks = next.tasks.filter(t => t !== base.tasks.find(b => b.id === t.id));
  const changedLeads = next.leads.filter(l => l !== base.leads.find(b => b.id === l.id));
  const changedFeedback = next.feedback.filter(f => f !== base.feedback.find(b => b.id === f.id));
  for (const t of changedTasks) texts.push(t.title, t.description, t.nextAction, t.waitingOn, ...(t.tags ?? []).map(t => `#${t}`));
  for (const l of changedLeads) texts.push(l.name, l.need, l.blocker, ...l.attempts.map(a => a.note), ...(l.relationshipTags ?? []).map(t => `#${t}`));
  for (const f of changedFeedback) texts.push(f.title, f.body, ...f.replies.map(r => r.body));
  for (const e of next.events) if (!base.events.some(b => b.id === e.id)) texts.push(e.text);
  const newTags = scope.canCreateTags ? texts.flatMap(tagsIn).filter(t => !canonicalTag(t, scope)) : [];
  const taxonomy = newTags.length ? { types: next.taxonomy?.types ?? [], ...next.taxonomy, tags: [...new Set([...(next.taxonomy?.tags ?? []), ...newTags])].slice(0, 100) } : next.taxonomy;
  scope = { ...scope, tags: [...new Set([...scope.tags, ...(taxonomy?.tags ?? [])])] };
  const fields = (values: Record<string, string>, old?: ReferenceFields): ReferenceFields => Object.fromEntries(Object.entries(values).map(([key, text]) => [key, referenceDocument(text, scope, old?.[key], drafts)]));
  return { ...next, taxonomy,
    tasks: next.tasks.map(t => !changedTasks.includes(t) ? t : { ...t, references: fields({ title: t.title, description: t.description, nextAction: t.nextAction, waitingOn: t.waitingOn }, base.tasks.find(b => b.id === t.id)?.references) }),
    leads: next.leads.map(l => !changedLeads.includes(l) ? l : { ...l, references: fields({ name: l.name, need: l.need, blocker: l.blocker }, base.leads.find(b => b.id === l.id)?.references), attempts: l.attempts.map((a, i) => ({ ...a, references: fields({ note: a.note }, base.leads.find(b => b.id === l.id)?.attempts[i]?.references) })) }),
    feedback: next.feedback.map(f => !changedFeedback.includes(f) ? f : { ...f, references: fields({ title: f.title, body: f.body }, base.feedback.find(b => b.id === f.id)?.references), replies: f.replies.map(r => ({ ...r, references: fields({ body: r.body }, base.feedback.find(b => b.id === f.id)?.replies.find(b => b.id === r.id)?.references) })) }),
    events: next.events.map(e => base.events.some(b => b === e) ? e : { ...e, references: fields({ text: e.text }, base.events.find(b => b.id === e.id)?.references) }) };
}
/** Only bounded text drafts travel with a normal authorized action. */
export function attachReferenceDrafts(action: Action, drafts: ReferenceDocument[]): Action {
  return { ...action, referenceDrafts: drafts.filter(d => d.spans.length && d.text.length <= 8000).slice(-64) };
}
