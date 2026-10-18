// Trusted operator/provider adapter. Does not read inboxes or connect accounts.
// Node >=24 can import the shared erasable TypeScript contract directly.
import { readFile } from 'node:fs/promises';
import { receiveIntake } from '../src/adapter/intake.ts';
const file = process.argv[2];
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const token = process.env.TASK_HQ_ACCESS_TOKEN;
if (!file || !url || !key || !token) {
  console.error('Usage: node --env-file=.env.production.local scripts/submit-intake.mjs <envelope.json>\nRequires TASK_HQ_ACCESS_TOKEN for an explicitly authorized organization member. Keep tokens out of files, arguments, and logs.');
  process.exitCode = 2;
} else {
  try {
    const endpoint = new URL('/rest/v1/rpc/receive_intake', url);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'xthyyxnfjaxmtrqrhyxc.supabase.co') throw new Error('Unexpected backend');
    const raw = await readFile(file, 'utf8');
    if (Buffer.byteLength(raw) > 16384) throw new Error('Oversized envelope');
    const envelope = JSON.parse(raw);
    const client = { rpc: async (_name, args) => {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) return { data, error: null };
      return { data: null, error: { code: data?.code ?? (response.status >= 500 || response.status === 429 ? '08006' : '42501'), message: 'Intake request rejected' } };
    } };
    const result = await receiveIntake(client, envelope);
    // Receipt/error only, never contact details or token values.
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = result.retryable ? 75 : 1;
  } catch {
    console.error('Intake was not confirmed. Check the input file, backend configuration, and session. Keep the original envelope for safe retry.');
    process.exitCode = 1;
  }
}
