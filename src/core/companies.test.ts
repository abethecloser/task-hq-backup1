import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companiesOf, workspaceCompanies } from './companies.ts';
import type { QuestState } from './contract.ts';
import { DEFAULT_QUERY, queryTasks } from './registry.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();

function generalWorkspace(): QuestState {
  const state = seedState(T0);
  return { ...state, workspace: { ...state.workspace, name: 'Quest Operations', preset: 'general' } };
}

test('a workspace that names a company puts all of its tasks in that company', () => {
  const state = seedState(T0); // Quest Roofing, roofing preset
  assert.deepEqual([...workspaceCompanies(state)], ['roofing']);
  assert.ok(state.tasks.every(task => companiesOf(state, task).has('roofing')));
  const drafting = { ...state, workspace: { ...state.workspace, name: 'Quest Drafting & Design', preset: 'general' as const } };
  assert.deepEqual([...workspaceCompanies(drafting)], ['drafting']);
});

test('job names, tags (with aliases) and task types fill companies in automatically', () => {
  const state = generalWorkspace();
  const northside = state.tasks.find(task => task.projectId === 'northside')!; // "Northside re-roof"
  assert.ok(companiesOf(state, northside).has('roofing'), 'a re-roof job is roofing work');
  const office = state.tasks.find(task => task.projectId === 'office')!;
  assert.equal(companiesOf(state, office).size, 0, 'nothing names a company');
  assert.ok(companiesOf(state, { ...office, tags: ['lumen'] }).has('lumen'));
  assert.ok(companiesOf({ ...state, taxonomy: { types: [], tags: [], tagAliases: { plans: 'drafting' } } }, { ...office, tags: ['plans'] }).has('drafting'), 'tag aliases count');
  assert.ok(companiesOf({ ...state, taxonomy: { types: [{ id: 'draft-review', label: 'Draft review' } as never], tags: [] } }, { ...office, type: 'draft-review' }).has('drafting'));
  assert.deepEqual([...companiesOf(state, { ...northside, tags: ['lumen'] })].sort(), ['lumen', 'roofing'], 'a task can belong to several');
  assert.equal(companiesOf(state, { ...office, title: 'Inspect the roof', tags: ['roofs'] }).size, 0, 'whole words only, never titles');
});

test('the company filter narrows the registry and composes with scope and job', () => {
  const state = generalWorkspace();
  const ids = (changes: object) => queryTasks(state, 'jordan', T0, { ...DEFAULT_QUERY, ...changes }).map(task => task.id).sort();
  const roofing = ids({ company: 'roofing' });
  assert.deepEqual(roofing, ids({ project: 'northside' }));
  assert.deepEqual(ids({ company: 'lumen' }), []);
  assert.deepEqual(ids({ company: 'roofing', project: 'maple' }), [], 'company and job both apply');
  assert.ok(ids({ company: 'roofing', scope: 'mine' }).every(id => roofing.includes(id)));
});
