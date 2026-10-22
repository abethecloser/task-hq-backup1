import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALWAYS_OPEN, CLOSED, MANAGE_VIEWS, RESTRICTABLE, canManage, canNavigate, forOrg, isManageView, parseNavigation } from './navigation.ts';

const server = { full: false, restricted: ['people', 'leads', 'reports'] };

test('approved core pages stay open, even when server restrictions are active', () => {
  for (const view of ALWAYS_OPEN) assert.ok(canNavigate(CLOSED, view), view);
  assert.ok(canNavigate({ full: false, restricted: [...ALWAYS_OPEN] }, 'home'), 'the server cannot close the approved experience');
});

test('restricted sections are closed for legacy server responses', () => {
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

import { PAGE_STATUS, pageTag, restriction } from './navigation.ts';

const context = (over: Partial<Parameters<typeof restriction>[1]> = {}) => ({ access: { full: false, restricted: ['executive', 'feedback', 'agents'] }, manager: false, reviewer: false, hasDesk: false, feedbackOn: false, agentPilot: false, ...over });

test('every routed page has a status, so none can be hidden by being unfinished', () => {
  for (const view of [...ALWAYS_OPEN, ...RESTRICTABLE.filter(item => item !== 'search'), 'workbook']) assert.ok(PAGE_STATUS[view], view);
});

test('a member opens unfinished pages but gets a restricted view for Manage pages', () => {
  for (const view of ['tools', 'leads', 'relationships', 'workbook', 'inbox']) assert.equal(restriction(view, context()), null, view);
  for (const view of MANAGE_VIEWS) assert.notEqual(restriction(view, context()), null, view);
  assert.equal(restriction('people', context()), 'role');
});

test('server restrictions become an unavailable page, never a hidden entry; full access bypasses them', () => {
  assert.equal(restriction('agents', context({ manager: true })), 'unavailable');
  assert.equal(restriction('feedback', context({ manager: true, access: { full: true, restricted: [] } })), 'unavailable');
  assert.equal(restriction('agents', context({ manager: true, agentPilot: true, access: { full: true, restricted: ['agents'] } })), null);
  assert.equal(restriction('agents', context({ manager: true, access: { full: true, restricted: [] } })), 'unavailable', 'the pilot stays off until its policy is on');
});

test('role rules still apply to the executive desk and to estimates for reviewers', () => {
  assert.equal(restriction('executive', context({ manager: true, access: { full: true, restricted: [] } })), 'role');
  assert.equal(restriction('tools', context({ reviewer: true })), 'role');
});

test('navigation tags tell the truth about status and access', () => {
  assert.equal(pageTag('tools', null), 'Preview');
  assert.equal(pageTag('home', null), undefined);
  assert.equal(pageTag('people', 'role'), 'Restricted');
  assert.equal(pageTag('agents', 'unavailable'), 'Unavailable');
  assert.equal(pageTag('feedback', null), 'Unavailable');
});
