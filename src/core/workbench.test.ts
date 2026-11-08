import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, applyTemplate, isUsable, propose, recordFeedback, saveTemplate, workKind } from './workbench.ts';
import { blankTask, seedState } from './seed.ts';

const T0 = new Date('2026-11-08T09:00:00').getTime();
const task = (title: string, nextAction = '') => blankTask('t1', { title, nextAction, owner: 'alex', projectId: seedState(T0).projects[0]!.id }, 'alex', T0);

test('work kind comes from the words, with general as the fallback', () => {
  assert.equal(workKind(task('Quote the Maple roof')), 'estimate');
  assert.equal(workKind(task('Dispute klarna', 'Call Klarna')), 'communicate');
  assert.equal(workKind(task('Misc')), 'general');
});

test('a proposal explains every pick and never counts unusable capabilities as picks', () => {
  const p = propose(task('Research roofing suppliers'));
  assert.equal(p.basis, 'rules');
  for (const pick of p.picks) assert.ok(pick.why.length > 10);
  const ids = p.picks.map(x => x.capabilityId);
  assert.ok(!ids.includes('model.llm') && !ids.includes('participant.qbio'), 'disconnected things are not picked');
  assert.ok(p.missing.some(m => m.capabilityId === 'model.llm'), 'but they are named as missing, with the reason');
  assert.match(p.missing.find(m => m.capabilityId === 'participant.qbio')!.why, /No QBIO contract/);
});

test('catalog honesty: nothing claims a provider or QBIO is usable', () => {
  for (const id of ['model.llm', 'participant.qbio']) assert.equal(isUsable(CATALOG.find(c => c.id === id)!), false);
  assert.equal(new Set(CATALOG.map(c => c.id)).size, CATALOG.length, 'one registry, unique ids');
});

test('templates: saved per person, replaced by name, reused with honest drops', () => {
  let list = saveTemplate([], { name: 'Supplier research', kind: 'research', capabilityIds: ['tool.ask', 'model.llm', 'gone.id', 'tool.ask'], owner: 'alex', now: T0 });
  assert.deepEqual(list[0]!.capabilityIds, ['tool.ask', 'model.llm', 'gone.id']);
  list = saveTemplate(list, { name: 'supplier research', kind: 'research', capabilityIds: ['tool.ask'], owner: 'alex', now: T0 + 1 });
  assert.equal(list.length, 1, 'same owner and name replaces');
  list = saveTemplate(list, { name: 'Supplier research', kind: 'research', capabilityIds: ['tool.ask'], owner: 'sam', now: T0 + 2 });
  assert.equal(list.length, 2, 'another person keeps their own');
  const reused = applyTemplate({ ...list[0]!, capabilityIds: ['tool.ask', 'model.llm', 'gone.id'] });
  assert.deepEqual(reused.ids, ['tool.ask']);
  assert.deepEqual(reused.dropped.map(d => d.id), ['model.llm', 'gone.id']);
  assert.throws(() => saveTemplate([], { name: ' ', kind: 'general', capabilityIds: ['tool.ask'], owner: 'a', now: T0 }));
  assert.throws(() => saveTemplate([], { name: 'x', kind: 'general', capabilityIds: [], owner: 'a', now: T0 }));
});

test('feedback keeps one entry per person and task, and caps the note', () => {
  let log = recordFeedback([], { taskId: 't1', actor: 'alex', at: T0, worked: false, note: 'meh' });
  log = recordFeedback(log, { taskId: 't1', actor: 'alex', at: T0 + 1, worked: true, note: 'x'.repeat(600) });
  assert.equal(log.length, 1); assert.equal(log[0]!.worked, true); assert.equal(log[0]!.note.length, 500);
});
