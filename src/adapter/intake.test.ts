import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiveIntake } from './intake.ts';
import type { IntakeEnvelope } from './intake.ts';
const envelope: IntakeEnvelope = { version: 1, sourceId: 'construction.website', externalId: 'test-delivery-1', receivedAt: '2026-10-17T18:00:00Z', contact: { name: 'Synthetic inquiry', email: 'fixture@example.test' }, inquiry: { need: 'Synthetic estimate request' } };
const receipt = { ok: true as const, status: 'accepted' as const, receiptId: 'receipt-1', orgId: 'construction-fixture', leadId: 'lead-1', taskId: 'task-1', acceptedAt: '2026-10-17T18:00:01Z' };
const wait = async () => {};
test('lost response after commit retries same immutable event and returns duplicate receipt', async () => {
  const input = structuredClone(envelope); const calls: unknown[] = [];
  const result = await receiveIntake({ rpc: async (_name, args) => {
    calls.push(structuredClone(args.p_envelope));
    if (calls.length === 1) { input.externalId = 'changed-by-caller'; throw new Error('response lost after commit'); }
    return { data: { ...receipt, status: 'duplicate' }, error: null };
  } }, input, { wait });
  assert.deepEqual(calls, [envelope,envelope]);
  assert.deepEqual(result, { ...receipt, status: 'duplicate' });
});
test('conflicts, malformed data, and unauthorized sources are never automatically retried', async () => {
  for (const [sqlCode, code] of [['23505','conflict'],['22023','invalid'],['42501','unavailable'],['55000','unavailable'],['PGRST202','unavailable']]) {
    let calls = 0;
    const result = await receiveIntake({ rpc: async () => { calls++; return { data: null, error: { code: sqlCode, message: 'SQL rejection' } }; } }, envelope, { wait });
    assert.equal(calls, 1); assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.code,code); assert.equal(result.retryable,false); }
  }
});
test('network failure is bounded and remains unconfirmed, never accepted', async () => {
  let calls = 0;
  const result = await receiveIntake({ rpc: async () => { calls++; return { data: null, error: { code: '', message: 'Failed to fetch' } }; } },envelope,{ wait });
  assert.equal(calls,3); assert.equal(result.ok,false);
  if (!result.ok) { assert.equal(result.code,'retry'); assert.equal(result.retryable,true); }
});
test('successful-looking response without durable receipt is unconfirmed', async () => {
  const result = await receiveIntake({ rpc: async () => ({ data: { ok: true }, error: null }) },envelope,{wait});
  assert.equal(result.ok,false);
});
test('server failures are surfaced without silently creating a second delivery', async () => {
  let calls = 0;
  const result = await receiveIntake({ rpc: async () => { calls++; return { data: null, error: { code: 'XX000', message: 'database fault' } }; } },envelope,{wait});
  assert.equal(calls,1); assert.equal(result.ok,false);
  if (!result.ok) assert.equal(result.code,'server');
});

test('database lock contention retries the original delivery with bounded backoff', async () => {
  const calls: unknown[] = []; const waits: number[] = [];
  const result = await receiveIntake({ rpc: async (_name,args) => {
    calls.push(structuredClone(args.p_envelope));
    return calls.length < 3 ? { data: null, error: { code: calls.length === 1 ? '55P03' : '40001', message: 'contention' } } : { data: receipt, error: null };
  } },envelope,{ wait: async ms => { waits.push(ms); } });
  assert.deepEqual(calls,[envelope,envelope,envelope]);
  assert.deepEqual(waits,[250,500]);
  assert.deepEqual(result,receipt);
});
