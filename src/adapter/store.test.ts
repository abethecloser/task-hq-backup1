// Extension continuity: the popup and the Quest app page are separate pages that
// share chrome.storage.local. A change made in one must reach the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestState } from '../core/contract.ts';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const data: Record<string, unknown> = {};
const listeners = new Set<Listener>();
let routeToWorker: ((message: any) => Promise<unknown>) | null = null;

(globalThis as any).chrome = {
  runtime: {
    id: 'quest-test',
    getURL: (path: string) => `chrome-extension://quest-test/${path}`,
    sendMessage: (message: unknown) => (routeToWorker ? routeToWorker(message) : Promise.reject(new Error('no worker'))),
  },
  storage: {
    local: {
      async get(key: string) { return { [key]: structuredClone(data[key]) }; },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, { newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) { data[key] = structuredClone(value); changes[key] = { newValue: structuredClone(value) }; }
        queueMicrotask(() => listeners.forEach(listener => listener(changes, 'local')));
      },
    },
    onChanged: { addListener: (cb: Listener) => listeners.add(cb), removeListener: (cb: Listener) => listeners.delete(cb) },
  },
};

const { createExtensionBackend, chromeKV, processAction, appUrl, STATE_KEY } = await import('./store.ts');

test('popup action reaches the full app page through chrome.storage', async () => {
  // Simulate the background worker serializing writes.
  routeToWorker = async message => processAction(chromeKV, message.action, message.actor, message.writer);
  const popup = createExtensionBackend('popup');
  const app = createExtensionBackend('app');
  const initial = await app.load();
  assert.equal(initial.tasks.find(task => task.id === 'safety-brief')?.status, 'ready');

  const seen: QuestState[] = [];
  const off = app.subscribe(state => seen.push(state));
  const result = await popup.dispatch({ type: 'task/advance', id: 'safety-brief' }, 'alex');
  assert.equal(result.ok, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  off();
  assert.ok(seen.length > 0, 'app page was notified');
  assert.equal(seen.at(-1)!.tasks.find(task => task.id === 'safety-brief')?.status, 'working');
  assert.equal(seen.at(-1)!.writer, 'popup');
  const reloaded = await app.load();
  assert.equal(reloaded.tasks.find(task => task.id === 'safety-brief')?.status, 'working', 'persisted');
  assert.equal(await app.outboxCount(), 1, 'recorded as a local, undelivered change');
  assert.equal(appUrl('safety-brief'), 'chrome-extension://quest-test/index.html#/task/safety-brief');
});

test('dispatch still works when the worker is asleep, and the actor is shared', async () => {
  routeToWorker = null;
  const popup = createExtensionBackend('popup');
  const app = createExtensionBackend('app');
  const result = await popup.dispatch({ type: 'task/create', task: { title: 'From the toolbar', owner: 'maya' } }, 'maya');
  assert.equal(result.ok, true);
  const state = data[STATE_KEY] as QuestState;
  assert.equal(state.tasks[0]!.title, 'From the toolbar');
  await popup.setActor('jordan');
  assert.equal(await app.getActor(), 'jordan');
});

test('refused actions do not write', async () => {
  const popup = createExtensionBackend('popup');
  const before = (data[STATE_KEY] as QuestState).rev;
  const result = await popup.dispatch({ type: 'ultra/activate', taskId: 'maple-tarp' }, 'alex');
  assert.equal(result.ok, false);
  assert.equal((data[STATE_KEY] as QuestState).rev, before);
});
