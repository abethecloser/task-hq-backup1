// Durable completion: who finished work, the approval path, archive/restore, reopen,
// permissions, and the registry views. Everything is an ordinary engine action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { canReopenTask } from './permissions.ts';
import { DEFAULT_QUERY, queryTasks } from './registry.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action, now = T0) => apply(state, action, { actor, now, newId: () => `c${++n}`, writer: 'test' });
const must = (state: QuestState, actor: string, action: Action, now = T0) => { const r = run(state, actor, action, now); if (!r.ok) throw new Error(`${action.type}: ${r.error}`); return r.state; };
const task = (state: QuestState, id: string) => state.tasks.find(item => item.id === id)!;

test('an approval-path task is Submitted for Review, not complete, until the approver approves', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  assert.equal(review.completedAt, null);
  assert.equal(review.completedBy ?? null, null);
  const approver = review.approver;
  const done = must(base, approver, { type: 'task/advance', id: review.id }, T0 + 1000);
  const finished = task(done, review.id);
  assert.equal(finished.status, 'done');
  assert.equal(finished.completedBy, approver);
  assert.equal(finished.completedAt, T0 + 1000);
  assert.equal(done.events[0]!.kind, 'approval');
});

test('someone who is not the approver cannot complete work that is waiting for review', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  const outsider = base.people.find(item => item.id === 'sam')!;
  const refused = run(base, outsider.id, { type: 'task/advance', id: review.id });
  assert.equal(refused.ok, false);
  assert.equal(task(base, review.id).status, 'review');
});

test('archive and restore keep the record and its history, and only apply to completed work', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  const done = must(base, review.approver, { type: 'task/advance', id: review.id }, T0 + 1000);
  const notDone = base.tasks.find(item => item.status === 'ready')!;
  assert.equal(run(done, review.approver, { type: 'task/archive', id: notDone.id }).ok, false, 'open work cannot be archived');
  const archived = must(done, review.approver, { type: 'task/archive', id: review.id }, T0 + 2000);
  const record = task(archived, review.id);
  assert.equal(record.status, 'done', 'archiving is not a second status');
  assert.equal(record.archivedAt, T0 + 2000);
  assert.equal(record.archivedBy, review.approver);
  assert.equal(record.completedBy, review.approver, 'completion is untouched');
  assert.ok(archived.events.length > done.events.length, 'archiving is an audited event');
  assert.equal(archived.tasks.length, done.tasks.length, 'nothing is deleted');
  assert.equal(run(archived, review.approver, { type: 'task/archive', id: review.id }).ok, false, 'no double archive');
  const restored = must(archived, review.approver, { type: 'task/unarchive', id: review.id }, T0 + 3000);
  assert.equal(task(restored, review.id).archivedAt, null);
  assert.equal(task(restored, review.id).status, 'done');
  assert.equal(run(restored, review.approver, { type: 'task/unarchive', id: review.id }).ok, false);
});

test('reopen clears the completion and archive state; history stays', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  let s = must(base, review.approver, { type: 'task/advance', id: review.id }, T0 + 1000);
  s = must(s, review.approver, { type: 'task/archive', id: review.id }, T0 + 2000);
  const reopened = must(s, review.approver, { type: 'task/reopen', id: review.id, note: 'Missed a step' }, T0 + 3000);
  const record = task(reopened, review.id);
  assert.equal(record.status, 'ready');
  assert.equal(record.completedAt, null);
  assert.equal(record.completedBy, null);
  assert.equal(record.archivedAt, null);
  assert.ok(reopened.events.length > s.events.length);
});

test('archive permission matches reopen permission for every person, and never grants Delete', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  const done = must(base, review.approver, { type: 'task/advance', id: review.id }, T0 + 1000);
  for (const person of done.people) {
    const allowed = canReopenTask(done, task(done, review.id), person.id);
    assert.equal(run(done, person.id, { type: 'task/archive', id: review.id }, T0 + 2000).ok, allowed, `${person.id} archive vs reopen`);
  }
  assert.ok(!(run(done, review.approver, { type: 'task/delete', id: review.id } as unknown as Action) as { ok?: boolean } | undefined)?.ok, 'there is no delete action');
});

test('archived work leaves every default list and appears only under the Archived filter', () => {
  const base = seedState(T0);
  const review = base.tasks.find(item => item.status === 'review' && item.approver)!;
  let s = must(base, review.approver, { type: 'task/advance', id: review.id }, T0 + 1000);
  const inList = (state: QuestState, status: typeof DEFAULT_QUERY.status) => queryTasks(state, review.approver, T0 + 2000, { ...DEFAULT_QUERY, status }).some(item => item.id === review.id);
  assert.equal(inList(s, 'done'), true, 'completed view shows it');
  s = must(s, review.approver, { type: 'task/archive', id: review.id }, T0 + 2000);
  assert.equal(inList(s, 'done'), false);
  assert.equal(inList(s, 'any'), false);
  assert.equal(inList(s, 'open'), false);
  assert.equal(inList(s, 'archived'), true);
});
