import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBadge, normalizeBadge, sha256 } from './handler.ts';
import type { BadgeDependencies, VerifyResult } from './handler.ts';

const CODE = 'a'.repeat(48);
const DEVICE = 'b'.repeat(64);
const CREW = 'crew-user-id';
const post = (body: unknown, authorization = 'Bearer crew-session') => new Request('https://x.invalid/badge-check-in', { method: 'POST', body: JSON.stringify(body), headers: authorization ? { Authorization: authorization } : {} });

/** The crew member is signed in by default; `result` is what badge_verify answers. */
function deps(result: VerifyResult, allowed = true) {
  const calls: { verify?: [string, string, string] } = {};
  const d: BadgeDependencies = {
    limit: async () => allowed,
    caller: async authorization => (authorization === 'Bearer crew-session' ? CREW : authorization === 'Bearer owner-session' ? 'owner-user-id' : null),
    verify: async (code, device, user) => { calls.verify = [code, device, user]; return result; },
  };
  return { d, calls };
}

test('the badge owner, signed in on their own phone, is verified; no credential and no attendance write', async () => {
  const { d, calls } = deps({ result: 'ok', name: 'Crew', org_id: 'org-1' });
  const res = await handleBadge(post({ code: 'AAAAAA-'.repeat(8).slice(0, 55), device: DEVICE }), d);
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.deepEqual(JSON.parse(raw), { status: 'verified', name: 'Crew', orgId: 'org-1' });
  assert.doesNotMatch(raw, /token|session|@|access|refresh|link/i, 'a badge is never a sign-in');
  // Only hashes reach the database, with the verified signed-in user.
  assert.deepEqual(calls.verify, [await sha256(CODE), await sha256(DEVICE), CREW]);
});

test('holding a badge without being signed in does nothing', async () => {
  const { d, calls } = deps({ result: 'ok', name: 'Crew', org_id: 'org-1' });
  const res = await handleBadge(post({ code: CODE, device: DEVICE }, ''), d);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.status, 'sign-in-required');
  assert.doesNotMatch(JSON.stringify(body), /Crew/, 'no name to a signed-out holder');
  assert.equal(calls.verify, undefined, 'never reaches the database');
});

test('a different signed-in account is refused, never switched', async () => {
  const { d, calls } = deps({ result: 'mismatch' });
  const res = await handleBadge(post({ code: CODE, device: DEVICE }, 'Bearer owner-session'), d);
  assert.equal(res.status, 409);
  const raw = await res.text();
  assert.equal(JSON.parse(raw).status, 'account-mismatch');
  assert.doesNotMatch(raw, /token|session|Crew/i);
  assert.equal(calls.verify?.[2], 'owner-user-id', 'the database decides ownership for the verified caller');
});

test('the deployed entry point has no way to mint sign-in credentials or write attendance', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['index.ts', 'handler.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /generateLink|createSession|signIn|verifyOtp|auth\.admin|badge_scan|shift_command/, file);
  }
});

test('another phone, an inactive badge or a malformed request', async () => {
  const pending = deps({ result: 'device-pending', name: 'Crew' });
  const res = await handleBadge(post({ code: CODE, device: DEVICE }), pending.d);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { status: 'device-pending', name: 'Crew' });

  const gone = deps({ result: 'unavailable' });
  assert.equal((await handleBadge(post({ code: CODE, device: DEVICE }), gone.d)).status, 400);

  const bad = deps({ result: 'ok', name: '', org_id: '' });
  assert.equal((await handleBadge(post({ code: 'short', device: DEVICE }), bad.d)).status, 400);
  assert.equal((await handleBadge(post({ code: CODE, device: 'not-hex' }), bad.d)).status, 400);
  assert.equal(bad.calls.verify, undefined, 'never reaches the database');
});

test('rate limits and methods', async () => {
  const limited = deps({ result: 'unavailable' }, false);
  assert.equal((await handleBadge(post({ code: CODE, device: DEVICE }), limited.d)).status, 429);
  assert.equal((await handleBadge(new Request('https://x.invalid', { method: 'GET' }), limited.d)).status, 405);
  assert.equal((await handleBadge(new Request('https://x.invalid', { method: 'OPTIONS' }), limited.d)).status, 200);
  assert.equal(normalizeBadge('AB-cd ef'), 'abcdef');
});
