import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_LEVELS, PARTICIPANTS, coordinate, effectiveAuthority, participantById, reading } from './participants.ts';
import { CATALOG, analyze, applyTemplate, grantAuthority, propose, saveTemplate, workbenchNote, workKind } from './workbench.ts';
import { blankTask, seedState } from './seed.ts';
import type { QuestState } from './contract.ts';

const T0 = new Date('2026-11-08T09:00:00').getTime();
const DAY = 86_400_000;

function scenario(): QuestState {
  const base = seedState(T0);
  const project = base.projects[0]!.id;
  const supplier = blankTask('supplier', { title: 'Supplier confirms shingle delivery', owner: 'alex', due: '2026-11-12', nextAction: 'Call the supplier', projectId: project }, 'alex', T0 - 3 * DAY);
  const install = blankTask('install', { title: 'Dispute klarna charge', owner: '', due: '2026-11-01', nextAction: 'Call Klarna', dependsOn: ['supplier'], projectId: project }, 'alex', T0 - 9 * DAY);
  const crew = blankTask('crew', { title: 'Crew starts install', owner: 'alex', due: '2026-11-15', nextAction: 'Brief the crew', dependsOn: ['install'], projectId: project }, 'alex', T0 - DAY);
  return { ...base, tasks: [...base.tasks, supplier, install, crew] };
}
const get = (state: QuestState, id: string) => state.tasks.find(t => t.id === id)!;

test('registry: unique ids, an Overseer, and every capability it names exists in the one catalog', () => {
  assert.equal(new Set(PARTICIPANTS.map(p => p.id)).size, PARTICIPANTS.length);
  assert.ok(participantById('overseer'));
  for (const p of PARTICIPANTS) for (const id of p.uses) assert.ok(CATALOG.some(c => c.id === id), `${p.id} uses unknown ${id}`);
  for (const id of ['planning', 'operations', 'scheduling', 'execution', 'quality', 'resources']) assert.ok(participantById(id), id);
});

test('honesty: no participant claims a connected runtime, and none may execute', () => {
  for (const p of PARTICIPANTS) {
    assert.notEqual(p.state, 'connected'); assert.notEqual(p.state, 'configured');
    assert.match(p.stateNote, /No model or runtime is connected/);
    assert.ok(AUTHORITY_LEVELS.indexOf(p.ceiling) < AUTHORITY_LEVELS.indexOf('execute'), `${p.id} ceiling`);
  }
});

test('authority is clamped to the ceiling, and execute needs explicit authorization even if a ceiling ever allowed it', () => {
  const planning = participantById('planning')!;
  assert.equal(effectiveAuthority(planning, 'observe'), 'observe');
  assert.equal(effectiveAuthority(planning, 'execute'), 'propose', 'above ceiling');
  assert.equal(effectiveAuthority(planning, 'execute', true), 'propose', 'authorization cannot raise a ceiling');
  const hypothetical = { ...planning, ceiling: 'execute' as const };
  assert.equal(effectiveAuthority(hypothetical, 'execute'), 'propose', 'no explicit authorization');
  assert.equal(effectiveAuthority(hypothetical, 'execute', true), 'execute');
  assert.deepEqual(grantAuthority({ planning: 'execute', nobody: 'observe' }), [{ id: 'planning', authority: 'propose' }]);
});

test('Overseer coordinates a real situation: overdue task waiting on unfinished work with no owner', () => {
  const state = scenario();
  const task = get(state, 'install');
  const brief = coordinate(state, task, T0, workKind(task));
  const ids = brief.recommended.map(r => r.id);
  assert.equal(ids[0], 'overseer');
  for (const id of ['planning', 'scheduling', 'resources', 'operations']) assert.ok(ids.includes(id as never), `${id} recommended`);
  assert.ok(brief.recommended.every(r => r.why.length > 8 && r.state === 'experimental'));
  assert.ok(brief.conflicts.some(c => /overdue while Planning reports/.test(c)), brief.conflicts.join('|'));
  assert.ok(brief.conflicts.some(c => /nobody is assigned/.test(c)));
  assert.ok(brief.missing.includes('Owner'));
  assert.ok(brief.decisions.length >= 2, 'conflicts become decisions for a person');
  assert.ok(brief.findings.length > 0 && brief.findings.every(f => f.evidence.length > 0), 'every finding cites task fields');
  assert.equal(brief.basis, 'rules');
});

test('relevance follows the task: a clean assigned task does not summon every specialist', () => {
  const state = scenario();
  const task = get(state, 'supplier');
  const brief = coordinate(state, task, T0, workKind(task));
  assert.ok(brief.recommended.length < PARTICIPANTS.length, 'not everyone');
  assert.deepEqual(brief.conflicts, []);
  assert.ok(!brief.missing.includes('Owner'));
});

test('operations sees the work waiting on this task', () => {
  const state = scenario();
  const findings = reading('operations', state, get(state, 'install'), T0);
  assert.ok(findings.some(f => /waiting on this one: Crew starts install/.test(f.text)));
});

test('coordination only reads: the state is not changed', () => {
  const state = scenario(); const before = JSON.stringify(state);
  analyze(state, get(state, 'install'), T0);
  assert.equal(JSON.stringify(state), before);
});

test('existing tool selection is preserved: analyze returns the same proposal as propose', () => {
  const state = scenario(); const task = get(state, 'install');
  assert.deepEqual(analyze(state, task, T0).proposal, propose(task));
});

test('templates keep working with and without specialists; reuse still drops what is unusable', () => {
  const old = saveTemplate([], { name: 'Old', kind: 'general', capabilityIds: ['tool.ask'], owner: 'alex', now: T0 });
  assert.equal(old[0]!.participantIds, undefined);
  const list = saveTemplate(old, { name: 'With team', kind: 'plan', capabilityIds: ['tool.ask', 'model.llm'], participantIds: ['overseer', 'planning', 'planning'], owner: 'alex', now: T0 + 1 });
  assert.deepEqual(list[1]!.participantIds, ['overseer', 'planning']);
  assert.deepEqual(applyTemplate(list[1]!).ids, ['tool.ask']);
});

test('the history line names specialists with their authority and says no model is connected', () => {
  const note = workbenchNote(['Calendar'], 'schedule', [{ name: 'Scheduling', authority: 'propose' }]);
  assert.match(note, /Scheduling \(propose\)/); assert.match(note, /No model is connected/);
  assert.equal(workbenchNote(['Calendar'], 'schedule'), 'Working setup chosen (schedule): Calendar.', 'unchanged without specialists');
});
