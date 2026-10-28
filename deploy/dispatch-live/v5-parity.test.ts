// Differential test: production dispatch v4 vs candidate v5 on the same stored state.
// v5 may only differ where v4 answered "not available on this server" (400) for an
// action v5 deliberately adds. Everything both accept must decide and change the same way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v4 from './v4/logic.ts';
import * as v5 from './v5/logic.ts';
import type { MemberRow, OrgRow } from './v4/logic.ts';
import type { Action, Lead, QuestState } from './v5/core/contract.ts';

const T0 = new Date('2026-10-20T09:00:00').getTime();
const ORG: OrgRow = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const id = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const OWNER = id('a'), ADMIN = id('b'), SUPERVISOR = id('c'), MEMBER_TITLED = id('d'), MEMBER = id('e'), REVIEWER = id('f');
const members: MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: ADMIN, role: 'admin', work_role: 'coordinator', name: 'Admin Person' },
  { user_id: SUPERVISOR, role: 'supervisor', work_role: 'field', name: 'Supervisor Person' },
  // Work title "manager" must never grant authority.
  { user_id: MEMBER_TITLED, role: 'member', work_role: 'manager', name: 'Titled Member' },
  { user_id: MEMBER, role: 'member', work_role: 'field', name: 'Crew Member' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];
const ROLES = { owner: OWNER, admin: ADMIN, supervisor: SUPERVISOR, titledMember: MEMBER_TITLED, member: MEMBER, reviewer: REVIEWER };
/** Actions v5 adds on purpose. v4 answers 400 for them. */
const ADDED = new Set(['task/reopen', 'lead/claim', 'lead/tags', 'roles/label', 'taxonomy/register-tags', 'taxonomy/update']);

function must(result: v4.RunResult): QuestState { if (!result.ok) throw new Error(result.error); return result.state; }
const lead = (lid: string, assignee: string): Lead => ({ id: lid, name: `Lead ${lid}`, source: 'phone', phone: '555-0100', address: '1 Main St', need: 'Roof leak', arrivedAt: T0, assignee, assignedAt: assignee ? T0 : null, firstResponseAt: null, attempts: [], stage: 'new', blocker: '', followUpTaskId: '', handoffTaskId: '', escalatedTo: '', simulated: false, updatedAt: T0 });

/** Stored state exactly as production v4 writes it today. */
function v4Stored(): QuestState {
  let s = v4.emptyState(ORG, members, T0);
  const create = (title: string, owner: string) => { s = must(v4.runAction(s, ORG, members, OWNER, { type: 'task/create', task: { title, owner } } as Action, T0)); return s.tasks.find(t => t.title === title)!.id; };
  const tA = create('Titled member task', MEMBER_TITLED);
  const tB = create('Crew task', MEMBER);
  create('Unassigned task', '');
  const tD = create('Finished task', MEMBER);
  for (let i = 0; i < 4 && s.tasks.find(t => t.id === tD)!.status !== 'done'; i++) s = must(v4.runAction(s, ORG, members, MEMBER, { type: 'task/advance', id: tD }, T0 + i));
  assert.equal(s.tasks.find(t => t.id === tD)!.status, 'done');
  s = { ...s, leads: [lead('l-open', ''), lead('l-crew', MEMBER)] };
  return Object.assign(s, { ids: { tA, tB, tD } });
}

function corpus(s: QuestState & { ids?: Record<string, string> }): [string, Action][] {
  const { tA, tB, tD } = s.ids!;
  const lastEvent = s.events[0]!.id;
  return ([
    ['create own', { type: 'task/create', task: { title: 'New own task' } }],
    ['create for crew', { type: 'task/create', task: { title: 'Delegated', owner: MEMBER } }],
    ['comment', { type: 'task/comment', id: tB, note: 'Checked the gutters' }],
    ['reassign crew task', { type: 'task/update', id: tB, changes: { owner: MEMBER_TITLED } }],
    ['priority', { type: 'task/update', id: tB, changes: { priority: 'high' } }],
    ['due', { type: 'task/update', id: tB, changes: { due: '2026-10-25' } }],
    ['edit other member task', { type: 'task/update', id: tA, changes: { nextAction: 'Call the client' } }],
    ['advance', { type: 'task/advance', id: tB }],
    ['request help', { type: 'task/request-help', id: tB, note: 'Need a ladder' }],
    ['resolve', { type: 'task/resolve', id: tB, note: 'Done' }],
    ['send back', { type: 'task/send-back', id: tB, note: 'Redo flashing' }],
    ['handoff', { type: 'task/handoff', id: tB, to: MEMBER_TITLED, note: 'Yours' }],
    ['reopen', { type: 'task/reopen', id: tD, note: 'Leak returned' }],
    ['ultra activate', { type: 'ultra/activate', taskId: tB }],
    ['ultra release', { type: 'ultra/release' }],
    ['grant request', { type: 'grant/request', section: 'leads', reason: 'Cover shift' }],
    ['lead claim', { type: 'lead/claim', id: 'l-open' }],
    ['lead assign', { type: 'lead/assign', id: 'l-open', to: MEMBER }],
    ['lead attempt', { type: 'lead/attempt', id: 'l-crew', channel: 'call', outcome: 'reached', note: 'Spoke' }],
    ['lead qualify', { type: 'lead/qualify', id: 'l-crew' }],
    ['lead block', { type: 'lead/block', id: 'l-crew', note: 'No answer' }],
    ['lead follow-up', { type: 'lead/follow-up', id: 'l-crew', due: '2026-10-22' }],
    ['lead advance', { type: 'lead/advance', id: 'l-crew' }],
    ['lead escalate', { type: 'lead/escalate', id: 'l-crew', note: 'Big job' }],
    ['lead tags own lead', { type: 'lead/tags', id: 'l-crew', tags: ['vip'] }],
    ['lead tags open lead', { type: 'lead/tags', id: 'l-open', tags: ['vip'] }],
    ['role label', { type: 'roles/label', personId: MEMBER, label: 'Crew lead' }],
    ['policy routine', { type: 'policy/update', changes: { stalledHours: 12 } }],
    ['policy owner-only', { type: 'policy/update', changes: { ultraActivators: ['field'] } }],
    ['register tags', { type: 'taxonomy/register-tags', tags: ['permits'] }],
    ['taxonomy update', { type: 'taxonomy/update', taxonomy: { types: [{ id: 'inspection', label: 'Inspection' }], tags: ['permits'] } }],
    ['undo latest', { type: 'undo', eventId: lastEvent }],
    ['feedback', { type: 'feedback/create', item: { category: 'idea', title: 'Idea', body: 'Body', context: {} } }],
    ['workspace rename', { type: 'workspace/update', changes: { name: 'Renamed' } }],
    ['demo reset', { type: 'demo/reset' }],
    ['invite draft', { type: 'invite/draft', email: 'x@example.com', days: 7 }],
    ['simulated lead', { type: 'lead/receive', lead: { name: 'X', source: 'web', phone: '1', address: '1', need: 'x' } }],
    ['unknown', { type: 'nope/never' }],
  ] as [string, unknown][]).map(([name, action]) => [name, action as Action]);
}

/** The operational facts both versions store; v5 additionally indexes references. */
/** Generated ids are random per run; number them by first appearance instead. */
const stableIds = (json: string) => { const seen = new Map<string, string>(); return json.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, uuid => (Object.values(ROLES).includes(uuid) ? uuid : seen.get(uuid) ?? (seen.set(uuid, `#${seen.size}`), seen.get(uuid)!))); };
const facts = (s: QuestState) => stableIds(JSON.stringify({
  tasks: s.tasks.map(t => [t.id, t.title, t.owner, t.status, t.priority, t.due, t.approver, t.nextAction, t.waitingOn, t.dependsOn, t.completedAt, t.ultra, t.watchers]),
  leads: s.leads.map(l => [l.id, l.assignee, l.stage, l.blocker, l.followUpTaskId, l.escalatedTo, l.attempts.length]),
  focus: s.focus, grants: s.grants.map(g => [g.status, g.section, g.requester]), policy: s.policy, workspace: s.workspace.name,
  events: s.events.map(e => [e.kind, e.actor, e.taskId, e.leadId, e.text, !!e.undo, e.undone]),
}));
const outcome = (r: v4.RunResult) => (r.ok ? 'ok' : `${r.status}`);

test('v5 decides every shared action exactly like production v4, for every org role', () => {
  const stored = v4Stored();
  const matrix: Record<string, Record<string, string>> = {};
  const mismatches: string[] = [];
  for (const [roleName, actor] of Object.entries(ROLES)) {
    for (const [name, action] of corpus(stored)) {
      const a = v4.runAction(stored, ORG, members, actor, action, T0 + 60_000);
      const b = v5.runAction(stored, ORG, members, actor, action, T0 + 60_000);
      if (ADDED.has(action.type)) {
        assert.notEqual(outcome(a), 'ok', `v4 must not accept ${action.type}`);
        (matrix[name] ??= {})[roleName] = outcome(b);
        continue;
      }
      if (outcome(a) !== outcome(b)) { mismatches.push(`${roleName} · ${name}: v4 ${outcome(a)} (${a.ok ? '' : a.error}) vs v5 ${outcome(b)} (${b.ok ? '' : b.error})`); continue; }
      if (a.ok && b.ok && facts(a.state) !== facts(b.state)) mismatches.push(`${roleName} · ${name}: same verdict, different stored facts`);
    }
  }
  assert.deepEqual(mismatches, []);
  // Newly enabled actions: authority from org role only; reviewers change nothing.
  assert.deepEqual(matrix['reopen'], { owner: 'ok', admin: 'ok', supervisor: 'ok', titledMember: '422', member: 'ok', reviewer: '422' }, 'task owner or coordinator reopens');
  assert.deepEqual(matrix['role label'], { owner: 'ok', admin: 'ok', supervisor: '422', titledMember: '422', member: '422', reviewer: '422' });
  assert.deepEqual(matrix['taxonomy update'], { owner: 'ok', admin: 'ok', supervisor: '422', titledMember: '422', member: '422', reviewer: '422' });
  assert.deepEqual(matrix['lead tags open lead'], { owner: 'ok', admin: 'ok', supervisor: 'ok', titledMember: '422', member: '422', reviewer: '422' });
  assert.deepEqual(matrix['lead tags own lead'], { owner: 'ok', admin: 'ok', supervisor: 'ok', titledMember: '422', member: 'ok', reviewer: '422' });
  assert.equal(matrix['lead claim']!.reviewer, '422');
  assert.equal(matrix['register tags']!.reviewer, '422');
});

test('deliberate difference: v5 refuses non-editable task/update fields that v4 writes verbatim', () => {
  const stored = v4Stored();
  const { tB } = (stored as QuestState & { ids: Record<string, string> }).ids;
  // tB is owned by MEMBER, so ownership checks pass and only the field allowlist decides.
  for (const changes of [{ status: 'done' }, { ultra: true }, { createdBy: OWNER }, { id: 'hijack' }]) {
    const action = { type: 'task/update', id: tB, changes } as unknown as Action;
    assert.equal(outcome(v4.runAction(stored, ORG, members, MEMBER, action, T0 + 60_000)), 'ok', `v4 (production) accepts ${JSON.stringify(changes)}`);
    assert.equal(outcome(v5.runAction(stored, ORG, members, MEMBER, action, T0 + 60_000)), '422', `v5 refuses ${JSON.stringify(changes)}`);
  }
});

test('rollback is safe: production v4 keeps working on state written by v5', () => {
  const stored = v4Stored();
  const { tB, tD } = (stored as QuestState & { ids: Record<string, string> }).ids;
  let s = stored;
  for (const [actor, action] of [
    [OWNER, { type: 'taxonomy/update', taxonomy: { types: [{ id: 'inspection', label: 'Inspection' }], tags: ['permits'] } }],
    [MEMBER, { type: 'task/reopen', id: tD, note: 'Leak returned' }],
    [MEMBER, { type: 'task/update', id: tB, changes: { type: 'inspection', tags: ['permits'], due: '2026-10-25', dueTime: '09:30' } }],
    [MEMBER, { type: 'lead/tags', id: 'l-crew', tags: ['vip'] }],
    [MEMBER, { type: 'task/comment', id: tB, note: '@Owner Person please check #permits' }],
    [OWNER, { type: 'roles/label', personId: MEMBER, label: 'Crew lead' }],
  ] as [string, Action][]) s = must(v5.runAction(s, ORG, members, actor, action, T0 + 60_000));
  assert.equal(s.tasks.find(t => t.id === tD)!.status, 'ready');
  assert.ok(s.events[0]!.references, 'v5 stores structured mentions');
  const roundTrip = JSON.parse(JSON.stringify(s)) as QuestState;
  assert.ok(v4.withAuthority(roundTrip, ORG, members).tasks.length >= 4);
  for (const [actor, action] of [
    [MEMBER, { type: 'task/advance', id: tD }],
    [MEMBER, { type: 'task/comment', id: tB, note: 'Still on it' }],
    [OWNER, { type: 'task/update', id: tB, changes: { priority: 'high' } }],
    [MEMBER, { type: 'lead/attempt', id: 'l-crew', channel: 'call', outcome: 'reached' }],
  ] as [string, Action][]) {
    const r = v4.runAction(roundTrip, ORG, members, actor, action, T0 + 120_000);
    assert.ok(r.ok, `${action.type} on v5 state under v4: ${r.ok ? '' : r.error}`);
  }
});

test('v5 core is the current engine, byte for byte', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('./v5/core/', import.meta.url);
  for (const file of readdirSync(dir)) assert.equal(readFileSync(new URL(file, dir), 'utf8'), readFileSync(new URL(`../../src/core/${file}`, import.meta.url), 'utf8'), `${file} drifted; run npm run sync:functions`);
});
