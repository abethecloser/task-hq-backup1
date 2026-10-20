// Badge check-in: the one endpoint a badge scan calls (no sign-in needed to reach it).
// A valid badge scanned on its own phone records a check-in or check-out (pending an
// Owner or Admin's confirmation) and returns a one-time sign-in token for that person.
// Any other phone, or any invalid badge, signs no one in. Codes, phone keys and tokens
// are never logged or stored in plain form.

export type ScanResult =
  | { result: 'ok'; kind: 'in' | 'out'; at: string; email: string; name: string; note: string }
  | { result: 'device-pending'; name: string }
  | { result: 'unavailable' };

export interface BadgeDependencies {
  /** Rate limit (true = allowed). */
  limit(bucket: string, max: number, seconds: number): Promise<boolean>;
  scan(codeHash: string, deviceHash: string): Promise<ScanResult>;
  /** One-time sign-in token for this account; nothing is emailed. */
  signInToken(email: string): Promise<string>;
}

export const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(n => n.toString(16).padStart(2, '0')).join('');

/** Badges carry 24 random bytes (48 hex digits); dashes and spaces are ignored. */
export const normalizeBadge = (code: string) => code.replace(/[-\s]/g, '').toLowerCase();
const BADGE = /^[0-9a-f]{48}$/;
const DEVICE = /^[0-9a-f]{64}$/;
const UNAVAILABLE = 'This badge isn’t active. Ask an Owner or Admin for a new one.';

export async function handleBadge(req: Request, deps: BadgeDependencies): Promise<Response> {
  const headers = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
  };
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers });
  if (req.method === 'OPTIONS') return reply(200, {});
  if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
  try {
    const raw = await req.text();
    if (raw.length > 2048) return reply(413, { error: 'Request too large.' });
    const body = JSON.parse(raw) as { code?: unknown; device?: unknown };
    const code = normalizeBadge(typeof body.code === 'string' ? body.code : '');
    const device = typeof body.device === 'string' ? body.device.toLowerCase() : '';
    if (!await deps.limit('badge-global', 300, 60)) return reply(429, { error: 'Too many check-ins right now. Try again in a minute.' });
    if (!BADGE.test(code) || !DEVICE.test(device)) return reply(400, { error: UNAVAILABLE });
    const codeHash = await sha256(code);
    if (!await deps.limit(`badge:${codeHash}`, 20, 900)) return reply(429, { error: 'Too many scans of this badge. Wait 15 minutes.' });
    const scan = await deps.scan(codeHash, await sha256(device));
    if (scan.result === 'device-pending') return reply(202, { status: 'device-pending', name: scan.name });
    if (scan.result !== 'ok') return reply(400, { error: UNAVAILABLE });
    const token = await deps.signInToken(scan.email);
    return reply(200, { status: 'ok', kind: scan.kind, at: scan.at, name: scan.name, note: scan.note, token_hash: token });
  } catch {
    return reply(400, { error: 'Check-in couldn’t complete. Try scanning again.' });
  }
}
