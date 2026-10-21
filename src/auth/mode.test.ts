import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoUrl, entryMode, saveMode } from './mode.ts';

function fixture() {
  const data = new Map([['tmhq.mode', 'demo'], ['tmhq.auth', 'existing-session'], ['quest.state', 'sample-work']]);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  return { data, storage };
}
const origin = 'https://task.questroofing.com';

test('explicit auth, recovery, magic links, errors and badge scans override saved demo', () => {
  for (const suffix of ['/#/auth/sign-in', '/#/auth/reset', '/?code=pkce', '/?token_hash=abc&type=recovery', '/#access_token=a&refresh_token=b&type=recovery', '/#error_code=otp_expired']) {
    const { data, storage } = fixture();
    assert.equal(entryMode(origin + suffix, false, false, storage), 'auth');
    assert.equal(data.has('tmhq.mode'), false);
    assert.equal(data.get('tmhq.auth'), 'existing-session');
    assert.equal(data.get('quest.state'), 'sample-work');
  }
  assert.equal(entryMode(origin, false, true, fixture().storage), 'auth');
});
test('leaving demo preserves account/session and demo data; refresh stays outside demo', () => {
  const { data, storage } = fixture();
  saveMode('auth', storage);
  assert.equal(entryMode(origin, false, false, storage), 'auth');
  assert.equal(data.get('tmhq.auth'), 'existing-session');
  assert.equal(data.get('quest.state'), 'sample-work');
  saveMode('demo', storage);
  assert.equal(entryMode(origin, false, false, storage), 'demo');
});
test('demo entries converge and extension remains isolated', () => {
  for (const suffix of ['/?demo=1', '/demo', '/demo/', '/#/demo']) assert.equal(entryMode(origin + suffix, false, false, fixture().storage), 'demo');
  assert.equal(demoUrl(origin + '/src/shifts/index.html?demo=1'), origin + '/?demo=1#/home');
  assert.equal(demoUrl(origin + '/popup.html'), origin + '/?demo=1#/home');
  assert.equal(entryMode(origin + '/#/auth/sign-in', true, false, fixture().storage), 'demo');
});
test('restricted storage still permits explicit navigation', () => {
  const storage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); } };
  assert.equal(entryMode(origin, false, false, storage), 'auth');
  assert.equal(entryMode(origin + '/?demo=1', false, false, storage), 'demo');
  saveMode('auth', storage);
});
