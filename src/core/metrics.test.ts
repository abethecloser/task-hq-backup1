import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { operationalMeasures } from './metrics.ts';
import { seedState } from './seed.ts';
import { HOUR, MINUTE } from './time.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
const at = (state: QuestState, actor: string, action: Action, now: number) => { const r = apply(state, action, { actor, now, newId: () => `m${now}${action.type}`, writer: 'test' }); if (!r.ok) throw new Error(r.error); return r.state; };
const measure = (state: QuestState, key: string, now = T0) => operationalMeasures(state, now, 'jordan').measures.find(item => item.key === key)!;

test('measures come only from recorded work and state their sample size', () => {
  let state = seedState(T0);
  assert.equal(measure(state, 'blocked-to-resolved').value, null, 'no fabricated value without data');
  assert.equal(measure(state, 'blocked-to-resolved').sample, 0);
  state = at(state, 'alex', { type: 'task/advance', id: 'safety-brief' }, T0);
  state = at(state, 'alex', { type: 'task/request-help', id: 'safety-brief', note: 'Need the checklist', helper: 'maya' }, T0 + HOUR);
  state = at(state, 'maya', { type: 'task/resolve', id: 'safety-brief' }, T0 + 4 * HOUR);
  const blocked = measure(state, 'blocked-to-resolved', T0 + 4 * HOUR);
  assert.equal(blocked.value, 3);
  assert.equal(blocked.sample, 1);
});

test('lead response reuses Speed to Lead timing; rework counts send-backs and reopens; bid readiness is not invented', () => {
  let state = seedState(T0);
  const lead = measure(state, 'lead-first-response');
  assert.equal(lead.sample, 1);
  assert.equal(lead.value, 4, 'the seeded lead arrived 40 min ago and was answered 36 min ago');
  state = at(state, 'jordan', { type: 'task/send-back', id: 'maple-estimate', note: 'Add the gutter line' }, T0 + MINUTE);
  state = at(state, 'jordan', { type: 'task/reopen', id: 'site-plan', note: 'Layout changed' }, T0 + 2 * MINUTE);
  const rework = measure(state, 'rework', T0 + 2 * MINUTE);
  assert.equal(rework.value, 2);
  assert.match(rework.note, /1 sent back.*1 reopened/);
  assert.equal(measure(state, 'bid-readiness').value, null);
  assert.equal(operationalMeasures(state, T0, 'jordan').partial, false);
});
