import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authRoute, destinationFrom, parseTaskRoute, pickWorkspace, scopedTaskHash, taskHash, taskUrl } from './task-link.ts';

const ORG = '11111111-1111-4111-8111-111111111111';

test('task addresses parse with and without a workspace', () => {
  assert.deepEqual(parseTaskRoute('#/task/abc'), { taskId: 'abc', orgId: null });
  assert.deepEqual(parseTaskRoute(`#/task/abc?org=${ORG}`), { taskId: 'abc', orgId: ORG });
  assert.deepEqual(parseTaskRoute('#/task/abc?org='), { taskId: 'abc', orgId: null });
  assert.deepEqual(parseTaskRoute('#/task/a%20b'), { taskId: 'a b', orgId: null });
});

test('anything else is not a task address, and a malformed id never throws', () => {
  for (const hash of ['', '#/', '#/home', '#/task', '#/task/', '#/task/?org=x', '#/all-tasks/urgent', '#/auth/sign-in']) assert.equal(parseTaskRoute(hash), null, hash);
  assert.deepEqual(parseTaskRoute('#/task/%E0%A4%A'), { taskId: '%E0%A4%A', orgId: null });
});

test('addresses round-trip, including ids that need encoding', () => {
  assert.equal(taskHash('abc'), '#/task/abc');
  assert.equal(taskHash('abc', ORG), `#/task/abc?org=${ORG}`);
  for (const id of ['abc', 'a b', 'a/b', 'a?org=evil', 'ü']) assert.deepEqual(parseTaskRoute(taskHash(id, ORG)), { taskId: id, orgId: ORG });
  assert.equal(taskUrl('https://task.questroofing.com/', 'abc', ORG), `https://task.questroofing.com/#/task/abc?org=${ORG}`);
});

test('an open task adds its workspace to its own address and never overwrites another', () => {
  assert.equal(scopedTaskHash('#/task/abc', 'abc', ORG), `#/task/abc?org=${ORG}`);
  assert.equal(scopedTaskHash(`#/task/abc?org=${ORG}`, 'abc', ORG), null, 'already right');
  assert.equal(scopedTaskHash(`#/task/other?org=${ORG}`, 'abc', ORG), null, 'a link that just arrived stays');
  assert.equal(scopedTaskHash('#/home', 'abc', ORG), null);
  assert.equal(scopedTaskHash('#/feedback/1', 'abc', ORG), null);
});

test('the destination survives moving between auth screens', () => {
  const start = taskHash('abc', ORG);
  assert.equal(destinationFrom(start), start);
  const magic = authRoute('magic', destinationFrom(start));
  assert.equal(destinationFrom(magic), start);
  assert.equal(destinationFrom(authRoute('set-password', destinationFrom(magic))), start);
});

test('auth screens without a destination keep their plain addresses', () => {
  assert.equal(authRoute('sign-in'), '#/auth/sign-in');
  assert.equal(authRoute('reset', null), '#/auth/reset');
  assert.equal(destinationFrom('#/auth/sign-in'), null);
  assert.equal(destinationFrom('#/home'), null);
});

test('only a task address is accepted as a destination', () => {
  for (const next of ['#/people', '#/auth/reset', 'https://evil.example/', '//evil.example', 'javascript:alert(1)']) {
    assert.equal(destinationFrom(`#/auth/sign-in?next=${encodeURIComponent(next)}`), null, next);
  }
  assert.equal(destinationFrom(`#/home?next=${encodeURIComponent('#/task/abc')}`), null);
});

const roofing = { org_id: 'roofing', name: 'Roofing' };
const drafting = { org_id: 'drafting', name: 'Drafting' };

test('a link opens its own workspace, ahead of the remembered one', () => {
  assert.deepEqual(pickWorkspace([roofing, drafting], 'roofing', 'drafting'), { membership: drafting, linkDenied: false });
});

test('a link to a workspace this account is not in is refused, never swapped for another', () => {
  assert.deepEqual(pickWorkspace([roofing], 'roofing', 'drafting'), { linkDenied: true });
  assert.deepEqual(pickWorkspace([], null, 'drafting'), { linkDenied: true });
});

test('without a link, workspace choice is unchanged', () => {
  assert.equal(pickWorkspace([roofing, drafting], 'drafting', null).membership, drafting);
  assert.equal(pickWorkspace([roofing], null, null).membership, roofing);
  assert.equal(pickWorkspace([roofing], 'gone', null).membership, roofing);
  assert.equal(pickWorkspace([roofing, drafting], null, null).membership, undefined);
  assert.equal(pickWorkspace([], null, null).membership, undefined);
});
