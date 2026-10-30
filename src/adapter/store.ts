// The adapter between Quest surfaces and Quest data. Every surface talks to a
// QuestBackend; every backend changes data only through core `apply()`.
//
// Backends available today (both local to one browser profile):
//   • extension — chrome.storage.local, shared by the popup, the full Quest app
//                 page inside the extension, and the background worker.
//   • browser   — window.localStorage for the standalone web build (npm run dev).
// Neither sends anything to teammates. A shared Quest server would be a third
// backend implementing the same interface; none is configured.
import type { Action, QuestState } from '../core/contract.ts';
import { apply, reconcile } from '../core/engine.ts';
import { V1_FOCUS_KEY, V1_TASKS_KEY, isQuestState, migrateV1, normalize } from '../core/migrate.ts';
import { seedState } from '../core/seed.ts';

export const STATE_KEY = 'quest.state.v2';
export const ACTOR_KEY = 'quest.actor';
export const OUTBOX_KEY = 'quest.outbox';
const MAX_OUTBOX = 200;

export type DispatchResult =
  | { ok: true; state: QuestState; message: string; eventId: string | null; undoable: boolean }
  | { ok: false; state: QuestState; error: string };

export interface OutboxEntry { at: number; actor: string; type: string; writer: string; delivered: false }

/** Key-value storage a backend persists to. */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

/**
 * Where authority for a change comes from.
 *  - 'local-demo': self-selected demo persona; rules run in this browser only. NOT authentication.
 *  - 'server-verified': reserved for a future Task-HQ backend that validates identity, tenant
 *    membership, permissions and allowed transitions server-side before accepting an action.
 *    No such backend is connected; nothing in this codebase claims this value today.
 */
export type Authority = 'local-demo' | 'server-verified';

export interface BackendSupports {
  /** Task types, tags and due times. */
  taskTaxonomy: boolean;
  /** `task/reopen` for completed work. */
  taskReopen: boolean;
  /** `task/archive` and `task/unarchive`, plus the saved completedBy. */
  taskArchive: boolean;
  /** `lead/claim` and `lead/tags`. */
  leadOwnership: boolean;
  /** `roles/label` work-role descriptions. */
  workLabels: boolean;
  /** Mention/tag link ids travel with an action and are stored with its text. */
  structuredReferences: boolean;
  /** `project/create`. */
  projectCreate: boolean;
  /** `task/archive` with reason `legacy`: unfinished work archived without completing it. */
  legacyArchive: boolean;
}

export interface QuestBackend {
  kind: 'extension' | 'browser' | 'live';
  authority: Authority;
  label: string;
  detail: string;
  load(): Promise<QuestState>;
  dispatch(action: Action, actor: string): Promise<DispatchResult>;
  /** Apply time-based changes (grant expiry). Writes only when something changed. */
  tick(): Promise<void>;
  subscribe(listener: (state: QuestState) => void): () => void;
  getActor(): Promise<string>;
  setActor(id: string): Promise<void>;
  subscribeActor(listener: (id: string) => void): () => void;
  outboxCount(): Promise<number>;
  /** Engine features the backend can persist. Absent = everything in this build. */
  supports?: BackendSupports;
}

// ── Shared, serialized read-modify-write ───────────────────────────────────

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export async function ensureState(kv: KV, legacy?: { tasks: string | null; focus: string | null }): Promise<QuestState> {
  const saved = await kv.get<unknown>(STATE_KEY);
  if (isQuestState(saved)) return normalize(saved);
  if (saved) await kv.set(`${STATE_KEY}.unreadable-${Date.now()}`, saved);
  const fresh = (legacy && migrateV1(legacy.tasks, legacy.focus, Date.now())) || seedState(Date.now());
  await kv.set(STATE_KEY, fresh);
  return fresh;
}

export function processAction(kv: KV, action: Action, actor: string, writer: string): Promise<DispatchResult> {
  return serial(async () => {
    const state = await ensureState(kv);
    const result = apply(state, action, { actor, now: Date.now(), writer });
    if (!result.ok) return { ok: false, state, error: result.error };
    await kv.set(STATE_KEY, result.state);
    const outbox = (await kv.get<OutboxEntry[]>(OUTBOX_KEY)) ?? [];
    await kv.set(OUTBOX_KEY, [{ at: Date.now(), actor, type: action.type, writer, delivered: false }, ...outbox].slice(0, MAX_OUTBOX));
    return { ok: true, state: result.state, message: result.message, eventId: result.event?.id ?? null, undoable: !!result.event?.undo };
  });
}

export function processTick(kv: KV, writer: string): Promise<QuestState> {
  return serial(async () => {
    const state = await ensureState(kv);
    const next = reconcile(state, Date.now(), writer);
    if (next.state !== state) await kv.set(STATE_KEY, next.state);
    return next.state;
  });
}

// ── chrome.storage backend ─────────────────────────────────────────────────

export const chromeKV: KV = {
  async get<T>(key: string) { return ((await chrome.storage.local.get(key))[key] as T | undefined) ?? null; },
  async set(key, value) { await chrome.storage.local.set({ [key]: value }); },
};

function watchChromeKey<T>(key: string, listener: (value: T) => void) {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && key in changes && changes[key]!.newValue !== undefined) listener(changes[key]!.newValue as T);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function createExtensionBackend(writer: string): QuestBackend {
  return {
    kind: 'extension',
    authority: 'local-demo',
    label: 'Saved on this device',
    detail: 'Companion extension storage in this Chrome profile. The popup and the full app page share it instantly. Teammates do not receive these changes — no shared Task-HQ server is connected.',
    load: () => ensureState(chromeKV),
    async dispatch(action, actor) {
      // The background worker serializes writes from every open Quest surface.
      try {
        const response = await chrome.runtime.sendMessage({ quest: 'dispatch', action, actor, writer }) as DispatchResult | undefined;
        if (response && 'ok' in response) return response;
      } catch { /* worker asleep or unavailable: fall through to a direct write */ }
      return processAction(chromeKV, action, actor, writer);
    },
    async tick() { await processTick(chromeKV, writer); },
    subscribe: listener => watchChromeKey<QuestState>(STATE_KEY, value => { if (isQuestState(value)) listener(normalize(value)); }),
    async getActor() { return (await chromeKV.get<string>(ACTOR_KEY)) ?? ''; },
    setActor: id => chromeKV.set(ACTOR_KEY, id),
    subscribeActor: listener => watchChromeKey<string>(ACTOR_KEY, listener),
    async outboxCount() { return ((await chromeKV.get<OutboxEntry[]>(OUTBOX_KEY)) ?? []).length; },
  };
}

// ── localStorage backend ───────────────────────────────────────────────────

const localKV: KV = {
  async get<T>(key: string) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  },
  async set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

export function createBrowserBackend(writer: string): QuestBackend {
  const listeners = new Set<(state: QuestState) => void>();
  const notify = (state: QuestState) => listeners.forEach(listener => listener(state));
  return {
    kind: 'browser',
    authority: 'local-demo',
    label: 'Saved in this browser only',
    detail: 'This standalone web build keeps data in this browser’s local storage. It is separate from the Companion extension’s data, and teammates do not receive these changes.',
    load: () => ensureState(localKV, { tasks: localStorage.getItem(V1_TASKS_KEY), focus: localStorage.getItem(V1_FOCUS_KEY) }),
    async dispatch(action, actor) {
      const result = await processAction(localKV, action, actor, writer);
      if (result.ok) notify(result.state);
      return result;
    },
    async tick() {
      const before = localStorage.getItem(STATE_KEY);
      const state = await processTick(localKV, writer);
      if (localStorage.getItem(STATE_KEY) !== before) notify(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== STATE_KEY || !event.newValue) return;
        try { const value: unknown = JSON.parse(event.newValue); if (isQuestState(value)) listener(normalize(value)); } catch { /* ignore partial writes */ }
      };
      window.addEventListener('storage', onStorage);
      return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
    },
    async getActor() { return localStorage.getItem(ACTOR_KEY) ?? ''; },
    async setActor(id) { localStorage.setItem(ACTOR_KEY, id); window.dispatchEvent(new CustomEvent('quest-actor', { detail: id })); },
    subscribeActor(listener) {
      const onLocal = (event: Event) => listener((event as CustomEvent<string>).detail);
      const onStorage = (event: StorageEvent) => { if (event.key === ACTOR_KEY && event.newValue) listener(event.newValue); };
      window.addEventListener('quest-actor', onLocal);
      window.addEventListener('storage', onStorage);
      return () => { window.removeEventListener('quest-actor', onLocal); window.removeEventListener('storage', onStorage); };
    },
    async outboxCount() { return ((await localKV.get<OutboxEntry[]>(OUTBOX_KEY)) ?? []).length; },
  };
}

export function isExtensionContext() {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
}

export function pickBackend(writer: string): QuestBackend {
  return isExtensionContext() ? createExtensionBackend(writer) : createBrowserBackend(writer);
}

/** URL of the full app for a task, from whichever surface is asking. */
export function appUrl(taskId?: string, view?: string) {
  const hash = taskId ? `#/task/${taskId}` : view ? `#/${view}` : '';
  return isExtensionContext() ? chrome.runtime.getURL(`index.html${hash}`) : `${location.origin}${location.pathname.replace(/popup\.html$/, 'index.html')}${hash}`;
}
