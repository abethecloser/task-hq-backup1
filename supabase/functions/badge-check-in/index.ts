// Deployed with verify_jwt = false: a badge scan happens before anyone is signed in.
// The service-role key exists only here, on the server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { handleBadge } from './handler.ts';
import type { ScanResult } from './handler.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(req => handleBadge(req, {
  async limit(bucket, max, seconds) {
    const { data, error } = await admin.rpc('employee_activation_limit', { p_bucket: bucket, p_max: max, p_seconds: seconds });
    if (error) throw error;
    return data === true;
  },
  async scan(codeHash, deviceHash) {
    const { data, error } = await admin.rpc('badge_scan', { p_code_hash: codeHash, p_device_hash: deviceHash });
    if (error) throw error;
    return data as ScanResult;
  },
  async signInToken(email) {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data?.properties?.hashed_token) throw error ?? new Error('No sign-in token');
    return data.properties.hashed_token;
  },
}));
