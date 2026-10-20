import type { SupabaseClient } from '@supabase/supabase-js';
import { deviceGet, devicePut, deviceTransaction } from './device.ts';
import { applyShift, emptyLedger, shiftSnapshot } from './model.ts';
import type { DemoLedger } from './model.ts';
import type { ShiftBackend, ShiftCommand, ShiftContext, Shift, ShiftSnapshot } from './types.ts';
export function liveShiftBackend(client: SupabaseClient, org: string, actor: string): ShiftBackend {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw new Error(`${error.message}${error.code === 'PGRST202' ? ' The Shift v1 backend migration has not been installed.' : ''}`);
    if (!data) throw new Error('The server did not confirm the operation. Keep the pending request and retry.');
    return data as T;
  };
  return {
    kind: 'live', org, actor,
    async load(team = false) {
      const value = await call<ShiftSnapshot>('shift_list', { p_org: org || null, p_team: team });
      if (!Array.isArray(value.shifts) || !Number.isFinite(Date.parse(value.server_now))) throw new Error('Invalid shift response. No shift state was assumed.');
      return value;
    },
    command: command => call<Shift>('shift_command', { p_org: org, p_request: command.id, p_action: command.action, p_shift: command.shift_id, p_data: command.data }),
    async upload(media, blob) {
      const { error } = await client.storage.from('quest-shift-media').upload(media.path, blob, { contentType: media.mime, upsert: false });
      // A previously successful upload may have lost its response. Finalization independently checks bytes/type on the server.
      if (error && !['409', 'Duplicate'].includes(String(error.statusCode)) && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
    },
    async mediaUrl(media) {
      const { data, error } = await client.storage.from('quest-shift-media').createSignedUrl(media.path, 60);
      if (error || !data) throw new Error(error?.message ?? 'Attachment is unavailable.');
      return data.signedUrl;
    },
  };
}
export function demoShiftBackend(getContext: () => ShiftContext): ShiftBackend {
  const context = getContext(), key = `demo-ledger:${context.org}`;
  return {
    kind: 'demo', org: context.org, actor: context.actor,
    async load(team = false) { return shiftSnapshot(await deviceGet<DemoLedger>(key) ?? emptyLedger(), getContext(), Date.now(), team); },
    async command(command) {
      if (command.action === 'finish_media' && !(await deviceGet<Blob>(`demo-media:${command.data.media_id}`))) throw new Error('Demo attachment was not saved on this device.');
      return deviceTransaction<Shift>('readwrite', (store, done, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            const result = applyShift((request.result as DemoLedger | undefined) ?? emptyLedger(), command, getContext(), Date.now());
            store.put(result.ledger, key); done(result.shift);
          } catch (error) { fail(error); }
        };
      });
    },
    async upload(media, blob) { await devicePut(`demo-media:${media.id}`, blob); },
    async mediaUrl(media) { const blob = await deviceGet<Blob>(`demo-media:${media.id}`); if (!blob) throw new Error('Local attachment not found.'); return URL.createObjectURL(blob); },
  };
}
