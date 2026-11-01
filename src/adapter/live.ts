// Live, shared backend for a real organization. Reads and writes go through the
// `dispatch` Edge Function, which verifies the JWT and runs the Task-HQ engine on
// the server; other members' changes arrive through Supabase Realtime (RLS applies).
// No task data is kept in browser storage in live mode.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action, QuestState } from '../core/contract.ts';
import type { BackendSupports, DispatchResult, QuestBackend } from './store.ts';

interface ServerReply { ok: boolean; state?: QuestState; rev?: number; message?: string; error?: string; eventId?: string | null; undoable?: boolean; conflict?: boolean; contract?: number }

/** dispatch v5 is the first release that advertises a contract; v4 replies carry none. */
const FULL_CONTRACT = 5;
/** dispatch v6 adds completedBy and `task/archive`/`task/unarchive`; older servers answer 400 for them. */
const ARCHIVE_CONTRACT = 6;
/** dispatch v7 adds `project/create`. */
const PROJECT_CONTRACT = 7;
/** dispatch v8 archives unfinished work as legacy (status kept); v7 refuses it as not completed. */
const LEGACY_CONTRACT = 8;
/** dispatch v9 adds `project/archive` and `project/unarchive`; v8 answers 400 for them. */
const PROJECT_ARCHIVE_CONTRACT = 9;

// dispatch v4 (verified against the deployed source on 2026-10-20) predates these
// features; they are refused before sending until a reply advertises the v5 contract.
// Never discard fields. Reference drafts are the exception: they are client-side
// link hints, not fields. v4 ignores them and saves the text (@Name, #tag)
// verbatim, so they are removed rather than blocking every later write.
const withoutReferenceDrafts = (action: Action): Action => {
  const { referenceDrafts: _drafts, ...rest } = action;
  return rest as Action;
};
function unsupported(action: Action): string | null {
  if (['task/reopen', 'roles/label', 'lead/tags', 'lead/claim', 'taxonomy/register-tags', 'taxonomy/update'].includes(action.type)) {
    return 'This action is unavailable on the current shared server. Nothing was sent.';
  }
  const fields = action.type === 'task/create' ? action.task : action.type === 'task/update' ? action.changes : null;
  if (fields && ['type', 'tags', 'dueTime'].some(key => Object.prototype.hasOwnProperty.call(fields, key))) {
    return 'Task type, tags and time are unavailable on the current shared server. Nothing was sent.';
  }
  return null;
}

export function createLiveBackend(client: SupabaseClient, url: string, publishableKey: string, org: { id: string; name: string }, userId: string): QuestBackend {
  let latest: QuestState | null = null;
  let lastTick = 0;
  // From the most recent server reply, so a rollback to v4 turns the gates back on.
  let contract = 0;

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
      const reply = await response.json().catch(() => null) as ServerReply | null;
      if (!reply) return { status: response.status, reply: { ok: false, error: 'Unexpected server response.' } };
      // Gateway and runtime errors never carry a contract; only the function's own replies count.
      if (response.ok) contract = typeof reply.contract === 'number' ? reply.contract : 0;
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
      const { status, reply } = await call({ op: 'load' });
      if (status < 200 || status >= 300 || !reply.ok || !reply.state) throw new Error(reply.error ?? 'Could not load the workspace.');
      return remember(reply.state, reply.rev);
    },
    async dispatch(action: Action): Promise<DispatchResult> {
      const full = contract >= FULL_CONTRACT;
      const archiveGate = (action.type === 'task/archive' || action.type === 'task/unarchive') && contract < ARCHIVE_CONTRACT ? 'Archiving is unavailable on the current shared server. Nothing was sent.' : null;
      const projectGate = action.type === 'project/create' && contract < PROJECT_CONTRACT ? 'Creating projects is unavailable until the server update (dispatch v7) is deployed. Nothing was sent.' : null;
      const legacyGate = action.type === 'task/archive' && action.reason === 'legacy' && contract < LEGACY_CONTRACT ? 'Archiving unfinished work is unavailable until the server update (dispatch v8 or later) is deployed. Nothing was sent.' : null;
      const projectArchiveGate = (action.type === 'project/archive' || action.type === 'project/unarchive') && contract < PROJECT_ARCHIVE_CONTRACT ? 'Archiving projects is unavailable until the server update (dispatch v9) is deployed. Nothing was sent.' : null;
      const error = archiveGate ?? projectGate ?? legacyGate ?? projectArchiveGate ?? (full ? null : unsupported(action));
      if (error) return { ok: false, state: latest!, error };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { status, reply } = await call({ op: 'dispatch', action: full ? action : withoutReferenceDrafts(action), expectedRev: latest?.rev });
        if (status >= 200 && status < 300 && reply.ok && reply.state) {
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
      const { status, reply } = await call({ op: 'tick' });
      if (status >= 200 && status < 300 && reply.ok && reply.state) remember(reply.state, reply.rev);
    },
    subscribe(listener) {
      const channel = client.channel(`workspace-${org.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workspace_state', filter: `org_id=eq.${org.id}` }, payload => {
          const row = payload.new as { state?: QuestState; rev?: number };
          if (!row.state) return;
          // Realtime rows are stored state. Authority is server-derived: keep what the last load or dispatch said, and fail closed to Member.
          const known = new Map((latest?.people ?? []).map(item => [item.id, item.authority]));
          const people = row.state.people.map(item => (item.authority ? item : { ...item, authority: known.get(item.id) ?? 'member' as const }));
          listener(remember({ ...row.state, people }, row.rev));
        })
        .subscribe();
      return () => { void client.removeChannel(channel); };
    },
    async getActor() { return userId; },
    async setActor() { /* the signed-in account is the actor */ },
    subscribeActor() { return () => undefined; },
    async outboxCount() { return 0; },
    get supports(): BackendSupports {
      const full = contract >= FULL_CONTRACT;
      return { taskTaxonomy: full, taskReopen: full, leadOwnership: full, workLabels: full, structuredReferences: full, taskArchive: contract >= ARCHIVE_CONTRACT, projectCreate: contract >= PROJECT_CONTRACT, legacyArchive: contract >= LEGACY_CONTRACT, projectArchive: contract >= PROJECT_ARCHIVE_CONTRACT };
    },
  };
}
