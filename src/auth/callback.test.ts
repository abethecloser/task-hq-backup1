import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, linkProblem, parseAuthCallback } from './callback.ts';

const PROD = 'https://task-hq-three.vercel.app';

test('recovery links from the email template, PKCE and the dashboard are all recognised', () => {
  assert.deepEqual(parseAuthCallback(`${PROD}/?token_hash=abc&type=recovery#/auth/reset`), { kind: 'token-hash', tokenHash: 'abc', type: 'recovery' });
  assert.deepEqual(parseAuthCallback(`${PROD}/?code=xyz#/auth/reset`), { kind: 'code' });
  assert.deepEqual(parseAuthCallback(`${PROD}/#access_token=at&refresh_token=rt&expires_in=3600&token_type=bearer&type=recovery`), { kind: 'implicit', accessToken: 'at', refreshToken: 'rt', type: 'recovery' });
});

test('expired links become a plain notice, and app routes are never read as auth parameters', () => {
  const expired = parseAuthCallback(`${PROD}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
  assert.equal(expired.kind, 'error');
  assert.equal(linkProblem('otp_expired', 'Email link is invalid or has expired'), 'That link has expired or was already used. Request a new one below.');
  assert.deepEqual(parseAuthCallback(`${PROD}/#/auth/reset`), { kind: 'none' });
  assert.deepEqual(parseAuthCallback(`${PROD}/#/home`), { kind: 'none' });
  assert.deepEqual(parseAuthCallback(`${PROD}/?token_hash=abc&type=nonsense`), { kind: 'none' });
  // Employee activation links carry their own one-time code in the fragment; they are not auth callbacks.
  assert.deepEqual(parseAuthCallback(`${PROD}/activate/index.html#code=ABC123-DEF456`), { kind: 'none' });
});

test('the cleaned address keeps no token and lands on the chosen route', () => {
  const clean = cleanUrl(`${PROD}/?token_hash=secret&type=recovery#/auth/reset`, '#/auth/reset');
  assert.equal(clean, `${PROD}/#/auth/reset`);
  assert.ok(!clean.includes('secret'));
  assert.equal(cleanUrl(`${PROD}/?code=xyz`, '#/auth/forgot'), `${PROD}/#/auth/forgot`);
});
