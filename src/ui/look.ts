// Visual look: 'studio' (default, the Nexus-derived design) or 'brutalist' (opt-in).
// A presentation preference for this browser only; it never touches workspace data.
// Applied as <html data-look="…">, which scopes the rules in brutalist.css.
import { useEffect, useState } from 'react';

export type Look = 'studio' | 'brutalist';
export const LOOK_LABELS: Record<Look, string> = { studio: 'Studio', brutalist: 'Brutalist' };
const KEY = 'tmhq.look';
const EVENT = 'tmhq-look';

export function readLook(): Look {
  try { return localStorage.getItem(KEY) === 'brutalist' ? 'brutalist' : 'studio'; } catch { return 'studio'; }
}

/** Call once before the first render so the page never flashes the wrong look. */
export function applyLook(look: Look = readLook()) {
  document.documentElement.dataset.look = look;
}

export function useLook(): [Look, (next: Look) => void] {
  const [look, setLookState] = useState<Look>(readLook);
  useEffect(() => {
    const sync = () => setLookState(readLook());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // other tabs
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => { applyLook(look); }, [look]);
  return [look, next => {
    try { localStorage.setItem(KEY, next); } catch { /* this page only */ }
    setLookState(next);
    window.dispatchEvent(new Event(EVENT));
  }];
}
