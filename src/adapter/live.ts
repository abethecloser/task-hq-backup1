// Live, shared backend for a real organization. Reads and writes go through the
// `dispatch` Edge Function, which verifies the JWT and runs the Task-HQ engine on
// the server; other members' changes arrive through Supabase Realtime (RLS applies).
// No task data is kept in browser storage in live mode.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action, QuestState } from '../core/contract.ts';
import type { DispatchResult, QuestBackend } from './store.ts';

interface ServerReply { ok: boolean; state?: QuestState; rev?: number; message?: string; error?: string; eventId?: string | null; undoable?: boolean; conflict?: boolean }

export function createLiveBackend(client: SupabaseClient, url: string, publishableKey: string, org: { id: string; name: string }, userId: string): QuestBackend {
  let latest: QuestState | null = null;
  let lastTick = 0;

  async function call(body: Record<string, unknown>): Promise<{ status: number; reply: ServerReply }> {
    try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { status: 401, reply: { ok: false, error: 'Your session ended. Sign in again.' } };
      const response = await fetch(`${url}/functions/v1/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: publishableKey },
        body: JSON.stringify({ ...body, orgId: org.id }),
      });
      const reply = await response.json().catch(() => ({ ok: false, error: 'Unexpected server response.' })) as ServerReply;
      return { status: response.status, reply };
    } catch {
      return { status: 0, reply: { ok: false, error: 'Task-HQ could not confirm the response. Reload the workspace before retrying.' } };
    }
  }

  const remember = (state: QuestState | undefined, rev: number | undefined) => {
    if (state && (!latest || (rev ?? state.rev) >= latest.rev)) latest = { ...state, rev: rev ?? state.rev };
    return latest!;
  };

  return {
    kind: 'live',
    authority: 'server-verified',
    label: `Shared · ${org.name}`,
    detail: `Saved to Task-HQ. Everyone in ${org.name} sees changes as they happen. Permissions are checked on the server.`,
    async load() {
      const { reply } = await call({ op: 'load' });
      if (!reply.ok || !reply.state) throw new Error(reply.error ?? 'Could not load the workspace.');
      return remember(reply.state, reply.rev);
    },
    async dispatch(action: Action): Promise<DispatchResult> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { status, reply } = await call({ op: 'dispatch', action, expectedRev: latest?.rev });
        if (reply.ok && reply.state) {
          return { ok: true, state: remember(reply.state, reply.rev), message: reply.message ?? 'Saved.', eventId: reply.eventId ?? null, undoable: !!reply.undoable };
        }
        if (status === 409 && attempt === 0) { if (reply.state) remember(reply.state, reply.rev); else await this.load(); continue; }
        return { ok: false, state: latest!, error: reply.error ?? 'Not saved.' };
      }
      return { ok: false, state: latest!, error: 'Not saved. Try again.' };
    },
    async tick() {
      // Temporary access expires on the server; ask at most every 5 seconds.
      if (Date.now() - lastTick < 5000) return;
      lastTick = Date.now();
      const { reply } = await call({ op: 'tick' });
      if (reply.ok && reply.state) remember(reply.state, reply.rev);
    },
    subscribe(listener) {
      const channel = client.channel(`workspace-${org.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspace_state', filter: `org_id=eq.${org.id}` }, payload => {
          const row = payload.new as { state?: QuestState; rev?: number };
          if (row.state) listener(remember(row.state, row.rev));
        })
        .subscribe();
      return () => { void client.removeChannel(channel); };
    },
    async getActor() { return userId; },
    async setActor() { /* the signed-in account is the actor */ },
    subscribeActor() { return () => undefined; },
    async outboxCount() { return 0; },
  };
}
