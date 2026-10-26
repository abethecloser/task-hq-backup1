// Badge check-in: the one endpoint a badge scan calls.
// A badge identifies a person; it is never an account credential, so no reply ever carries a
// session, sign-in link or token. It needs both the caller's own signed-in session AND that
// account owning the badge: holding a QR alone does nothing, and a different signed-in
// account is refused (never switched). A badge records no attendance either: on success the
// app continues to SOD and check-in, which live in shift_sessions (the one attendance record).
// Codes and phone keys are never logged or stored in plain form.

export type VerifyResult =
  | { result: 'ok'; name: string; org_id: string }
  | { result: 'device-pending'; name: string }
  | { result: 'mismatch' }
  | { result: 'unavailable' };

export interface BadgeDependencies {
  /** Rate limit (true = allowed). */
  limit(bucket: string, max: number, seconds: number): Promise<boolean>;
  /** The signed-in user behind the request's Authorization header, or null. */
  caller(authorization: string): Promise<string | null>;
  /** Badge owner check and phone binding for that user (public.badge_verify). */
  verify(codeHash: string, deviceHash: string, user: string): Promise<VerifyResult>;
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
    // Identity first: nothing is bound or recorded until the badge owner is the one signed in.
    const user = await deps.caller(req.headers.get('Authorization') ?? '');
    if (!user) return reply(401, { status: 'sign-in-required', error: 'Sign in with your own account to check in.' });
    const verified = await deps.verify(codeHash, await sha256(device), user);
    if (verified.result === 'mismatch') return reply(409, { status: 'account-mismatch', error: 'This badge belongs to a different account than the one signed in. Nothing was recorded.' });
    if (verified.result === 'device-pending') return reply(202, { status: 'device-pending', name: verified.name });
    if (verified.result !== 'ok') return reply(400, { error: UNAVAILABLE });
    // Only what the next screen needs; the account email stays on the server.
    return reply(200, { status: 'verified', name: verified.name, orgId: verified.org_id });
  } catch {
    return reply(400, { error: 'Check-in couldn’t complete. Try scanning again.' });
  }
}
