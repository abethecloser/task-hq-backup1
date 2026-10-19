// Messaging storage. The demo keeps channels and messages in this browser (synthetic
// people and text, shared across tabs). There is no live messaging backend yet: production
// would store messages per row with channel-membership RLS and Realtime per channel — see
// docs/universal-inbox.md. In a live workspace this returns null and the inbox shows task
// notifications only.
import type { Person } from '../core/contract.ts';
import { seedMessaging } from '../core/inbox.ts';
import type { MessagingState } from '../core/inbox.ts';

const KEY = 'quest.messaging.v1';
const EVENT = 'quest-messaging';

export interface MessagingStore {
  load(): MessagingState;
  save(state: MessagingState): void;
  subscribe(listener: (state: MessagingState) => void): () => void;
  reset(): MessagingState;
}

export function demoMessaging(people: Person[]): MessagingStore {
  const read = (): MessagingState | null => {
    try { const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return raw && raw.version === 1 ? raw as MessagingState : null; } catch { return null; }
  };
  const write = (state: MessagingState) => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* this tab only */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
  };
  return {
    load() { const stored = read(); if (stored) return stored; const fresh = seedMessaging(Date.now(), people); write(fresh); return fresh; },
    save: write,
    reset() { const fresh = seedMessaging(Date.now(), people); write(fresh); return fresh; },
    subscribe(listener) {
      const local = (event: Event) => listener((event as CustomEvent<MessagingState>).detail);
      const other = (event: StorageEvent) => { if (event.key === KEY) { const next = read(); if (next) listener(next); } };
      window.addEventListener(EVENT, local);
      window.addEventListener('storage', other);
      return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', other); };
    },
  };
}
