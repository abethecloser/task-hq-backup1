import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationLink, activationMessage, nextAction } from './people-access.ts';
import type { PersonAccess } from './people-access.ts';

const base: PersonAccess = { id: 'c1', name: 'Ralph Palad', email: 'ralph@example.com', role: 'member', work_role: 'field', affiliation_confirmed: true, member: null, invitation: null, activation: null, status: 'ready' };
const soon = '2026-10-20T12:00:00Z';

test('one next action per status', () => {
  assert.equal(nextAction(base, 'admin').primary, 'send-link');
  assert.deepEqual(nextAction(base, 'admin').secondary, ['invite-instead'], 'invitation stays a fallback for existing accounts');
  assert.equal(nextAction({ ...base, status: 'active' }, 'owner').primary, 'none');
  assert.equal(nextAction({ ...base, email: null, status: 'needs-email' }, 'owner').primary, 'add-email');
  const sent = nextAction({ ...base, status: 'link-sent', activation: { expires_at: soon, state: 'valid' } }, 'admin');
  assert.equal(sent.primary, 'new-link');
  assert.deepEqual(sent.secondary, ['revoke-link']);
  assert.equal(nextAction({ ...base, status: 'link-invalid', activation: { expires_at: soon, state: 'invalidated' } }, 'admin').label, 'Send new link');
  const invited = nextAction({ ...base, status: 'invited', invitation: { id: 'i', role: 'member', work_role: 'field', expires_at: soon, expired: false } }, 'owner');
  assert.equal(invited.primary, 'send-link');
  assert.deepEqual(invited.secondary, ['revoke-invite']);
});

test('only an owner can send an Admin activation', () => {
  const admin = { ...base, role: 'admin' };
  assert.equal(nextAction(admin, 'admin').primary, 'owner-only');
  assert.equal(nextAction(admin, 'owner').primary, 'send-link');
  assert.equal(nextAction({ ...admin, status: 'link-sent', activation: { expires_at: soon, state: 'valid' } }, 'admin').primary, 'owner-only');
});

test('the link carries the code in the fragment only', () => {
  const link = activationLink('https://task-hq-three.vercel.app', 'ABC123-DEF456');
  assert.equal(link, 'https://task-hq-three.vercel.app/activate/index.html#code=ABC123-DEF456');
  assert.ok(!link.includes('?'));
  const message = activationMessage('Ralph Palad', 'Quest Roofing', 'https://task-hq-three.vercel.app', 'ABC123-DEF456', soon);
  assert.match(message, /^Hi Ralph, here is your Quest Roofing Task-HQ activation link: https:\/\/task-hq-three\.vercel\.app\/activate\/index\.html#code=ABC123-DEF456/);
  assert.match(message, /enter this code: ABC123-DEF456$/);
});
