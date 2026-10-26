import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTION_ORIGIN, activationLink, activationMessage, nextAction, provisionPath } from './people-access.ts';
import type { PersonAccess } from './people-access.ts';

const base: PersonAccess = { id: 'c1', name: 'Ralph Palad', email: 'ralph@example.com', role: 'member', work_role: 'field', affiliation_confirmed: true, member: null, invitation: null, activation: null, status: 'ready' };
const soon = '2026-10-20T12:00:00Z';

test('one next action per status', () => {
  assert.equal(nextAction(base, 'admin').primary, 'send-link');
  assert.equal(nextAction({ ...base, status: 'active' }, 'owner').primary, 'none');
  assert.equal(nextAction({ ...base, email: null, status: 'needs-email' }, 'owner').primary, 'add-email');
  const sent = nextAction({ ...base, status: 'link-sent', activation: { expires_at: soon, state: 'valid' } }, 'admin');
  assert.equal(sent.primary, 'new-link');
  assert.deepEqual(sent.secondary, ['revoke-link']);
  const sentAndInvited = nextAction({ ...base, status: 'link-sent', activation: { expires_at: soon, state: 'valid' }, invitation: { id: 'i', role: 'member', work_role: 'field', expires_at: soon, expired: false } }, 'owner');
  assert.deepEqual(sentAndInvited.secondary, ['revoke-link', 'revoke-invite'], 'an open invitation stays revocable while a setup link is pending');
  assert.equal(nextAction({ ...base, status: 'link-invalid', activation: { expires_at: soon, state: 'invalidated' } }, 'admin').label, 'Send new setup link');
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
  const link = activationLink(PRODUCTION_ORIGIN, 'ABC123-DEF456');
  assert.equal(link, 'https://task.questroofing.com/activate/index.html#code=ABC123-DEF456');
  assert.ok(!link.includes('?'));
  const message = activationMessage('Ralph Palad', 'Quest Roofing', PRODUCTION_ORIGIN, 'ABC123-DEF456', soon);
  assert.match(message, /^Hi Ralph, here is your personal Quest Roofing Task-HQ setup link: https:\/\/task\.questroofing\.com\/activate\/index\.html#code=ABC123-DEF456/);
  assert.match(message, /six-digit code/);
  assert.doesNotMatch(message, /password/i);
  assert.match(message, /enter this code: ABC123-DEF456$/);
});

test('provisioning: one path per person, never a duplicate account', () => {
  assert.equal(provisionPath(base, 'admin'), 'link');
  assert.equal(provisionPath({ ...base, has_account: true }, 'admin'), 'link', 'existing accounts are linked by the same setup link');
  assert.equal(provisionPath({ ...base, has_account: true, status: 'invited' }, 'admin'), 'link', 'an older invitation does not block a setup link');
  assert.equal(provisionPath({ ...base, status: 'active' }, 'owner'), null);
  assert.equal(provisionPath({ ...base, status: 'link-sent' }, 'owner'), null, 'a pending link is reissued deliberately, not in bulk');
  assert.equal(provisionPath({ ...base, status: 'link-expired' }, 'admin'), 'link', 'expired links recover by reissue');
  assert.equal(provisionPath({ ...base, email: null, status: 'needs-email' }, 'owner'), null);
  assert.equal(provisionPath({ ...base, role: 'admin' }, 'admin'), null, 'Admin access needs an owner');
  assert.equal(provisionPath({ ...base, role: 'admin' }, 'owner'), 'link');
  const existing = nextAction({ ...base, has_account: true }, 'admin');
  assert.equal(existing.primary, 'send-link');
  assert.match(existing.detail, /Has a Task-HQ account/);
  assert.equal(PRODUCTION_ORIGIN, 'https://task.questroofing.com', 'links open where people use Task-HQ');
});
