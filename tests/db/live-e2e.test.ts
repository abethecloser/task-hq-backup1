// Browser adapter → dispatch handler → database, end to end, with nothing scripted:
// the real live adapter (src/adapter/live.ts) sends real requests to the real dispatch
// handler, which runs the real engine and persists through the real SQL functions as
// service_role. Two separate signed-in users share one workspace; a third belongs to
// another organization.
//
// Scope, stated plainly: this exercises the CANDIDATE server (local dispatch source,
// which needs the operational-attention migration's commit/initialize RPCs), not the
// dispatch v3 deployed today. PGlite + stubbed Supabase auth; no PostgREST, no network,
// no Realtime (subscriptions are stubbed), no real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBackend } from '../../src/adapter/live.ts';
import type { QuestBackend } from '../../src/adapter/store.ts';
import { handleDispatch } from '../../supabase/functions/dispatch/handler.ts';
import { PRODUCTION_BASELINE, addMember, addOrg, addUser, createDb, serviceClient } from './pg.ts';
import type { Db } from './pg.ts';

const URL_BASE = 'https://task-hq.test';
const CANDIDATE = [...PRODUCTION_BASELINE, '20261017230608_operational_attention.sql'];

async function world() {
  const db = await createDb(CANDIDATE);
  const x = await addOrg(db, 'synthetic-roofing', 'Synthetic Roofing');
  const y = await addOrg(db, 'synthetic-other', 'Synthetic Other');
  const owner = await addUser(db, 'owner@example.test', 'Olive Owner');
  const member = await addUser(db, 'member@example.test', 'Milo Member');
  const reviewer = await addUser(db, 'reviewer@example.test', 'Rae Reviewer');
  const outsider = await addUser(db, 'outsider@example.test', 'Otto Outsider');
  await addMember(db, x, owner, 'owner', 'manager');
  await addMember(db, x, member, 'member', 'field');
  await addMember(db, x, reviewer, 'reviewer', 'reviewer');
  await addMember(db, y, outsider, 'owner', 'manager');
  const tokens = new Map([['tok-owner', owner], ['tok-member', member], ['tok-reviewer', reviewer], ['tok-outsider', outsider]]);
  const admin = serviceClient(db);
  const deps = {
    getUser: async (authorization: string) => { const id = tokens.get(authorization.replace(/^Bearer /, '')); return id ? { id, email: `${id}@example.test` } : null; },
    getAdmin: () => admin as never,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== `${URL_BASE}/functions/v1/dispatch`) throw new Error(`unexpected request to ${url}`);
    return handleDispatch(new Request(url, init), deps);
  }) as typeof fetch;
  /** A fresh browser session for one user: its own adapter, its own cached state. */
  const session = (token: string, userId: string, org = x): QuestBackend => createLiveBackend(
    { auth: { getSession: async () => ({ data: { session: { access_token: token } } }) }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: async () => undefined } as never,
    URL_BASE, 'publishable-test-key', { id: org, name: 'Synthetic Roofing' }, userId);
  const audit = async (pattern: string) => (await db.pg.query<{ action: string; actor: string; detail: Record<string, unknown> }>(`select action, actor, detail from public.audit_log where action like $1 order by id`, [pattern])).rows;
  const done = async () => { globalThis.fetch = originalFetch; await db.close(); };
  return { db, x, owner, member, reviewer, outsider, session, audit, done };
}

test('create → assign → start → complete persists and is visible across separate users and sessions', async () => {
  const w = await world();
  try {
    const ownerSession = w.session('tok-owner', w.owner);
    const first = await ownerSession.load();
    assert.equal(first.rev, 1, 'first load initializes the workspace through initialize_workspace');
    assert.deepEqual(first.people.map(item => item.name).sort(), ['Milo Member', 'Olive Owner', 'Rae Reviewer'], 'people come from real memberships');

    const created = await ownerSession.dispatch({ type: 'task/create', task: { title: 'Measure the garage roof', owner: w.member, due: '2026-10-24' } }, w.owner);
    assert.equal(created.ok, true, created.ok ? '' : created.error);
    const taskId = created.state.tasks.find(item => item.title === 'Measure the garage roof')!.id;
    assert.equal(created.state.rev, 2);

    // A different person, in their own session, sees the persisted task and moves it.
    const memberSession = w.session('tok-member', w.member);
    const seen = await memberSession.load();
    assert.equal(seen.tasks.find(item => item.id === taskId)?.owner, w.member);
    const started = await memberSession.dispatch({ type: 'task/advance', id: taskId }, w.member);
    assert.equal(started.ok && started.state.tasks.find(item => item.id === taskId)?.status, 'working');
    const finished = await memberSession.dispatch({ type: 'task/advance', id: taskId }, w.member);
    assert.equal(finished.ok && finished.state.tasks.find(item => item.id === taskId)?.status, 'done');

    // The owner's next session reads the member's change from the database.
    const reloaded = await w.session('tok-owner', w.owner).load();
    assert.equal(reloaded.tasks.find(item => item.id === taskId)?.status, 'done');
    assert.equal(reloaded.rev, 4);
    assert.equal(reloaded.events.find(item => item.taskId === taskId && item.text.includes('completed'))?.actor, w.member, 'history names the real actor');
    const stored = await w.db.pg.query<{ rev: number }>('select rev from public.workspace_state where org_id = $1', [w.x]);
    assert.equal(stored.rows[0]!.rev, 4, 'the database holds the same revision the users saw');
    assert.deepEqual((await w.audit('task.task/%')).map(row => row.action), ['task.task/create', 'task.task/advance', 'task.task/advance'], 'every executed write is audited');
  } finally { await w.done(); }
});

test('outcomes are inspectable: executed effects, denied and failed attempts leave a durable trace', async () => {
  const w = await world();
  try {
    const owner = w.session('tok-owner', w.owner);
    await owner.load();
    const gate = await owner.dispatch({ type: 'task/create', task: { title: 'Gate', owner: w.owner, nextOwner: w.member } }, w.owner);
    const gateId = gate.state.tasks[0]!.id;
    const next = await owner.dispatch({ type: 'task/create', task: { title: 'Unlocked by gate', owner: '', dependsOn: [gateId] } }, w.owner);
    const nextId = next.state.tasks[0]!.id;
    await owner.dispatch({ type: 'task/advance', id: gateId }, w.owner);
    const completed = await owner.dispatch({ type: 'task/advance', id: gateId }, w.owner);
    assert.ok(completed.ok);
    const event = (await w.session('tok-member', w.member).load()).events.find(item => item.id === (completed.ok ? completed.eventId : ''))!;
    assert.deepEqual(event.effects, [{ rule: 'dependency-unlock', outcome: 'executed', taskId: nextId, owner: w.member }], 'the automatic unlock is persisted with its outcome');

    // Denied: a reviewer may not move work. Nothing changes; the attempt is recorded.
    const reviewer = w.session('tok-reviewer', w.reviewer);
    const before = (await reviewer.load()).rev;
    const denied = await reviewer.dispatch({ type: 'task/advance', id: nextId }, w.reviewer);
    assert.equal(denied.ok, false);
    assert.equal((await w.session('tok-owner', w.owner).load()).rev, before, 'a refused action changes nothing');
    const deniedRows = await w.audit('%.denied');
    assert.equal(deniedRows.length, 1);
    assert.equal(deniedRows[0]!.action, 'task.task/advance.denied');
    assert.equal(deniedRows[0]!.actor, w.reviewer);
    assert.deepEqual((deniedRows[0]!.detail as { target: unknown }).target, { id: nextId });
    assert.match(String((deniedRows[0]!.detail as { reason: string }).reason), /Reviewers/);

    // Failed: the database refuses the commit (simulated by revoking the commit function).
    await w.db.pg.exec('revoke execute on function public.commit_workspace_action(uuid, uuid, integer, jsonb, text, jsonb, jsonb) from service_role, public');
    const failed = await owner.dispatch({ type: 'task/create', task: { title: 'Will not save', owner: w.owner } }, w.owner);
    assert.equal(failed.ok, false);
    const failedRows = await w.audit('%.failed');
    assert.equal(failedRows.length, 1);
    assert.equal(failedRows[0]!.action, 'task.task/create.failed');
    assert.equal((await w.session('tok-member', w.member).load()).tasks.some(item => item.title === 'Will not save'), false, 'a failed write is not visible to anyone');
  } finally { await w.done(); }
});

test('command input: a reviewed plan is created through the server and seen by another user, with type, tags, time and the dependency', async () => {
  const w = await world();
  try {
    const { parseCommand, newTaskFrom } = await import('../../src/core/command.ts');
    const owner = w.session('tok-owner', w.owner);
    const loaded = await owner.load();
    const configured = await owner.dispatch({ type: 'taxonomy/update', taxonomy: { types: [{ id: 'meeting', label: 'Meeting', keywords: ['meeting'] }, { id: 'follow-up', label: 'Follow-up', keywords: ['follow-up'] }], tags: ['permits'] } }, w.owner);
    assert.ok(configured.ok, configured.ok ? '' : configured.error);
    const now = Date.now();
    const drafts = parseCommand('Meeting with @Milo tomorrow at 9am about permits #permits !high, then assign the follow-up to Milo', configured.state, now);
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0]!.owner, null, 'the mention is a watcher, not an owner');
    const reviewed = drafts.map(draft => ({ ...draft, owner: draft.owner && { ...draft.owner, confirmed: true } }));
    const ids: Record<string, string> = {};
    for (const draft of reviewed) {
      const res = await owner.dispatch({ type: 'task/create', task: newTaskFrom(draft, ids, { taxonomy: true }) }, w.owner);
      assert.ok(res.ok, res.ok ? '' : res.error);
      ids[draft.key] = res.state.events.find(event => event.id === res.eventId)!.taskId!;
    }
    // Another person, in a separate session, reads exactly what was approved.
    const seen = await w.session('tok-member', w.member).load();
    const meeting = seen.tasks.find(task => task.id === ids.d1)!;
    const follow = seen.tasks.find(task => task.id === ids.d2)!;
    assert.deepEqual([meeting.type, meeting.tags, meeting.dueTime, meeting.priority, meeting.owner, meeting.watchers], ['meeting', ['permits'], '09:00', 'high', '', [w.member]]);
    assert.deepEqual([follow.type, follow.owner, follow.dependsOn], ['follow-up', w.member, [meeting.id]]);
    assert.ok(loaded.rev < seen.rev);
    // A member can't change the organization's task types.
    const refused = await w.session('tok-member', w.member).dispatch({ type: 'taxonomy/update', taxonomy: { types: [], tags: [] } }, w.member);
    assert.equal(refused.ok, false);
  } finally { await w.done(); }
});

test('tenant isolation over the real path: another organization and anonymous callers get nothing', async () => {
  const w = await world();
  try {
    await w.session('tok-owner', w.owner).load();
    await assert.rejects(w.session('tok-outsider', w.outsider).load(), /not a member/, 'an owner of another organization cannot load this workspace');
    const outsider = w.session('tok-outsider', w.outsider);
    const attempt = await outsider.dispatch({ type: 'task/create', task: { title: 'Planted', owner: '' } }, w.outsider).catch(() => ({ ok: false }));
    assert.equal(attempt.ok, false);
    assert.equal((await w.session('tok-member', w.member).load()).tasks.some(item => item.title === 'Planted'), false);
    await assert.rejects(w.session('tok-unknown', 'nobody').load(), /Sign in/, 'an unknown session is refused');
    assert.equal((await w.audit('%.denied')).length, 0, 'non-members are refused before any workspace is read, so nothing is attributed to them');
  } finally { await w.done(); }
});
