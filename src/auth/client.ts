// Browser Supabase client for Task-HQ sign-in.
// Only the publishable key may ever reach the browser or the extension. A
// secret/service-role key here would bypass row-level security, so it is refused.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

function isSecretKey(value: string) {
  if (value.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(value.split('.')[1] ?? '')) as { role?: string };
    return payload.role === 'service_role';
  } catch { return false; }
}

export const backendConfigured = !!(url && key && !isSecretKey(key));
if (key && isSecretKey(key)) console.error('Refusing a secret Supabase key in the browser. Use the publishable key.');

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!backendConfigured) return null;
  client ??= createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'tmhq.auth' } });
  return client;
}

/** Where auth emails send people back to (this app's origin and path). */
export function redirectUrl(hash: string) {
  return `${location.origin}${location.pathname}${hash}`;
}
