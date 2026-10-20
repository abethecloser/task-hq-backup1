// Badge check-in, browser side. A badge is a link (printed as a QR) carrying a random code in the
// fragment (#badge=…), which browsers never send to servers or in referrers. The code is read once
// at startup and removed from the address bar and history before anything else runs.
// Each phone keeps its own random key; the server only ever sees its hash and binds the badge to it.

const PARAM = /(?:^#|&)badge=([0-9a-fA-F-]{48,80})(?:&|$)/;
const DEVICE_KEY = 'tmhq.badge-device';

/** The badge code in a URL's fragment, normalized (48 hex digits), or null. */
export function badgeFromHash(hash: string): string | null {
  const match = PARAM.exec(hash);
  if (!match) return null;
  const code = match[1]!.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{48}$/.test(code) ? code : null;
}

function takeBadge(): string | null {
  if (typeof window === 'undefined') return null;
  const code = badgeFromHash(window.location.hash);
  if (code) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  return code;
}

/** Captured at module load (main.tsx imports this first). */
export const LANDING_BADGE = takeBadge();

const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');

/** This phone's key: created once, kept in this browser. Losing it just means approving the phone again. */
export function deviceKey(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): string {
  try {
    const saved = storage.getItem(DEVICE_KEY);
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
    const created = hex(crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return hex(crypto.getRandomValues(new Uint8Array(32)));
  }
}

/** A new badge: 24 random bytes. `display` groups it for reading aloud or typing. */
export function newBadgeCode() {
  const code = hex(crypto.getRandomValues(new Uint8Array(24)));
  return { code, display: code.toUpperCase().match(/.{1,6}/g)!.join('-') };
}

export const badgeHash = async (code: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))));

export const badgeLink = (origin: string, code: string) => `${origin}/#badge=${code}`;
