import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { newTaskFrom, parseCommand, readWhen, resolvePerson, directoryFor, suggestAt } from './command.ts';
import { seedState } from './seed.ts';

// Saturday 2026-10-17, 09:00 local.
const T0 = new Date('2026-10-17T09:00:00').getTime();
const STAGED = [{ id: 'staged-kristin', name: 'Kristin Example' }];
function world(): QuestState {
  const state = seedState(T0);
  return { ...state, people: [...state.people, { id: 'alexia', name: 'Alexia Valenzuela', role: 'manager', title: 'Operations' }] };
}

test('the success example: people, work, priority, time and the dependency, with nothing assigned until confirmed', () => {
  const state = world();
  const drafts = parseCommand('Meeting with @Kristin tomorrow at 9am about permits, high priority, then assign the follow-up to Alexia.', state, T0, STAGED);
  assert.equal(drafts.length, 2);
  const [meeting, follow] = drafts as [typeof drafts[0], typeof drafts[0]];
  assert.equal(meeting.title, 'Meeting with @Kristin Example about permits');
  assert.equal(meeting.type, 'meeting');
  assert.equal(meeting.due, '2026-10-18');
  assert.equal(meeting.dueTime, '09:00');
  assert.equal(meeting.priority, 'high');
  assert.deepEqual(meeting.with, [{ kind: 'staged', id: 'staged-kristin', name: 'Kristin Example' }], 'Kristin is recognized as staged, not a member');
  assert.equal(meeting.owner, null, 'a mention is not an assignment');

  assert.equal(follow.title, 'Follow up: Meeting with @Kristin Example about permits');
  assert.equal(follow.type, 'follow-up');
  assert.equal(follow.after, meeting.key, '“then” makes it depend on the meeting');
  assert.deepEqual(follow.owner, { ref: { kind: 'member', id: 'alexia', name: 'Alexia Valenzuela' }, from: 'assign the follow-up to Alexia', confirmed: false });

  assert.equal(newTaskFrom(follow, { d1: 'task-1' }, { taxonomy: true }).owner, '', 'unconfirmed proposals are not applied');
  const confirmed = newTaskFrom({ ...follow, owner: { ...follow.owner!, confirmed: true } }, { d1: 'task-1' }, { taxonomy: true });
  assert.equal(confirmed.owner, 'alexia');
  assert.deepEqual(confirmed.dependsOn, ['task-1']);
});

test('mentions preserve references without adding watchers; duplicate mentions collapse; unknown and ambiguous names are flagged', () => {
  const state = world();
  const [call] = parseCommand('Call the supplier with @Maya and @maya about shingles', state, T0);
  assert.equal(call!.owner, null);
  assert.deepEqual(call!.with, [{ kind: 'member', id: 'maya', name: 'Maya Chen' }]);
  assert.equal(newTaskFrom(call!, {}, { taxonomy: true }).watchers!.length, 0);

  const twoSams = { ...state, people: [...state.people, { id: 'sam2', name: 'Sam Lee', role: 'field' as const, title: 'Crew' }] };
  const [ambiguous] = parseCommand('Inspect the gutters with @Sam', twoSams, T0);
  assert.equal(ambiguous!.with[0]!.kind, 'ambiguous');
  assert.ok(ambiguous!.notes.some(note => /could be Sam Rivera or Sam Lee/.test(note)));
  const [exact] = parseCommand('Inspect the gutters with @Sam Lee', twoSams, T0);
  assert.deepEqual(exact!.with, [{ kind: 'member', id: 'sam2', name: 'Sam Lee' }]);
  const [unknown] = parseCommand('Ask @Zed to sweep', state, T0);
  assert.equal(unknown!.owner!.ref.kind, 'unknown');
  assert.ok(unknown!.notes.some(note => /Nobody called “Zed”/.test(note)));
  assert.equal(resolvePerson(directoryFor(state), 'al').kind, 'ambiguous', 'Alex and Alexia share a prefix');
  assert.equal(resolvePerson(directoryFor(state), 'Alex').kind, 'member');
});

test('role boundaries: reviewers are never proposed as owners; staged people can’t receive work even when confirmed', () => {
  const state = world();
  const [toReviewer] = parseCommand('Assign the photo audit to Abraham', state, T0);
  assert.notEqual(toReviewer!.owner?.ref.kind, 'member');
  const [toStaged] = parseCommand('Assign the tarp check to Kristin', state, T0, STAGED);
  assert.equal(toStaged!.owner!.ref.kind, 'staged');
  assert.ok(toStaged!.notes.some(note => /isn’t invited yet/.test(note)));
  assert.equal(newTaskFrom({ ...toStaged!, owner: { ...toStaged!.owner!, confirmed: true } }, {}, { taxonomy: true }).owner, '');
  // The engine is still the authority: a reviewer can't create work at all.
  const refused = apply(state, { type: 'task/create', task: newTaskFrom(toReviewer!, {}, { taxonomy: true }) }, { actor: 'abraham', now: T0 });
  assert.equal(refused.ok, false);
});

test('dates and times read the way people write them, and say how they were read', () => {
  const read = (text: string) => readWhen(text, T0).when;
  assert.deepEqual([read('tomorrow').due, read('tmrw').due], ['2026-10-18', '2026-10-18']);
  assert.equal(read('by friday').due, '2026-10-23');
  assert.equal(read('next monday').due, '2026-10-19');
  assert.ok(read('next monday').notes.some(note => /coming one/.test(note)));
  assert.equal(read('in 3 days').due, '2026-10-20');
  assert.equal(read('due 10/24').due, '2026-10-24');
  assert.equal(read('on Oct 24th').due, '2026-10-24');
  assert.equal(read('2026-11-02').due, '2026-11-02');
  assert.equal(read('1/5').due, '2027-01-05', 'a past month/day rolls to next year');
  assert.deepEqual([read('tomorrow at 9:30am').dueTime ?? read('tomorrow at 9:30am').time, read('tomorrow at noon').time, read('friday at 14:00').time], ['09:30', '12:00', '14:00']);
  const three = read('tomorrow at 3');
  assert.equal(three.time, '15:00');
  assert.ok(three.notes.some(note => /read as 3pm/.test(note)));
  const timeOnly = read('at 9am');
  assert.equal(timeOnly.due, '2026-10-17');
  assert.ok(timeOnly.notes.some(note => /read as today/.test(note)));
});

test('types come only from the organization’s configured types; tags are known or flagged new; priority', () => {
  const state = world();
  const [typed] = parseCommand('/inspection north slope #permits #newtag !high', state, T0);
  assert.equal(typed!.type, 'inspection');
  assert.deepEqual(typed!.tags, [{ tag: 'permits', known: true }, { tag: 'newtag', known: false }]);
  assert.equal(typed!.priority, 'high');
  assert.equal(typed!.title, 'North slope');
  const bare = { ...state, taxonomy: undefined };
  const [none] = parseCommand('Meeting about the permit /meeting', bare, T0);
  assert.equal(none!.type, '', 'no configured types, no type');
  assert.ok(none!.notes.some(note => /isn’t a task type here/.test(note)));
  const [low] = parseCommand('Sort the shed low priority', state, T0);
  assert.equal(low!.priority, 'normal');
  assert.ok(low!.notes.some(note => /Normal and High only/.test(note)));
});

test('planning: a longer note becomes a reviewed chain that the engine creates with real dependencies', () => {
  const state = world();
  const drafts = parseCommand('1. Inspect the Elm St roof friday #warranty\n2. Then write the estimate, review by Jordan\n3. Then ask Sam to call the homeowner !high', state, T0);
  assert.equal(drafts.length, 3);
  assert.equal(drafts[1]!.after, 'd1');
  assert.equal(drafts[2]!.after, 'd2');
  assert.equal(drafts[1]!.approver!.ref.kind, 'member');
  assert.equal(drafts[2]!.owner!.ref.kind, 'member');
  // Review: confirm the proposals, then create in order through the engine.
  const reviewed = drafts.map(d => ({ ...d, owner: d.owner && { ...d.owner, confirmed: true }, approver: d.approver && { ...d.approver, confirmed: true } }));
  let current = state; const created: Record<string, string> = {}; let n = 0;
  for (const draft of reviewed) {
    const result = apply(current, { type: 'task/create', task: newTaskFrom(draft, created, { taxonomy: true }) }, { actor: 'jordan', now: T0, newId: () => `c${++n}` });
    assert.ok(result.ok, result.ok ? '' : result.error);
    current = result.state; created[draft.key] = current.tasks[0]!.id;
  }
  const [inspect, estimate, call] = [created.d1, created.d2, created.d3].map(id => current.tasks.find(task => task.id === id)!);
  assert.equal(inspect!.type, 'inspection');
  assert.deepEqual(inspect!.tags, ['warranty']);
  assert.equal(inspect!.due, '2026-10-23');
  assert.deepEqual(estimate!.dependsOn, [inspect!.id]);
  assert.equal(estimate!.approver, 'jordan');
  assert.deepEqual(call!.dependsOn, [estimate!.id]);
  assert.equal(call!.owner, 'sam');
  assert.equal(call!.priority, 'high');
});

test('the engine refuses types that aren’t configured and times without a date', () => {
  const state = world();
  assert.equal(apply(state, { type: 'task/create', task: { title: 'x', type: 'roof-dance' } }, { actor: 'jordan', now: T0 }).ok, false);
  assert.equal(apply(state, { type: 'task/create', task: { title: 'x', dueTime: '09:00' } }, { actor: 'jordan', now: T0 }).ok, false);
  assert.equal(apply(state, { type: 'task/create', task: { title: 'x', tags: ['Not OK!'] } }, { actor: 'jordan', now: T0 }).ok, false);
  const ok = apply(state, { type: 'taxonomy/update', taxonomy: { types: [{ id: 'walkthrough', label: 'Walkthrough', keywords: ['walk'] }], tags: ['#Roof'] } }, { actor: 'jordan', now: T0 });
  assert.ok(ok.ok);
  assert.deepEqual(ok.state.taxonomy?.tags, ['roof']);
  assert.equal(apply(state, { type: 'taxonomy/update', taxonomy: { types: [], tags: [] } }, { actor: 'alex', now: T0 }).ok, false, 'only managers change types and tags');
});

test('autocomplete at the caret: current members only, tags, types, priority', () => {
  const state = world();
  const people = suggestAt('Call @Ma', 8, state, STAGED)!;
  assert.equal(people.trigger, '@');
  assert.deepEqual(people.items.map(item => item.label), ['Maya Chen']);
  assert.equal(suggestAt('with @Kri', 9, state, STAGED), null, 'staged contacts are not current member references');
  assert.deepEqual(suggestAt('x #per', 6, state)!.items.map(item => item.label), ['#permits', '#per']);
  assert.deepEqual(suggestAt('/me', 3, state)!.items.map(item => item.label), ['/meeting']);
  assert.deepEqual(suggestAt('x !h', 4, state)!.items.map(item => item.label), ['!high']);
  assert.equal(suggestAt('email me@example.com', 20, state), null, 'an email address is not a mention');
  assert.equal(suggestAt('@Abr', 4, state)?.items.length ?? 0, 1, 'reviewers can be referenced without receiving ownership or permissions');
});

test('single mode reads a chat message as one task', () => {
  const state = seedState(T0);
  const text = 'Crew is on the Northside staging area. Driveway is tight, need the drop zone marked.';
  assert.equal(parseCommand(text, state, T0).length, 2, 'planning mode splits sentences');
  const [one, ...rest] = parseCommand(text, state, T0, [], { single: true });
  assert.equal(rest.length, 0);
  assert.match(one!.title, /^Crew is on the Northside staging area\. Driveway is tight/);
});
