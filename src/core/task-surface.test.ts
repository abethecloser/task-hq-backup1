import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankTask, seedState } from './seed.ts';
import type { Person, QuestState, Task } from './contract.ts';
import { asDensity, defaultScope, rowEvidence, rowSignal } from './task-surface.ts';

const NOW = Date.parse('2026-11-03T12:00:00');
const scene = (...tasks: Task[]): QuestState => ({ ...seedState(NOW), tasks });
const make = (id: string, changes: Partial<Task> = {}) => ({ ...blankTask(id, { title: id, owner: 'alex' }, 'maya', NOW), ...changes });

test('the person who must act sees "Your move"; everyone else sees who holds it', () => {
  const state = scene(make('a', { nextAction: 'Call the supplier' }));
  assert.deepEqual(rowSignal(state, state.tasks[0]!, 'alex'), { tone: 'act', mine: true, label: 'Your move', text: 'Call the supplier' });
  const other = rowSignal(state, state.tasks[0]!, 'maya');
  assert.equal(other.mine, false);
  assert.equal(other.label, 'Alex');
  assert.equal(other.text, 'Call the supplier');
});

test('a review belongs to the approver', () => {
  const state = scene(make('a', { status: 'review', approver: 'jordan' }));
  assert.equal(rowSignal(state, state.tasks[0]!, 'jordan').label, 'Your move');
  assert.equal(rowSignal(state, state.tasks[0]!, 'alex').label, 'Jordan');
});

test('waiting work names what it waits on and never says "Your move"', () => {
  const first = make('first', { title: 'Pour footing', owner: 'sam' });
  const state = scene(first, make('second', { dependsOn: ['first'] }));
  const signal = rowSignal(state, state.tasks[1]!, 'alex');
  assert.equal(signal.mine, false);
  assert.equal(signal.label, 'Waiting on Sam');
  assert.equal(signal.text, '“Pour footing”');
  assert.equal(rowSignal(state, state.tasks[1]!, 'sam').label, 'Waiting on you');
});

test('blocked and unassigned work say so plainly', () => {
  const blocked = make('b', { status: 'blocked', blocker: { note: 'No permit', by: 'alex', at: NOW, helper: 'maya' } as Task['blocker'] });
  const state = scene(blocked, make('u', { owner: '' }));
  assert.equal(rowSignal(state, state.tasks[0]!, 'jordan').label, 'Blocked · Maya');
  assert.match(rowSignal(state, state.tasks[0]!, 'jordan').text, /No permit/);
  assert.equal(rowSignal(state, state.tasks[0]!, 'maya').label, 'Your move');
  assert.equal(rowSignal(state, state.tasks[1]!, 'alex').label, 'Unassigned');
  assert.equal(rowSignal(state, state.tasks[1]!, 'alex').mine, false);
});

test('a read-only viewer is never told it is their move', () => {
  const base = scene(make('a'));
  const state = { ...base, people: base.people.map(item => (item.id === 'alex' ? { ...item, authority: 'reviewer' as const } : item)) };
  const signal = rowSignal(state, state.tasks[0]!, 'alex');
  assert.equal(signal.mine, false);
  assert.equal(signal.label, 'Assigned to you');
});

test('finished work asks nothing of anyone', () => {
  const state = scene(make('d', { status: 'done', completedAt: NOW }));
  const signal = rowSignal(state, state.tasks[0]!, 'alex');
  assert.equal(signal.tone, 'done');
  assert.equal(signal.mine, false);
});

test('evidence lists only what is true', () => {
  const first = make('first', { nextOwner: 'sam', approver: 'jordan', lastActivityAt: NOW - 2 * 3_600_000 });
  const state = scene(first, make('second', { dependsOn: ['first'], waitingOn: 'City permit office' }));
  const facts = rowEvidence(state, state.tasks[0]!, NOW);
  assert.ok(facts.includes('Unlocks 1 task'));
  assert.ok(facts.includes('Goes to Sam next'));
  assert.ok(facts.includes('Jordan approves'));
  assert.ok(facts.some(item => item.startsWith('Active ')));
  const second = rowEvidence(state, state.tasks[1]!, NOW);
  assert.ok(second.includes('Waiting on 1 task'));
  assert.ok(second.includes('Outside: City permit office'));
  assert.ok(!second.some(item => item.startsWith('Unlocks')));
});

test('finished work stops claiming dependencies or handoffs', () => {
  const state = scene(make('first', { status: 'done', completedAt: NOW, nextOwner: 'sam', approver: 'jordan' }), make('second', { dependsOn: ['first'] }));
  const facts = rowEvidence(state, state.tasks[0]!, NOW);
  assert.ok(!facts.some(item => /Unlocks|Goes to|approves/.test(item)));
});

test('Tasks opens on the company for coordinators and reviewers, own work for everyone else', () => {
  const p = (changes: Partial<Person>) => ({ id: 'x', name: 'X', role: 'field', title: '', ...changes }) as Person;
  assert.equal(defaultScope(p({ authority: 'owner' })), 'company');
  assert.equal(defaultScope(p({ authority: 'admin' })), 'company');
  assert.equal(defaultScope(p({ authority: 'supervisor' })), 'company');
  assert.equal(defaultScope(p({ authority: 'reviewer' })), 'company');
  assert.equal(defaultScope(p({ authority: 'member' })), 'mine');
  assert.equal(defaultScope(p({ authority: 'member', role: 'manager' })), 'mine', 'a work title grants nothing');
  assert.equal(defaultScope(p({ role: 'coordinator' })), 'company');
  assert.equal(defaultScope(p({ role: 'field' })), 'mine');
  assert.equal(defaultScope(undefined), 'mine');
});

test('an unknown stored density falls back to standard', () => {
  assert.equal(asDensity('compact'), 'compact');
  assert.equal(asDensity('huge'), 'standard');
  assert.equal(asDensity(undefined), 'standard');
});
