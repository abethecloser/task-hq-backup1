// Auth email links come back to the app in one of three shapes, depending on how the email was sent:
//   ?token_hash=…&type=recovery   the Task-HQ email templates; works on any device
//   ?code=…                       PKCE; supabase-js exchanges it, but only in the browser that asked
//   #access_token=…&type=recovery implicit links, e.g. "Send password recovery" from the Supabase dashboard
// Expired or reused links come back as error_code / error_description instead.
// This module turns any of them into a session, or into a plain-language notice, and cleans the address bar.
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';

export type AuthCallback =
  | { kind: 'token-hash'; tokenHash: string; type: EmailOtpType }
  | { kind: 'implicit'; accessToken: string; refreshToken: string; type: string }
  | { kind: 'code' }
  | { kind: 'error'; code: string; description: string }
  | { kind: 'none' };

const OTP_TYPES: EmailOtpType[] = ['recovery', 'magiclink', 'signup', 'invite', 'email', 'email_change'];

export function parseAuthCallback(href: string): AuthCallback {
  const url = new URL(href);
  const query = url.searchParams;
  // App routes use the hash too (#/auth/reset); only a hash that isn't a route can carry auth parameters.
  const fragment = url.hash.startsWith('#/') ? new URLSearchParams() : new URLSearchParams(url.hash.slice(1));
  const read = (key: string) => query.get(key) ?? fragment.get(key) ?? '';
  if (read('error') || read('error_code') || read('error_description')) {
    return { kind: 'error', code: read('error_code') || read('error'), description: read('error_description') };
  }
  const tokenHash = query.get('token_hash');
  const type = query.get('type') as EmailOtpType | null;
  if (tokenHash && type && OTP_TYPES.includes(type)) return { kind: 'token-hash', tokenHash, type };
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'implicit', accessToken, refreshToken, type: fragment.get('type') ?? '' };
  if (query.get('code')) return { kind: 'code' };
  return { kind: 'none' };
}

/** What a person reads when a link can't be used. Never includes the token. */
export function linkProblem(code: string, description: string): string {
  if (/expired|otp_expired|invalid|already|used/i.test(`${code} ${description}`)) return 'That link has expired or was already used. Request a new one below.';
  return 'That link couldn’t be used. Request a new one below.';
}

/** The address without auth parameters, landing on `route`. */
export function cleanUrl(href: string, route: string): string {
  const url = new URL(href);
  for (const key of ['token_hash', 'type', 'code', 'error', 'error_code', 'error_description', 'redirect_to']) url.searchParams.delete(key);
  return `${url.origin}${url.pathname}${url.search}${route}`;
}

export interface CallbackResult { recovery: boolean; notice: string | null }

/** Call after the client has initialised (await auth.getSession()), so it can't undo what this sets. */
export async function handleAuthCallback(client: SupabaseClient, href = window.location.href): Promise<CallbackResult> {
  const found = parseAuthCallback(href);
  const land = (route: string) => window.history.replaceState(null, '', cleanUrl(href, route));
  switch (found.kind) {
    case 'none':
      return { recovery: false, notice: null };
    case 'error':
      land('#/auth/sign-in');
      return { recovery: false, notice: linkProblem(found.code, found.description) };
    case 'token-hash': {
      const { error } = await client.auth.verifyOtp({ token_hash: found.tokenHash, type: found.type });
      if (error) { land('#/auth/sign-in'); return { recovery: false, notice: linkProblem(error.code ?? '', error.message) }; }
      const recovery = found.type === 'recovery';
      land(recovery ? '#/auth/reset' : '#/');
      return { recovery, notice: null };
    }
    case 'implicit': {
      const { error } = await client.auth.setSession({ access_token: found.accessToken, refresh_token: found.refreshToken });
      if (error) { land('#/auth/sign-in'); return { recovery: false, notice: linkProblem(error.code ?? '', error.message) }; }
      const recovery = found.type === 'recovery';
      land(recovery ? '#/auth/reset' : '#/');
      return { recovery, notice: null };
    }
    case 'code': {
      // supabase-js has already exchanged a code this browser asked for (and removed it). A code still here
      // was requested in another browser or app, so it can't be completed in this one.
      const { data } = await client.auth.getSession();
      if (data.session) return { recovery: false, notice: null };
      land('#/auth/forgot');
      return { recovery: false, notice: 'Open the link in the same browser where you requested it, or request a new one here.' };
    }
  }
}
