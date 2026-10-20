import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBadge, normalizeBadge, sha256 } from './handler.ts';
import type { BadgeDependencies, ScanResult } from './handler.ts';

const CODE = 'a'.repeat(48);
const DEVICE = 'b'.repeat(64);
const post = (body: unknown) => new Request('https://x.invalid/badge-check-in', { method: 'POST', body: JSON.stringify(body) });

function deps(result: ScanResult, allowed = true) {
  const calls: { scan?: [string, string]; token?: string } = {};
  const d: BadgeDependencies = {
    limit: async () => allowed,
    scan: async (code, device) => { calls.scan = [code, device]; return result; },
    signInToken: async email => { calls.token = email; return 'hashed-token'; },
  };
  return { d, calls };
}

test('a valid badge on its own phone returns the check-in and a one-time sign-in token', async () => {
  const { d, calls } = deps({ result: 'ok', kind: 'in', at: '2026-10-20T15:04:00Z', email: 'crew@test.invalid', name: 'Crew', note: '' });
  const res = await handleBadge(post({ code: 'AAAAAA-'.repeat(8).slice(0, 55), device: DEVICE }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', kind: 'in', at: '2026-10-20T15:04:00Z', name: 'Crew', note: '', token_hash: 'hashed-token' });
  // Only hashes reach the database; the raw code and phone key never do.
  assert.deepEqual(calls.scan, [await sha256(CODE), await sha256(DEVICE)]);
  assert.equal(calls.token, 'crew@test.invalid');
});

test('another phone, an inactive badge or a malformed request signs no one in', async () => {
  const pending = deps({ result: 'device-pending', name: 'Crew' });
  const res = await handleBadge(post({ code: CODE, device: DEVICE }), pending.d);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { status: 'device-pending', name: 'Crew' });
  assert.equal(pending.calls.token, undefined);

  const gone = deps({ result: 'unavailable' });
  assert.equal((await handleBadge(post({ code: CODE, device: DEVICE }), gone.d)).status, 400);
  assert.equal(gone.calls.token, undefined);

  const bad = deps({ result: 'ok', kind: 'in', at: '', email: 'x@test.invalid', name: '', note: '' });
  assert.equal((await handleBadge(post({ code: 'short', device: DEVICE }), bad.d)).status, 400);
  assert.equal((await handleBadge(post({ code: CODE, device: 'not-hex' }), bad.d)).status, 400);
  assert.equal(bad.calls.scan, undefined, 'never reaches the database');
});

test('rate limits and methods', async () => {
  const limited = deps({ result: 'unavailable' }, false);
  assert.equal((await handleBadge(post({ code: CODE, device: DEVICE }), limited.d)).status, 429);
  assert.equal((await handleBadge(new Request('https://x.invalid', { method: 'GET' }), limited.d)).status, 405);
  assert.equal((await handleBadge(new Request('https://x.invalid', { method: 'OPTIONS' }), limited.d)).status, 200);
  assert.equal(normalizeBadge('AB-cd ef'), 'abcdef');
});
