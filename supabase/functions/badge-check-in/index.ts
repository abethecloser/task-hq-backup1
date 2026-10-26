// Deployed with verify_jwt = false so a signed-out scan gets a clear "sign in" answer instead
// of a gateway error; the handler itself requires and verifies the caller's session.
// The service-role key exists only here, on the server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { handleBadge } from './handler.ts';
import type { VerifyResult } from './handler.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(req => handleBadge(req, {
  async limit(bucket, max, seconds) {
    const { data, error } = await admin.rpc('employee_activation_limit', { p_bucket: bucket, p_max: max, p_seconds: seconds });
    if (error) throw error;
    return data === true;
  },
  async caller(authorization) {
    if (!/^Bearer \S+$/.test(authorization)) return null;
    const user = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await user.auth.getUser();
    return data.user?.id ?? null;
  },
  async verify(codeHash, deviceHash, user) {
    const { data, error } = await admin.rpc('badge_verify', { p_code_hash: codeHash, p_device_hash: deviceHash, p_user: user });
    if (error) throw error;
    return data as VerifyResult;
  },
}));
