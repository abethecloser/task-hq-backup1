import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { normalize } from './migrate.ts';
import { seedState } from './seed.ts';
import { resolveContext } from './deck.ts';
import { presetFor } from './workspace.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action) => apply(state, action, { actor, now: T0, newId: () => `w${++n}` });

test('existing stored data becomes the Quest Roofing workspace without losing anything', () => {
  const old = seedState(T0) as Partial<QuestState>;
  delete old.workspace;
  old.projects = old.projects!.map(item => (item.id === 'quest-product' ? { ...item, name: 'Quest product (development)' } : item));
  const state = normalize(old as QuestState);
  assert.deepEqual([state.workspace.id, state.workspace.name, state.workspace.preset, state.workspace.kind], ['quest-roofing', 'Quest Roofing', 'roofing', 'organization']);
  assert.equal(state.projects.find(item => item.id === 'quest-product')?.name, 'Task-HQ product (development)');
  assert.equal(state.tasks.length, old.tasks!.length);
});

test('the intermediate product name is also recognized and renamed', () => {
  const old = seedState(T0);
  old.projects = old.projects.map(item => (item.id === 'quest-product' ? { ...item, name: 'Task Management HQ product (development)' } : item));
  assert.equal(normalize(old).projects.find(item => item.id === 'quest-product')?.name, 'Task-HQ product (development)');
});

test('industry language comes from the workspace preset, not the platform', () => {
  let state = seedState(T0);
  assert.equal(presetFor(state).leadHandoffAction, 'Hand to estimating');
  state = run(state, 'sam', { type: 'lead/attempt', id: 'lead-okafor', channel: 'phone', outcome: 'reached' }).state;
  assert.ok(resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0).actions.some(item => item.label === 'Hand to estimating'));

  assert.equal(run(state, 'maya', { type: 'workspace/update', changes: { preset: 'general' } }).ok, false, 'manager only');
  assert.equal(run(state, 'abraham', { type: 'workspace/update', changes: { preset: 'general' } }).ok, false, 'reviewer refused');
  state = run(state, 'jordan', { type: 'workspace/update', changes: { preset: 'general', name: 'Quest Roofing' } }).state;
  assert.ok(resolveContext(state, 'sam', { leadId: 'lead-okafor' }, T0).actions.some(item => item.label === 'Hand off to delivery'));
  const handed = run(state, 'sam', { type: 'lead/advance', id: 'lead-okafor' });
  assert.ok(handed.ok);
  assert.ok(handed.state.tasks.some(task => task.title === 'First appointment: Okafor family'));
});
