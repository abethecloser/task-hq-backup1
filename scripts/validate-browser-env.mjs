import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
let url;
try { url = new URL(env.VITE_SUPABASE_URL); } catch { throw new Error('Invalid VITE_SUPABASE_URL: production requires an HTTP(S) backend URL.'); }
if (!['https:', 'http:'].includes(url.protocol)) throw new Error('VITE_SUPABASE_URL must use HTTP(S).');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
let role;
try { role = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()).role; } catch {}
if (!(key.startsWith('sb_publishable_') || role === 'anon')) throw new Error('Production requires a Supabase publishable or anon key.');
console.log('Browser backend configuration validated:', url.hostname);
