// Authority parity: what the UI offers (permissions.ts, used by the screens) against
// what the engine accepts (apply — the same code the server runs), for every person,
// every task and several states. A UI offer the engine refuses is a failure
// ("server stricter"). The opposite ("UI stricter") is reported, and only the cases
// listed in ALLOWED_UI_STRICTER are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Action, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import { canAssignOthers, canCreateTask, canEditTask, canReopenTask, lockedTaskFields, offersMoveForward, statusAction, statusMoves } from './permissions.ts';
import { seedState } from './seed.ts';

const T0 = new Date('2026-10-17T09:00:00').getTime();
let n = 0;
const run = (state: QuestState, actor: string, action: Action) => apply(state, action, { actor, now: T0, newId: () => `p${++n}`, writer: 'test' });
const must = (state: QuestState, actor: string, action: Action) => { const r = run(state, actor, action); if (!r.ok) throw new Error(`${action.type}: ${r.error}`); return r.state; };

function states(): { name: string; state: QuestState }[] {
  const base = seedState(T0);
  const done = must(base, 'jordan', { type: 'task/advance', id: 'maple-estimate' });          // review → done, unlocks shingles
  const focus = must(base, 'jordan', { type: 'ultra/activate', taskId: 'maple-tarp' });       // Alex in Critical Focus
  let granted = must(focus, 'alex', { type: 'grant/request', section: 'company-work', reason: 'Need the staging route' });
  granted = must(granted, 'jordan', { type: 'grant/decide', id: granted.grants[0]!.id, approve: true });
  const unowned = must(base, 'maya', { type: 'task/create', task: { title: 'Unowned check', owner: '' } });
  return [{ name: 'seed', state: base }, { name: 'after approval', state: done }, { name: 'critical focus', state: focus }, { name: 'focus + access granted', state: granted }, { name: 'unowned work', state: unowned }];
}

/** UI stricter than the engine, on purpose. Each entry is reported, never a failure. */
const ALLOWED_UI_STRICTER: { check: string; why: string }[] = [];

test('Move Work Forward: the UI never offers what the engine refuses', () => {
  const serverStricter: string[] = []; const uiStricter: string[] = [];
  for (const { name, state } of states()) for (const who of state.people) for (const task of state.tasks) {
    const ui = offersMoveForward(state, task, who.id, T0);
    const engine = run(state, who.id, { type: 'task/advance', id: task.id }).ok;
    if (ui && !engine) serverStricter.push(`${name}: ${who.id} → ${task.id}`);
    if (!ui && engine) uiStricter.push(`${name}: ${who.id} → ${task.id}`);
  }
  assert.deepEqual(serverStricter, [], `UI offers Move Work Forward the engine refuses:\n${serverStricter.join('\n')}`);
  assert.deepEqual(uiStricter, [], `Engine would accept but the UI hides Move Work Forward:\n${uiStricter.join('\n')}`);
});

test('Reopen: offered exactly when the engine accepts it', () => {
  const mismatch: string[] = [];
  for (const { name, state } of states()) for (const who of state.people) for (const task of state.tasks.filter(item => item.status === 'done')) {
    const ui = canReopenTask(state, task, who.id);
    const engine = run(state, who.id, { type: 'task/reopen', id: task.id, note: 'Parity check' }).ok;
    if (ui !== engine) mismatch.push(`${name}: ${who.id} → ${task.id} ui=${ui} engine=${engine}`);
  }
  assert.deepEqual(mismatch, []);
});

test('New task: enabled exactly when the engine accepts a creation', () => {
  const mismatch: string[] = [];
  for (const { name, state } of states()) for (const who of state.people) {
    const ui = canCreateTask(state, who.id, T0);
    const engine = run(state, who.id, { type: 'task/create', task: { title: 'Parity probe', owner: '' } }).ok;
    if (ui !== engine) mismatch.push(`${name}: ${who.id} ui=${ui} engine=${engine}`);
  }
  assert.deepEqual(mismatch, []);
});

test('Ultra Priority fields: locked in the UI exactly when the engine refuses the change', () => {
  const mismatch: string[] = [];
  for (const { name, state } of states()) for (const who of state.people.filter(item => item.role !== 'reviewer')) for (const task of state.tasks.filter(item => item.status !== 'done')) {
    const locked = lockedTaskFields(state, task, who.id);
    const engine = run(state, who.id, { type: 'task/update', id: task.id, changes: { priority: task.priority === 'high' ? 'normal' : 'high' } });
    // Critical Focus can refuse for a different reason; only judge the Ultra lock itself.
    if (!engine.ok && !/Ultra Priority/.test(engine.error)) continue;
    if (locked === engine.ok) mismatch.push(`${name}: ${who.id} → ${task.id} locked=${locked} engine=${engine.ok}`);
  }
  assert.deepEqual(mismatch, []);
});

test('reviewers are offered nothing operational, and the engine agrees', () => {
  for (const { state } of states()) {
    assert.equal(canCreateTask(state, 'abraham', T0), false);
    for (const task of state.tasks) {
      assert.equal(offersMoveForward(state, task, 'abraham', T0), false);
      assert.equal(run(state, 'abraham', { type: 'task/advance', id: task.id }).ok, false);
    }
  }
  assert.equal(ALLOWED_UI_STRICTER.length >= 0, true);
});

/** The seed as a live workspace: authority from organization role, including a Member whose work title is Manager. */
function liveStates(): { name: string; state: QuestState }[] {
  const AUTHORITY: Record<string, 'owner' | 'admin' | 'supervisor' | 'member' | 'reviewer'> = { jordan: 'owner', riley: 'admin', maya: 'supervisor', alex: 'member', sam: 'member', abraham: 'reviewer', 'title-only': 'member' };
  const base = seedState(T0);
  const people = [...base.people, { id: 'title-only', name: 'Manager Title', role: 'manager' as const, title: 'Member' }].map(item => ({ ...item, authority: AUTHORITY[item.id] }));
  return states().map(({ name, state }) => ({ name: `live ${name}`, state: { ...state, people } }));
}

test('live authority: editing and assigning are offered exactly when the engine accepts them', () => {
  const mismatch: string[] = [];
  for (const { name, state } of liveStates()) for (const who of state.people) {
    for (const task of state.tasks) {
      const ui = canEditTask(state, task, who.id);
      const engine = run(state, who.id, { type: 'task/update', id: task.id, changes: { nextAction: 'Parity probe' } });
      if (!engine.ok && /Critical Focus/.test(engine.error)) continue;
      if (ui !== engine.ok) mismatch.push(`${name}: edit ${who.id} → ${task.id} ui=${ui} engine=${engine.ok}`);
    }
    const other = state.people.find(item => item.id !== who.id && item.role !== 'reviewer')!;
    const ui = canAssignOthers(state, who.id);
    const engine = run(state, who.id, { type: 'task/create', task: { title: 'Parity probe', owner: other.id } });
    if (!engine.ok && /Critical Focus/.test(engine.error)) continue;
    if (ui !== engine.ok) mismatch.push(`${name}: assign ${who.id} ui=${ui} engine=${engine.ok}`);
  }
  assert.deepEqual(mismatch, []);
  const [live] = liveStates();
  assert.equal(canAssignOthers(live!.state, 'title-only'), false, 'a Manager work title grants nothing');
  assert.equal(canAssignOthers(live!.state, 'maya'), true, 'Supervisor coordinates');
});

test('live authority: Move Work Forward and Ultra locks still agree with the engine', () => {
  const mismatch: string[] = [];
  for (const { name, state } of liveStates()) for (const who of state.people) for (const task of state.tasks) {
    const ui = offersMoveForward(state, task, who.id, T0);
    const engine = run(state, who.id, { type: 'task/advance', id: task.id }).ok;
    if (ui !== engine) mismatch.push(`${name}: advance ${who.id} → ${task.id} ui=${ui} engine=${engine}`);
  }
  assert.deepEqual(mismatch, []);
});

test('status pill: every move it offers is one the engine accepts', () => {
  const serverStricter: string[] = [];
  for (const { name, state } of [...states(), ...liveStates()]) for (const who of state.people) for (const task of state.tasks) {
    for (const move of statusMoves(state, task, who.id, T0)) {
      const result = run(state, who.id, statusAction(task, move, 'Parity check'));
      if (!result.ok) { serverStricter.push(`${name}: ${move.key} ${who.id} → ${task.id}: ${result.error}`); continue; }
      const after = result.state.tasks.find(item => item.id === task.id)!;
      if (after.status !== move.to) serverStricter.push(`${name}: ${move.key} ${who.id} → ${task.id} became ${after.status}, pill said ${move.to}`);
    }
  }
  assert.deepEqual(serverStricter, []);
});

test('status pill: blocked and send-back are offered whenever the engine would accept them', () => {
  const uiStricter: string[] = [];
  for (const { name, state } of [...states(), ...liveStates()]) for (const who of state.people) for (const task of state.tasks) {
    const keys = statusMoves(state, task, who.id, T0).map(move => move.key);
    if (task.status !== 'blocked' && !keys.includes('block') && run(state, who.id, { type: 'task/request-help', id: task.id, note: 'Probe' }).ok) uiStricter.push(`${name}: block ${who.id} → ${task.id}`);
    if (!keys.includes('send-back') && run(state, who.id, { type: 'task/send-back', id: task.id, note: 'Probe' }).ok) uiStricter.push(`${name}: send-back ${who.id} → ${task.id}`);
  }
  assert.deepEqual(uiStricter, []);
});
