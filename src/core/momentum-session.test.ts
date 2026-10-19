import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentumKey, readMomentumSession, MOMENTUM_IDLE } from './momentum-session.ts';

const store = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
};
const now = new Date(2026, 9, 19, 9).getTime();
test('one visit stays stable through rerenders, navigation and reloads; a new tab advances it', () => {
  const local = store(), tab = store(), key = momentumKey('tenant-a', 'alex');
  const first = readMomentumSession(key, now, local, tab);
  assert.deepEqual(readMomentumSession(key, now + 60_000, local, tab), first);
  const returning = readMomentumSession(key, now + 120_000, local, store());
  assert.equal(returning.visit, first.visit + 1);
  assert.equal(returning.previousAt, now);
});
test('day and inactivity boundaries start a new visit, with the last reliable checkpoint', () => {
  const local = store(), tab = store(), key = momentumKey('tenant-a', 'alex');
  const first = readMomentumSession(key, now, local, tab);
  const resumed = readMomentumSession(key, now + MOMENTUM_IDLE, local, tab);
  assert.equal(resumed.visit, first.visit + 1);
  assert.equal(resumed.previousAt, now);
  const nextDay = readMomentumSession(key, now + 86_400_000, local, tab);
  assert.notEqual(nextDay.date, resumed.date);
  assert.equal(nextDay.visit, resumed.visit + 1);
});
test('actor and tenant keys isolate history; broken storage falls back without history claims', () => {
  assert.notEqual(momentumKey('tenant.a', 'alex'), momentumKey('tenant', 'a.alex'));
  const local = store(), tab = store();
  readMomentumSession(momentumKey('tenant-a', 'alex'), now, local, tab);
  for (const key of [momentumKey('tenant-a', 'maya'), momentumKey('tenant-b', 'alex')]) {
    const other = readMomentumSession(key, now + 1000, local, tab);
    assert.equal(other.previousAt, null); assert.equal(other.visit, 0);
  }
  const broken = { getItem: () => { throw new Error('Unavailable'); }, setItem: () => {} };
  assert.equal(readMomentumSession('fallback', now, broken, broken).previousAt, null);
});
