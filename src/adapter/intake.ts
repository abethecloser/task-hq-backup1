import { validateIntakeEnvelope } from './intake-validation.ts';
/** Website and future receptionist delivery contract. Never embed credentials in
 * a public form: this adapter runs with an explicitly authorized member session.
 * Keep the exact envelope until a durable receipt is returned. */
export interface IntakeEnvelope {
  version: 1;
  sourceId: string;
  externalId: string;
  receivedAt: string;
  contact: { name: string; email?: string; phone?: string };
  inquiry: { need: string; address?: string };
}
export interface IntakeReceipt {
  ok: true;
  status: 'accepted' | 'duplicate';
  receiptId: string;
  orgId: string;
  leadId: string;
  taskId: string;
  acceptedAt: string;
}
export type IntakeFailureCode = 'invalid' | 'unavailable' | 'conflict' | 'retry' | 'server';
export type IntakeResult = IntakeReceipt | { ok: false; code: IntakeFailureCode; retryable: boolean; message: string };
interface RpcError { code?: string; message: string }
export interface IntakeRpc {
  rpc(name: 'receive_intake', args: { p_envelope: IntakeEnvelope }): PromiseLike<{ data: unknown; error: RpcError | null }>;
}
const MESSAGES: Record<IntakeFailureCode, string> = {
  invalid: 'Check the inquiry details and at least one valid contact method.',
  unavailable: 'Intake is unavailable for this session or source. Confirm its approved workspace and follow-up owner.',
  conflict: 'This source event ID was already used for different details. Review the original receipt; do not generate a new ID to retry.',
  retry: 'Delivery is unconfirmed. Retry the exact same source event ID and details.',
  server: 'Intake could not be confirmed. Keep the original delivery for review.',
};
const failure = (code: IntakeFailureCode): IntakeResult => ({ ok: false, code, retryable: code === 'retry', message: MESSAGES[code] });
function classify(error: RpcError): IntakeFailureCode {
  if (error.code === '22023') return 'invalid';
  if (error.code === '23505') return 'conflict';
  if (['42501', '55000', 'PGRST301', 'PGRST302', 'PGRST202'].includes(error.code ?? '')) return 'unavailable';
  if (['40001', '40P01', '55P03', '57014', '08000', '08006'].includes(error.code ?? '') || (!error.code && /fetch|network|timeout/i.test(error.message))) return 'retry';
  return 'server';
}
function isReceipt(data: unknown): data is IntakeReceipt {
  if (!data || typeof data !== 'object') return false;
  const r = data as Record<string, unknown>;
  return r.ok === true && (r.status === 'accepted' || r.status === 'duplicate')
    && ['receiptId','orgId','leadId','taskId','acceptedAt'].every(key => typeof r[key] === 'string' && !!r[key]);
}
/** Bounded retries reuse an immutable snapshot, including after an ambiguous
 * network loss. No auto-generated identity, in-memory queue, or false success. */
export async function receiveIntake(client: IntakeRpc, envelope: IntakeEnvelope,
  options: { wait?: (ms: number) => Promise<void> } = {}): Promise<IntakeResult> {
  if (!validateIntakeEnvelope(envelope).ok) return failure('invalid');
  const snapshot = JSON.stringify(envelope);
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt++) {
    let code: IntakeFailureCode;
    try {
      const { data, error } = await client.rpc('receive_intake', { p_envelope: JSON.parse(snapshot) });
      if (!error) return isReceipt(data) ? data : failure('retry');
      code = classify(error);
    } catch { code = 'retry'; }
    if (code !== 'retry' || attempt === 2) return failure(code);
    await wait(250 * 2 ** attempt);
  }
  return failure('retry');
}
