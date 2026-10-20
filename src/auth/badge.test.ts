import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { badgeFromHash, badgeHash, badgeLink, deviceKey, newBadgeCode } from './badge.ts';
import { parseAuthCallback } from './callback.ts';
import { normalizeBadge, sha256 } from '../../supabase/functions/badge-check-in/handler.ts';

test('a badge link carries its code in the fragment, and nothing else reads it as auth or a route', () => {
  const { code, display } = newBadgeCode();
  assert.match(code, /^[0-9a-f]{48}$/);
  assert.equal(display.replace(/-/g, '').toLowerCase(), code);
  const link = badgeLink('https://task-hq-three.vercel.app', code);
  assert.equal(link, `https://task-hq-three.vercel.app/#badge=${code}`);
  assert.equal(badgeFromHash(new URL(link).hash), code);
  assert.equal(badgeFromHash(`#badge=${display}`), code, 'the printed, dashed form works too');
  assert.equal(parseAuthCallback(link).kind, 'none', 'never mistaken for a sign-in link');
  assert.equal(badgeFromHash('#/home'), null);
  assert.equal(badgeFromHash('#badge=tooshort'), null);
});

test('the browser and the server hash a badge the same way', async () => {
  const { code, display } = newBadgeCode();
  const browser = await badgeHash(code);
  assert.equal(browser, createHash('sha256').update(code).digest('hex'));
  assert.equal(browser, await sha256(normalizeBadge(display)));
});

test('each phone keeps one random key', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const first = deviceKey(storage);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(deviceKey(storage), first);
});
