import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED, RESTRICTABLE, canNavigate, parseNavigation } from './navigation.ts';

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
  assert.deepEqual(parseNavigation({ full: true, restricted: ['people'] }), { full: true, restricted: ['people'] });
});
