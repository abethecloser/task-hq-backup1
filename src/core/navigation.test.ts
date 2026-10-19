import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED, MANAGE_VIEWS, RESTRICTABLE, canManage, canNavigate, forOrg, isManageView, parseNavigation } from './navigation.ts';

const server = { full: false, restricted: ['people', 'leads', 'reports'] };

test('Home and Tasks are always open, even when fully closed', () => {
  assert.ok(canNavigate(CLOSED, 'home'));
  assert.ok(canNavigate(CLOSED, 'all-tasks'));
  assert.ok(canNavigate({ full: false, restricted: ['home', 'all-tasks'] }, 'home'), 'the server cannot close the approved experience');
});

test('restricted sections are closed for everyone except the allowlisted account', () => {
  assert.equal(canNavigate(server, 'people'), false);
  assert.equal(canNavigate(server, 'leads'), false);
  assert.ok(canNavigate({ ...server, full: true }, 'people'));
  assert.ok(canNavigate({ ...server, full: true }, 'reports'));
});

test('a section reopened on the server (row deleted) opens without a client change', () => {
  assert.ok(canNavigate(server, 'settings'));
  assert.ok(canNavigate({ full: false, restricted: ['leads'] }, 'people'));
});

test('missing or malformed answers fail closed', () => {
  for (const bad of [null, undefined, 'full', { full: 'yes', restricted: [] }, { full: true }, { full: true, restricted: [1] }]) {
    assert.deepEqual(parseNavigation(bad), CLOSED);
  }
  for (const view of RESTRICTABLE) assert.equal(canNavigate(CLOSED, view), false, view);
  assert.deepEqual(parseNavigation({ full: true, restricted: ['people'] }), { full: true, restricted: ['people'], byOrg: {} });
});

test('a role can reopen a section in one organization only (owners keep People & Roles)', () => {
  const owner = parseNavigation({ full: false, restricted: ['people', 'leads'], by_org: { quest: ['people'], other: 'bad' } });
  assert.deepEqual(owner.byOrg, { quest: ['people'] });
  assert.ok(canNavigate(forOrg(owner, 'quest'), 'people'));
  assert.equal(canNavigate(forOrg(owner, 'quest'), 'leads'), false, 'other sections stay restricted');
  assert.equal(canNavigate(forOrg(owner, 'elsewhere'), 'people'), false, 'only where they hold the role');
  assert.equal(canNavigate(forOrg(parseNavigation({ full: false, restricted: ['people'] }), 'quest'), 'people'), false, 'older servers without by_org stay restricted');
});

test('Manage is a permanent permission from organization role, separate from the temporary restriction', () => {
  assert.deepEqual(['owner', 'admin', 'supervisor', 'reviewer', 'member', undefined].map(canManage), [true, true, true, true, false, false]);
  assert.ok(isManageView('people') && isManageView('settings') && !isManageView('home') && !isManageView('all-tasks'));
  // Every Manage view is still subject to the temporary restriction.
  assert.ok(MANAGE_VIEWS.every(view => !canNavigate(CLOSED, view)));
});
