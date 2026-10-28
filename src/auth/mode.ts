import { parseAuthCallback } from './callback.ts';

export const MODE_KEY = 'tmhq.mode';
export type EntryMode = 'demo' | 'auth';
type ModeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Change only the demo preference. Account tokens and sample work are independent. */
export function saveMode(mode: EntryMode, storage: ModeStorage = localStorage) {
  try {
    if (mode === 'demo') storage.setItem(MODE_KEY, 'demo');
    else storage.removeItem(MODE_KEY);
  } catch { /* Current-tab navigation still works without storage. */ }
}

export function entryMode(href: string, extension: boolean, badge: boolean, storage: ModeStorage = localStorage): EntryMode {
  if (extension) return 'demo';
  const url = new URL(href);
  // Email callbacks and badge scans must never be hidden by a saved demo preference.
  if (badge || url.hash.startsWith('#/auth/') || parseAuthCallback(href).kind !== 'none') {
    saveMode('auth', storage);
    return 'auth';
  }
  if (url.searchParams.get('demo') === '1' || /^\/demo\/?$/.test(url.pathname) || url.hash === '#/demo') {
    saveMode('demo', storage);
    return 'demo';
  }
  try { return storage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'auth'; } catch { return 'auth'; }
}

/** One web demo, including links from the former standalone previews. */
export function demoUrl(href: string): string {
  const url = new URL(href);
  url.pathname = '/';
  url.search = '?demo=1';
  url.hash = '#/home';
  return url.href;
}
