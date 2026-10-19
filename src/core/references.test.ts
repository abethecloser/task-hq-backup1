import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from './engine.ts';
import { blankLead, seedState } from './seed.ts';
import { canonicalTag, referenceDocument, referenceScope, referenceSuggestions, rebaseReferences, validateAliases } from './references.ts';
import { workspaceIndex, searchReferences } from './reference-index.ts';
import { channelReferenceScope, messageIndex, postMessage, seedMessaging } from './inbox.ts';
const now = Date.parse('2026-10-18T12:00:00Z');
const world = () => seedState(now);
test('one grammar resolves stable current identities including reviewers; boundaries leave email and paths alone', () => {
  const state = world(), scope = referenceScope(state, 'jordan');
  const doc = referenceDocument('Ask @Abraham and @Maya Chen about #Permits. mail@example.test /path#permits', scope);
  assert.deepEqual(doc.spans.map(s => s.id), ['abraham', 'maya', 'permits']);
  assert.equal(referenceSuggestions('Ask @Abr', 8, scope)!.items[0]!.id, 'abraham');
  assert.equal(referenceSuggestions('mail@example.test', 17, scope), null);
  assert.equal(referenceSuggestions('@Abr', 4, referenceScope(state, 'outsider')), null);
});
test('tags fold case and explicit aliases without collapsing punctuation or distinct canonical tags', () => {
  const scope = { ...referenceScope(world(), 'jordan'), tags: ['mapleave', 'maple-ave'], aliases: { maple_ave: 'mapleave' } };
  assert.equal(canonicalTag('#MapleAve', scope), 'mapleave');
  assert.equal(canonicalTag('#Maple_Ave', scope), 'mapleave');
  assert.equal(canonicalTag('#maple-ave', scope), 'maple-ave');
  assert.match(validateAliases({ types: [], tags: scope.tags, tagAliases: { 'maple-ave': 'mapleave' } })!, /silently merged/);
  assert.equal(referenceSuggestions('#newtag', 7, { ...scope, canCreateTags: false }), null);
});
test('edits, removals, duplication and renaming preserve only correct links; forged foreign ids fail closed', () => {
  const scope = referenceScope(world(), 'jordan');
  const doc = referenceDocument('Ask @Maya Chen today', scope);
  const moved = referenceDocument('Please ask @Maya Chen today', scope, doc);
  assert.equal(moved.spans[0]!.id, 'maya'); assert.equal(moved.spans[0]!.start, 11);
  assert.equal(referenceDocument('Ask @Maya Chenx today', scope, doc).spans.some(s => s.label === '@Maya Chen'), false);
  assert.equal(referenceDocument('Ask someone today', scope, doc).spans.length, 0);
  assert.equal(referenceDocument('Ask @Maya Chen and @Maya Chen', scope, doc).spans.length, 2);
  const renamed = { ...scope, people: scope.people.map(p => p.id === 'maya' ? { ...p, name: 'Maya Renamed' } : p) };
  assert.equal(referenceDocument(doc.text, renamed, doc).spans[0]!.id, 'maya');
  assert.equal(referenceDocument(doc.text, { ...renamed, people: renamed.people.filter(p => p.id !== 'maya') }, doc).spans.length, 0);
  assert.equal(referenceDocument('@Maya Chen', scope, undefined, [{ text: '@Maya Chen', spans: [{ ...doc.spans[0]!, start: 0, end: 10, workspaceId: 'other-org' }] }]).spans[0]!.workspaceId, scope.workspaceId);
  assert.deepEqual(rebaseReferences(doc, 'No reference').spans, []);
});
test('confirmed ambiguous selections survive preview; unknown identity hints cannot forge links', () => {
  const scope = referenceScope(world(), 'jordan');
  scope.people = [...scope.people, { id: 'maya-2', name: 'Maya Chen', role: 'field', title: 'Other current member' }];
  const text = 'Ask @Maya Chen', span = { kind: 'person' as const, id: 'maya-2', workspaceId: scope.workspaceId, start: 4, end: 14, label: '@Maya Chen' };
  assert.equal(referenceDocument(text, scope).spans.length, 0);
  const selected = referenceDocument(text, scope, undefined, [{ text, spans: [span] }]);
  assert.equal(selected.spans[0]!.id, 'maya-2');
  assert.equal(referenceDocument('Please '+text, scope, selected).spans[0]!.id, 'maya-2');
  assert.equal(referenceDocument(text, scope, undefined, [{ text, spans: [{ ...span, id: 'foreign-id' }] }]).spans.length, 0);
});
test('task edits, comments, lead notes and undo persist source metadata and retrieve across record types', () => {
  let state = world(), n = 0;
  function act(action: Parameters<typeof apply>[1], actor = 'jordan') { const r = apply(state, action, { actor, now, newId: () => `ref-${++n}` }); assert.ok(r.ok, r.ok ? '' : r.error); state = r.state; return r; }
  const created = act({ type: 'task/create', task: { title: 'Ask @Abraham about #MapleAve', owner: 'jordan' } });
  const task = state.tasks[0]!;
  assert.equal(task.references?.title?.spans[0]!.id, 'abraham');
  assert.equal(task.owner, 'jordan'); assert.deepEqual(task.watchers, []);
  act({ type: 'task/comment', id: task.id, note: 'Confirmed with @Abraham #MAPLEAVE' });
  const l = blankLead('ref-lead', { name: 'Synthetic relationship', source: 'Synthetic', phone: '', address: '', need: 'Synthetic quote' }, now);
  state = { ...state, leads: [l] };
  act({ type: 'lead/attempt', id: l.id, channel: 'phone', outcome: 'reached', note: 'Talk to @Abraham #mapleave' });
  const results = searchReferences(workspaceIndex(state, 'jordan', now), { text: '@Abraham #MapleAve' });
  assert.ok(results.some(r => r.kind === 'tasks' && r.target.id === task.id));
  assert.ok(results.some(r => r.kind === 'notes' && r.target.id === task.id));
  assert.ok(results.some(r => r.kind === 'notes' && r.target.id === l.id));
  const edit = act({ type: 'task/update', id: task.id, changes: { title: 'Reference removed' } });
  assert.equal(state.tasks.find(t => t.id === task.id)!.references?.title?.spans.length, 0);
  act({ type: 'undo', eventId: edit.event!.id });
  assert.equal(state.tasks.find(t => t.id === task.id)!.references?.title?.spans[0]!.id, 'abraham');
  assert.ok(created.event?.feedback === 'task-created');
});
test('channel membership and tenant identity are checked before suggestions, search counts or snippets', () => {
  const state = world(), messages = seedMessaging(now, state.people);
  messages.messages.push({ ...messages.messages[0]!, id: 'private', channelId: 'ch-dd-admin', workspaceId: 'demo-drafting', text: 'PRIVATE_SECRET #mapleave @Riley', mentions: [] });
  const inaccessible = channelReferenceScope(messages, 'sam', 'ch-dd-admin');
  assert.deepEqual(inaccessible.people, []); assert.deepEqual(inaccessible.tags, []);
  const visible = channelReferenceScope(messages, 'sam', 'ch-construction');
  assert.equal(visible.people.some(p => p.id === 'riley'), false);
  const index = messageIndex(messages, 'sam');
  assert.equal(searchReferences(index, { text: 'PRIVATE_SECRET' }).length, 0);
  assert.equal(index.records.some(r => r.id === 'message:private'), false);
  assert.deepEqual(workspaceIndex(state, 'not-a-member', now).records, []);
  assert.equal(postMessage(messages, 'sam', 'ch-dd-admin', '@Riley #mapleave', now, 'attempt').ok, false);
});
test('message references use the same canonical grammar and search adapter across authorized workspaces', () => {
  const state = world(), base = seedMessaging(now, state.people);
  const a = postMessage(base, 'jordan', 'ch-office', 'Ask @Maya Chen about #MapleAve', now, 'new-a'); assert.ok(a.ok);
  const b = postMessage(a.state, 'jordan', 'ch-construction', '@Maya Chen #MAPLEAVE', now + 1, 'new-b'); assert.ok(b.ok);
  const results = searchReferences(messageIndex(b.state, 'jordan'), { text: '@Maya Chen #mapleave' });
  assert.equal(results.filter(r => r.id.startsWith('message:new-')).length, 2);
  assert.equal(b.message.references?.text?.spans[0]!.id, 'maya');
  assert.deepEqual(b.message.mentions, ['maya']);
  assert.equal(searchReferences(messageIndex(b.state, 'jordan'), { text: '#mapleave', workspaceId: 'wrong-tenant' }).length, 0);
});

test('Composer preview transforms preserve a confirmed stable selection with duplicate display names', async () => {
  const { parseCommand } = await import('./command.ts');
  const state = world(); state.people.push({ id: 'maya-other', name: 'Maya Chen', role: 'field', title: 'Another member' });
  const scope = referenceScope(state, 'jordan'), text = 'Meet @Maya Chen tomorrow #permits';
  const selected = { text, spans: [{ kind: 'person' as const, id: 'maya-other', workspaceId: scope.workspaceId, start: 5, end: 15, label: '@Maya Chen' }] };
  const drafts = parseCommand(text, state, now, [], { documents: [selected] });
  assert.equal(drafts[0]!.references?.spans.find(s => s.kind === 'person')?.id, 'maya-other');
});
