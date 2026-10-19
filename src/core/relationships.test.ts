import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from './engine.ts';
import { seedState, blankLead } from './seed.ts';
import { responseLeague } from './relationships.ts';
import { processAction, STATE_KEY } from '../adapter/store.ts';
const now = Date.parse('2026-10-18T12:00:00Z');
const world = () => ({ ...seedState(now), leads: [blankLead('inquiry', { name: 'Synthetic contact', phone: '555-0100', source: 'Synthetic', address: '', need: 'Estimate' }, now)] });
test('serialized competing claims produce one owner; loser cannot overwrite the claim', async () => {
  const data = new Map<string, unknown>([[STATE_KEY, world()]]);
  const kv = { async get<T>(k: string) { return (data.get(k) as T) ?? null; }, async set(k: string, v: unknown) { data.set(k, v); } };
  const results = await Promise.all(['sam', 'maya'].map(actor => processAction(kv, { type: 'lead/claim', id: 'inquiry' }, actor, 'test')));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal((await kv.get<ReturnType<typeof world>>(STATE_KEY))!.leads[0]!.assignee, 'sam');
});
test('work labels preserve authority; relationships reuse tasks and auditable lead history', () => {
  let state = world(); let n = 0;
  const act = (actor: string, action: Parameters<typeof apply>[1]) => { const r = apply(state, action, { actor, now, newId: () => `new-${++n}` }); if (r.ok) state = r.state; return r; };
  assert.equal(act('sam', { type: 'roles/label', label: 'Owner' }).ok, false);
  assert.equal(act('jordan', { type: 'roles/label', label: 'Operations & Systems Lead', personId: 'sam' }).ok, true);
  assert.equal(state.people.find(p => p.id === 'sam')!.role, 'sales');
  assert.equal(act('abraham', { type: 'lead/claim', id: 'inquiry' }).ok, false);
  assert.equal(act('sam', { type: 'lead/claim', id: 'inquiry' }).ok, true);
  assert.equal(act('alex', { type: 'lead/tags', id: 'inquiry', tags: ['roof'] }).ok, false);
  assert.equal(act('sam', { type: 'lead/tags', id: 'inquiry', tags: ['roof'] }).ok, true);
  assert.equal(responseLeague(state).find(p => p.id === 'sam')!.points, 0);
  for (let i = 0; i < 3; i++) act('sam', { type: 'lead/attempt', id: 'inquiry', channel: 'phone', outcome: 'reached' });
  assert.equal(responseLeague(state).find(p => p.id === 'sam')!.points, 10);
  assert.equal(act('sam', { type: 'lead/follow-up', id: 'inquiry', due: '2026-10-19' }).ok, true);
  const task = state.tasks.find(t => t.id === state.leads[0]!.followUpTaskId)!;
  assert.equal(task.leadId, 'inquiry');
  assert.ok(state.events.some(e => e.leadId === 'inquiry' && e.taskId === task.id));
  // Completion, rather than scheduling or claim count, earns follow-up points.
  state = { ...state, tasks: state.tasks.map(t => t.id === task.id ? { ...t, status: 'done', completedAt: now } : t) };
  assert.equal(responseLeague(state).find(p => p.id === 'sam')!.points, 30);
});
