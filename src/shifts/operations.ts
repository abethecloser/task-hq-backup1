import { deviceGet, deviceKey, devicePut, deviceRemove, deviceTransaction } from './device.ts';
import type { ShiftAction, ShiftBackend, ShiftCommand, ShiftMedia } from './types.ts';
import { normalizeMime, validateMedia } from './types.ts';
export interface PendingUpload { id: string; shift_id: string; blob: Blob; text: string; task_id: string; project_id: string; purpose: 'capture' | 'eod'; observed_at: string; partial?: boolean; durable?: boolean }
export const pendingKey = (backend: ShiftBackend) => deviceKey(backend.org, backend.actor, 'pending-command');
export const uploadKey = (backend: ShiftBackend) => deviceKey(backend.org, backend.actor, 'pending-upload');
export async function sendShift(backend: ShiftBackend, action: ShiftAction, shift_id: string | null, data: Record<string, unknown>) {
  const key = pendingKey(backend);
  const command: ShiftCommand = { id: crypto.randomUUID(), action, shift_id, data: { ...data, client_observed_at: new Date().toISOString() } };
  await deviceTransaction<void>('readwrite', (store, done, fail) => {
    const check=store.get(key); check.onsuccess=()=>{ if(check.result){fail(new Error('A previous action is awaiting confirmation. Retry it before starting another action.'));return;} store.put(command,key);done(); };
  }); // Save BEFORE sending; one pending request per employee even across tabs.
  return retryShift(backend);
}
export async function retryShift(backend: ShiftBackend) {
  const key = pendingKey(backend), command = await deviceGet<ShiftCommand>(key);
  if (!command) throw new Error('No pending action.');
  try {
    const result = await backend.command(command);
    await deviceRemove(key); return result;
  } catch (error) {
    // Business-rule rejections are confirmed failures, not ambiguous transport failures.
    // Keep the exact request for reconciliation; the UI can inspect, refresh and explicitly dismiss it.
    throw error;
  }
}
export async function resumeUpload(backend: ShiftBackend, upload: PendingUpload) {
  validateMedia(upload.blob);
  const common = { task_id: upload.task_id, project_id: upload.project_id, media_id: upload.id };
  const reserve: ShiftCommand = { id: upload.id, action: 'reserve_media', shift_id: upload.shift_id, data: { ...common, mime: normalizeMime(upload.blob.type), bytes: upload.blob.size, client_observed_at: upload.observed_at } };
  const reserved = await backend.command(reserve);
  const media = reserved.media.find(item => item.id === upload.id) as ShiftMedia | undefined;
  if (!media) throw new Error('Media reservation was not confirmed.');
  await backend.upload(media, upload.blob);
  await backend.command({ id: stableUuid(upload.id, 1), action: 'finish_media', shift_id: upload.shift_id, data: { media_id: upload.id } });
  if (upload.purpose === 'capture') await backend.command({ id: stableUuid(upload.id, 2), action: 'capture', shift_id: upload.shift_id, data: { ...common, text: upload.text, client_observed_at: upload.observed_at } });
  return media.id;
}
// Derivative UUIDs keep the upload's reservation/finalization/record commands stable through reloads.
export function stableUuid(id: string, stage: number) { return id.slice(0, -2) + ((parseInt(id.slice(-2), 16) + stage) % 256).toString(16).padStart(2, '0'); }
