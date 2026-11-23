import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Person, Task } from './contract.ts';
import { assigneeLabel, companyOverdue, daysLate, daysLateLabel, ownerLandsOnOverview, readablePersonName } from './owner-home.ts';
import { seedState } from './seed.ts';
import { owns } from './selectors.ts';

const person = (partial: Partial<Person> & Pick<Person, 'id' | 'name' | 'role' | 'title'>): Person => partial;

test('an owner with an empty address opens Owner overview; everyone else and named pages stay put', () => {
  for (const hash of ['', '#', '#/']) assert.equal(ownerLandsOnOverview(hash, '', '/', true), true, hash || '(blank)');
  assert.equal(ownerLandsOnOverview('', '', '/', false), false);
  assert.equal(ownerLandsOnOverview('#/home', '', '/', true), false, 'My Work stays available');
  assert.equal(ownerLandsOnOverview('#/all-tasks', '', '/', true), false);
  assert.equal(ownerLandsOnOverview('#/executive', '', '/', true), false);
  assert.equal(ownerLandsOnOverview('#/home?x=1', '', '/', true), false);
  assert.equal(ownerLandsOnOverview('', '?demo=1', '/', true), false, 'the demo entry link already chooses My Work');
  assert.equal(ownerLandsOnOverview('#/', '', '/demo', true), false);
  assert.equal(ownerLandsOnOverview('#/', '', '/demo/', true), false);
  assert.equal(ownerLandsOnOverview('#/demo', '', '/', true), false);
});

test('organization owner is the only live role that lands on the overview; demo manager stands in', () => {
  assert.equal(owns(person({ id: 'abe', name: 'Abraham', role: 'field', title: 'Owner', authority: 'owner' })), true);
  assert.equal(owns(person({ id: 'sam', name: 'Sam', role: 'manager', title: 'Admin', authority: 'admin' })), false);
  assert.equal(owns(person({ id: 'pat', name: 'Pat', role: 'coordinator', title: 'Supervisor', authority: 'supervisor' })), false);
  assert.equal(owns(person({ id: 'mo', name: 'Mo', role: 'field', title: 'Member', authority: 'member' })), false);
  assert.equal(owns(person({ id: 'rev', name: 'Riley', role: 'reviewer', title: 'Reviewer', authority: 'reviewer' })), false);
  assert.equal(owns(person({ id: 'jordan', name: 'Jordan Lee', role: 'manager', title: 'Operations Manager' })), true);
  assert.equal(owns(person({ id: 'maya', name: 'Maya Chen', role: 'coordinator', title: 'Project Coordinator' })), false);
  assert.equal(owns(person({ id: 'alex', name: 'Alex Morgan', role: 'field', title: 'Field Lead' })), false);
});

test('company overdue lists every open late task, longest overdue first, and skips finished or archived work', () => {
  const now = new Date(2026, 10, 23, 15, 0, 0).getTime();
  const state = seedState(now);
  const sample = state.tasks.find(task => task.id === 'maple-tarp')!;
  const copy = (id: string, patch: Partial<Task>): Task => ({ ...sample, ...patch, id });
  state.tasks.push(
    copy('older', { title: 'Older open work', due: '2026-11-01', status: 'working', owner: 'maya' }),
    copy('same-day', { title: 'Also Nov 1', due: '2026-11-01', status: 'blocked', owner: 'sam' }),
    copy('done-late', { title: 'Finished late', due: '2026-10-01', status: 'done', completedAt: now }),
    copy('archived-late', { title: 'Archived late', due: '2026-10-02', status: 'ready', archivedAt: now }),
    copy('due-today', { title: 'Due today', due: '2026-11-23', status: 'ready' }),
    copy('no-date', { title: 'No date', due: '', status: 'ready' }),
  );
  const overdue = companyOverdue(state, now);
  const ids = overdue.map(task => task.id);
  assert.deepEqual(ids.slice(0, 2), ['same-day', 'older'], 'same due date breaks ties by title');
  assert.ok(ids.includes('maple-tarp'));
  assert.equal(ids.at(-1), 'maple-tarp', 'yesterday is the least late of this set');
  for (const leftOut of ['done-late', 'archived-late', 'due-today', 'no-date', 'staging-area']) assert.equal(ids.includes(leftOut), false, leftOut);
  const dues = overdue.map(task => task.due);
  assert.deepEqual([...dues].sort((a, b) => a.localeCompare(b)), dues);
});

test('days late counts calendar days and reads as a short label', () => {
  const now = new Date(2026, 10, 23, 8, 0, 0).getTime();
  assert.equal(daysLate('2026-11-22', now), 1);
  assert.equal(daysLate('2026-11-20', now), 3);
  assert.equal(daysLate('2026-11-23', now), 1);
  assert.equal(daysLateLabel('2026-11-22', now), '1 day late');
  assert.equal(daysLateLabel('2026-11-20', now), '3 days late');
});

test('row names stay whole and never show an email address', () => {
  assert.equal(readablePersonName('Alex Morgan'), 'Alex Morgan');
  assert.equal(readablePersonName('  Abe  '), 'Abe');
  assert.equal(readablePersonName(''), 'Unassigned');
  assert.equal(readablePersonName(undefined), 'Unassigned');
  assert.equal(readablePersonName('abe.smith@questroofing.com'), 'Abe Smith');
  assert.equal(readablePersonName('alex_morgan+ops@questroofing.com'), 'Alex Morgan Ops');
  assert.equal(readablePersonName('@questroofing.com'), 'Unassigned');
  assert.equal(readablePersonName('abe.smith@questroofing.com').includes('@'), false);
  const state = seedState(Date.now());
  state.people.push({ id: 'inbox', name: 'jordan.lee@questroofing.com', role: 'field', title: 'Field' });
  assert.equal(assigneeLabel(state, 'alex'), 'Alex Morgan');
  assert.equal(assigneeLabel(state, 'inbox'), 'Jordan Lee');
  assert.equal(assigneeLabel(state, ''), 'Unassigned');
  assert.equal(assigneeLabel(state, 'missing'), 'Unassigned');
});
