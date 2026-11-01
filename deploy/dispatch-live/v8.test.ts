// dispatch v8 (frozen; superseded by v9 before deploying): `task/archive` with reason `legacy` lets a supervisor, admin or owner archive
// unfinished work without completing it. Status is kept, restore returns it unchanged, and every
// active view leaves it out. v7 (the rollback target) refuses it and still reads v8 state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v7 from './v7/logic.ts';
import * as v8 from './v8/logic.ts';
import type { Action, QuestState, TaskStatus } from './v8/core/contract.ts';
import { isOpen, isOverdue, myTasks, withoutLegacyArchived } from '../../src/core/selectors.ts';
import { DEFAULT_QUERY, lensCounts, queryTasks } from '../../src/core/registry.ts';
import { companyReport } from '../../src/core/reports.ts';
import { atRisk, statusMix, teamWorkload } from '../../src/core/dashboard.ts';
import { livingLayout } from '../../src/core/living.ts';
import { canArchiveLegacy } from '../../src/core/permissions.ts';

const T0 = new Date('2026-10-29T09:00:00').getTime();
const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const id = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const OWNER = id('a'), ADMIN = id('b'), SUPERVISOR = id('c'), MEMBER = id('e'), REVIEWER = id('f');
const members: v8.MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: ADMIN, role: 'admin', work_role: 'coordinator', name: 'Admin Person' },
  { user_id: SUPERVISOR, role: 'supervisor', work_role: 'field', name: 'Supervisor Person' },
  { user_id: MEMBER, role: 'member', work_role: 'manager', name: 'Member Titled Manager' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];
let clock = T0;
function run(s: QuestState, who: string, action: Action) {
  const r = v8.runAction(s, ORG, members, who, action, (clock += 1000));
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`);
  return r.state;
}
const refuse = (s: QuestState, who: string, action: Action) => {
  const r = v8.runAction(s, ORG, members, who, action, (clock += 1000));
  assert.equal(r.ok, false, `${action.type} by ${who} should be refused`);
  return r.ok ? '' : r.error;
};
/** A member's own overdue task, moved to `status`, with a comment on it. */
function workspace(status: TaskStatus) {
  let s = v8.emptyState(ORG, members, T0);
  s = run(s, MEMBER, { type: 'task/create', task: { title: 'Call Donohue', owner: MEMBER, due: '2026-10-01' } } as Action);
  const task = s.tasks.find(t => t.title === 'Call Donohue')!;
  s = run(s, MEMBER, { type: 'task/comment', id: task.id, note: 'Left a voicemail.' });
  if (status === 'working' || status === 'review') s = run(s, MEMBER, { type: 'task/advance', id: task.id });
  if (status === 'review') s = run(s, OWNER, { type: 'task/update', id: task.id, changes: { approver: OWNER } });
  if (status === 'review') s = run(s, MEMBER, { type: 'task/advance', id: task.id });
  if (status === 'blocked') s = run(s, MEMBER, { type: 'task/request-help', id: task.id, note: 'Need the number.' });
  assert.equal(s.tasks.find(t => t.id === task.id)!.status, status);
  return { s, taskId: task.id };
}
const legacy = (taskId: string): Action => ({ type: 'task/archive', id: taskId, reason: 'legacy' });

test('legacy archive keeps the original status and records who, when and why', () => {
  for (const status of ['ready', 'working', 'blocked', 'review'] as TaskStatus[]) {
    const { s, taskId } = workspace(status);
    const before = s.tasks.find(t => t.id === taskId)!;
    const after = run(s, ADMIN, legacy(taskId));
    const task = after.tasks.find(t => t.id === taskId)!;
    assert.equal(task.status, status, 'not marked done');
    assert.equal(task.completedAt ?? null, null);
    assert.equal(task.completedBy ?? null, null);
    assert.equal(task.archivedBy, ADMIN);
    assert.equal(task.archivedAt, clock);
    assert.equal(task.archivedReason, 'legacy');
    // History is appended to, never rewritten.
    assert.equal(after.events.length, s.events.length + 1);
    assert.deepEqual(after.events.slice(1), s.events);
    assert.match(after.events[0]!.text, /archived “Call Donohue” as legacy data \(not completed\)/);
    assert.ok(after.events.some(e => e.text.includes('Left a voicemail.')), 'comment kept');
    assert.equal(task.title, before.title);
  }
});

test('restore returns legacy work to its original status, not done', () => {
  for (const status of ['ready', 'working', 'blocked', 'review'] as TaskStatus[]) {
    const { s, taskId } = workspace(status);
    const archived = run(s, SUPERVISOR, legacy(taskId));
    const restored = run(archived, OWNER, { type: 'task/unarchive', id: taskId });
    const task = restored.tasks.find(t => t.id === taskId)!;
    assert.equal(task.status, status);
    assert.equal(task.archivedAt, null);
    assert.equal(task.archivedBy, null);
    assert.equal(task.archivedReason, null);
    assert.ok(isOpen(task), 'active again');
    assert.match(restored.events[0]!.text, /restored “Call Donohue” from the archive/);
  }
});

test('only supervisors, admins and owners archive or restore unfinished work', () => {
  const { s, taskId } = workspace('working');
  assert.match(refuse(s, MEMBER, legacy(taskId)), /supervisor, admin or owner/);
  refuse(s, REVIEWER, legacy(taskId));
  for (const who of [OWNER, ADMIN, SUPERVISOR]) run(s, who, legacy(taskId));
  const archived = run(s, OWNER, legacy(taskId));
  for (const who of [MEMBER, REVIEWER]) refuse(archived, who, { type: 'task/unarchive', id: taskId });
  // The UI predicate agrees with the engine.
  for (const who of [OWNER, ADMIN, SUPERVISOR]) assert.equal(canArchiveLegacy(s, s.tasks.find(t => t.id === taskId)!, who), true);
  for (const who of [MEMBER, REVIEWER]) assert.equal(canArchiveLegacy(s, s.tasks.find(t => t.id === taskId)!, who), false);
});

test('unfinished work without the legacy reason, unknown reasons and double archives are refused', () => {
  const { s, taskId } = workspace('ready');
  assert.match(refuse(s, OWNER, { type: 'task/archive', id: taskId }), /Only completed work/);
  refuse(s, OWNER, { type: 'task/archive', id: taskId, reason: 'cleanup' } as unknown as Action);
  refuse(s, OWNER, { type: 'task/unarchive', id: taskId });
  const archived = run(s, OWNER, legacy(taskId));
  assert.match(refuse(archived, OWNER, legacy(taskId)), /already archived/);
});

test('legacy work is out of play until restored, but still takes comments', () => {
  const { s, taskId } = workspace('working');
  const archived = run(s, OWNER, legacy(taskId));
  for (const action of [
    { type: 'task/advance', id: taskId },
    { type: 'task/update', id: taskId, changes: { title: 'Renamed' } },
    { type: 'task/request-help', id: taskId, note: 'help' },
    { type: 'task/handoff', id: taskId, to: ADMIN },
  ] as Action[]) assert.match(refuse(archived, OWNER, action), /Restore this task from the archive first/);
  const commented = run(archived, MEMBER, { type: 'task/comment', id: taskId, note: 'For the record.' });
  assert.equal(commented.tasks.find(t => t.id === taskId)!.status, 'working');
});

test('completed-work archiving is unchanged', () => {
  const { s, taskId } = workspace('working');
  const done = run(s, MEMBER, { type: 'task/advance', id: taskId });
  assert.equal(done.tasks.find(t => t.id === taskId)!.status, 'done');
  // The member who owns finished work still archives it; the legacy reason is ignored for done work.
  const archived = run(done, MEMBER, { type: 'task/archive', id: taskId });
  const task = archived.tasks.find(t => t.id === taskId)!;
  assert.equal(task.status, 'done');
  assert.equal(task.archivedBy, MEMBER);
  assert.equal(task.archivedReason, null);
  assert.equal(archived.events[0]!.text, 'Member Titled Manager archived “Call Donohue”.');
  assert.equal(run(done, MEMBER, legacy(taskId)).tasks.find(t => t.id === taskId)!.archivedReason, null);
  const restored = run(archived, MEMBER, { type: 'task/unarchive', id: taskId });
  assert.equal(restored.tasks.find(t => t.id === taskId)!.status, 'done');
  refuse(done, REVIEWER, { type: 'task/archive', id: taskId });
});

test('every active view leaves legacy work out', () => {
  const { s, taskId } = workspace('blocked');
  const now = clock;
  const before = s.tasks.find(t => t.id === taskId)!;
  assert.ok(isOpen(before) && isOverdue(before, now), 'active and overdue before');
  const archived = run(s, OWNER, legacy(taskId));
  const task = archived.tasks.find(t => t.id === taskId)!;
  assert.equal(isOpen(task), false);
  assert.equal(isOverdue(task, now), false, 'overdue counts');
  assert.equal(myTasks(archived, MEMBER, now).length, 0, 'Home: my work');
  assert.equal(queryTasks(archived, MEMBER, now, DEFAULT_QUERY).length, 0, 'Tasks: open list');
  assert.deepEqual(queryTasks(archived, MEMBER, now, { ...DEFAULT_QUERY, status: 'archived' }).map(t => t.id), [taskId], 'Tasks: Archived filter');
  assert.deepEqual(lensCounts(archived, MEMBER, now), { all: 0, urgent: 0, today: 0, overdue: 0, watching: 0 }, 'tab counts');
  const report = companyReport(archived, OWNER, now, 'week', true);
  assert.equal(report.total, 0, 'Reports');
  assert.equal(report.overdue, 0, 'Reports overdue');
  // Views fed the active workspace (Home, Calendar, project rooms, the dock) see no trace of it.
  const active = withoutLegacyArchived(archived);
  assert.equal(active.tasks.length, 0);
  assert.equal(statusMix(active, MEMBER).total, 0, 'status mix');
  assert.equal(atRisk(active, OWNER, now, true).length, 0, 'at risk');
  assert.ok(teamWorkload(active, now).every(row => row.open === 0 && row.late === 0 && row.attention === 0), 'workload');
  assert.equal(livingLayout(active, OWNER, now, true).bubbles.length, 0, 'living view');
  // Completed archived work stays in the state those views read, as before.
  assert.equal(withoutLegacyArchived(s), s);
});

test('the v7 rollback refuses legacy archive and still reads v8 state', () => {
  const { s, taskId } = workspace('working');
  const r7 = v7.runAction(s, ORG, members, OWNER, legacy(taskId) as never, T0);
  assert.equal(r7.ok, false);
  const archived = run(s, OWNER, legacy(taskId));
  const next = v7.runAction(archived, ORG, members, OWNER, { type: 'task/comment', id: taskId, note: 'after rollback' } as never, clock + 1);
  assert.equal(next.ok, true);
  if (next.ok) {
    const task = next.state.tasks.find(t => t.id === taskId)!;
    assert.equal(task.status, 'working');
    assert.equal(task.archivedReason, 'legacy', 'stored fields survive a v7 write');
  }
});
