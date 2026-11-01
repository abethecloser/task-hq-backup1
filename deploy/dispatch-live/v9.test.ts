// dispatch v9: v8 plus `project/archive` / `project/unarchive` for supervisors, admins and owners.
// An archived project leaves active navigation and pickers and takes no new tasks; its tasks keep
// their status and history. v8 (and v7, the last verified production release) refuse the new actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v8 from './v8/logic.ts';
import * as v9 from './v9/logic.ts';
import type { Action, QuestState } from './v9/core/contract.ts';
import { activeProjects, withoutLegacyArchived } from '../../src/core/selectors.ts';
import { projectIntel } from '../../src/core/project-intel.ts';

const T0 = new Date('2026-11-01T09:00:00').getTime();
const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'quest-roofing', name: 'Quest Roofing', preset: 'roofing' };
const id = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const OWNER = id('a'), ADMIN = id('b'), SUPERVISOR = id('c'), MEMBER = id('e'), REVIEWER = id('f');
const members: v9.MemberRow[] = [
  { user_id: OWNER, role: 'owner', work_role: 'manager', name: 'Owner Person' },
  { user_id: ADMIN, role: 'admin', work_role: 'coordinator', name: 'Admin Person' },
  { user_id: SUPERVISOR, role: 'supervisor', work_role: 'field', name: 'Supervisor Person' },
  { user_id: MEMBER, role: 'member', work_role: 'manager', name: 'Member Titled Manager' },
  { user_id: REVIEWER, role: 'reviewer', work_role: 'reviewer', name: 'Review Person' },
];
let clock = T0;
function run(s: QuestState, who: string, action: Action) {
  const r = v9.runAction(s, ORG, members, who, action, (clock += 1000));
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`);
  return r.state;
}
function refuse(s: QuestState, who: string, action: Action) {
  const r = v9.runAction(s, ORG, members, who, action, (clock += 1000));
  assert.equal(r.ok, false, `${action.type} by ${who} should be refused`);
  return r.ok ? '' : r.error;
}
/** A Smith Residence project with a working task, a done task and a comment. */
function workspace() {
  let s = v9.emptyState(ORG, members, T0);
  s = run(s, OWNER, { type: 'project/create', name: 'Smith Residence' });
  const project = s.projects.find(p => p.name === 'Smith Residence')!;
  s = run(s, OWNER, { type: 'task/create', task: { title: 'Tear-off', owner: MEMBER, projectId: project.id } } as Action);
  s = run(s, OWNER, { type: 'task/create', task: { title: 'Measure', owner: MEMBER, projectId: project.id } } as Action);
  const working = s.tasks.find(t => t.title === 'Tear-off')!, done = s.tasks.find(t => t.title === 'Measure')!;
  s = run(s, MEMBER, { type: 'task/advance', id: working.id });
  s = run(s, MEMBER, { type: 'task/advance', id: done.id });
  s = run(s, MEMBER, { type: 'task/advance', id: done.id });
  s = run(s, MEMBER, { type: 'task/comment', id: working.id, note: 'Dumpster arrives at 7.' });
  return { s, projectId: project.id, workingId: working.id, doneId: done.id };
}

test('archiving a project keeps every task, status, person and comment; restore changes nothing else', () => {
  const { s, projectId, workingId, doneId } = workspace();
  const archived = run(s, ADMIN, { type: 'project/archive', id: projectId });
  const project = archived.projects.find(p => p.id === projectId)!;
  assert.equal(project.archivedBy, ADMIN);
  assert.equal(project.archivedAt, clock);
  assert.deepEqual(archived.tasks, s.tasks, 'tasks untouched: none completed, archived or moved');
  assert.equal(archived.tasks.find(t => t.id === workingId)!.status, 'working');
  assert.equal(archived.tasks.find(t => t.id === doneId)!.status, 'done');
  assert.deepEqual(archived.events.slice(1), s.events, 'history appended, never rewritten');
  assert.match(archived.events[0]!.text, /archived project “Smith Residence” \(1 open task keeps their status\)/);
  const restored = run(archived, SUPERVISOR, { type: 'project/unarchive', id: projectId });
  assert.deepEqual(restored.projects.map(p => ({ id: p.id, name: p.name, archived: !!p.archivedAt })), s.projects.map(p => ({ id: p.id, name: p.name, archived: false })), 'restored as it was');
  assert.deepEqual(restored.tasks, s.tasks);
  assert.match(restored.events[0]!.text, /restored project “Smith Residence” from the archive/);
});

test('only supervisors, admins and owners archive or restore projects', () => {
  const { s, projectId } = workspace();
  for (const who of [MEMBER, REVIEWER]) refuse(s, who, { type: 'project/archive', id: projectId });
  for (const who of [OWNER, ADMIN, SUPERVISOR]) run(s, who, { type: 'project/archive', id: projectId });
  const archived = run(s, OWNER, { type: 'project/archive', id: projectId });
  for (const who of [MEMBER, REVIEWER]) refuse(archived, who, { type: 'project/unarchive', id: projectId });
});

test('the default project stays active; missing, double and repeated actions are refused', () => {
  const { s, projectId } = workspace();
  assert.match(refuse(s, OWNER, { type: 'project/archive', id: 'general' }), /default project/);
  refuse(s, OWNER, { type: 'project/archive', id: 'nope' });
  refuse(s, OWNER, { type: 'project/unarchive', id: projectId });
  const archived = run(s, OWNER, { type: 'project/archive', id: projectId });
  assert.match(refuse(archived, OWNER, { type: 'project/archive', id: projectId }), /already archived/);
  assert.match(refuse(archived, OWNER, { type: 'project/create', name: 'smith residence' }), /is archived\. Restore it/);
});

test('an archived project takes no new tasks or reassignments; its own tasks stay editable', () => {
  const { s, projectId, workingId } = workspace();
  const archived = run(s, OWNER, { type: 'project/archive', id: projectId });
  assert.match(refuse(archived, OWNER, { type: 'task/create', task: { title: 'New', owner: MEMBER, projectId } } as Action), /project is archived/);
  const other = run(archived, OWNER, { type: 'task/create', task: { title: 'Elsewhere', owner: MEMBER, projectId: 'general' } } as Action);
  const elsewhere = other.tasks.find(t => t.title === 'Elsewhere')!;
  assert.match(refuse(other, OWNER, { type: 'task/update', id: elsewhere.id, changes: { projectId } }), /project is archived/);
  // Work already in the project keeps moving and can be edited.
  const edited = run(archived, MEMBER, { type: 'task/update', id: workingId, changes: { nextAction: 'Call the hauler' } });
  assert.equal(edited.tasks.find(t => t.id === workingId)!.projectId, projectId);
  run(archived, MEMBER, { type: 'task/advance', id: workingId });
  // And can move out of the archived project.
  run(archived, OWNER, { type: 'task/update', id: workingId, changes: { projectId: 'general' } });
  // After restore, new tasks are accepted again.
  const restored = run(archived, OWNER, { type: 'project/unarchive', id: projectId });
  run(restored, OWNER, { type: 'task/create', task: { title: 'New', owner: MEMBER, projectId } } as Action);
});

test('archived projects leave active selectors and project rows', () => {
  const { s, projectId } = workspace();
  const archived = run(s, OWNER, { type: 'project/archive', id: projectId });
  assert.deepEqual(activeProjects(archived).map(p => p.id), ['general']);
  assert.ok(archived.projects.some(p => p.id === projectId), 'still stored, reachable from the Archive');
  assert.equal(projectIntel(archived, OWNER, clock, true).projects.some(p => p.id === projectId), false);
  assert.equal(withoutLegacyArchived(archived).tasks.length, s.tasks.length, 'its tasks are still active work');
});

test('task archive behaviour carries over from v8: completed, unfinished (status kept) and restore', () => {
  const { s, workingId, doneId } = workspace();
  const done = run(s, MEMBER, { type: 'task/archive', id: doneId });
  assert.equal(done.tasks.find(t => t.id === doneId)!.status, 'done');
  refuse(s, MEMBER, { type: 'task/archive', id: workingId, reason: 'legacy' });
  const legacy = run(s, ADMIN, { type: 'task/archive', id: workingId, reason: 'legacy' });
  const task = legacy.tasks.find(t => t.id === workingId)!;
  assert.equal(task.status, 'working');
  assert.equal(task.completedAt ?? null, null);
  const restored = run(legacy, ADMIN, { type: 'task/unarchive', id: workingId });
  assert.equal(restored.tasks.find(t => t.id === workingId)!.status, 'working');
});

test('v8 refuses project archiving and still reads and writes v9 state', () => {
  const { s, projectId, workingId } = workspace();
  assert.equal(v8.runAction(s, ORG, members, OWNER, { type: 'project/archive', id: projectId } as never, clock).ok, false);
  const archived = run(s, OWNER, { type: 'project/archive', id: projectId });
  const next = v8.runAction(archived, ORG, members, MEMBER, { type: 'task/comment', id: workingId, note: 'after rollback' } as never, clock + 1);
  assert.equal(next.ok, true);
  if (next.ok) assert.ok(next.state.projects.find(p => p.id === projectId)!.archivedAt, 'archive fields survive a v8 write');
});

test('v9 core is the current engine, byte for byte', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('./v9/core/', import.meta.url);
  for (const file of readdirSync(dir)) assert.equal(readFileSync(new URL(file, dir), 'utf8'), readFileSync(new URL(`../../src/core/${file}`, import.meta.url), 'utf8'), `${file} drifted; copy src/core/${file} into deploy/dispatch-live/v9/core`);
});
