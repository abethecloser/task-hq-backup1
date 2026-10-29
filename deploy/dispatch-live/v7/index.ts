// Task-HQ `dispatch` Edge Function: the only write path for shared task data.
// POST { op: 'load' | 'dispatch' | 'tick', orgId, action?, expectedRev? } with the user's JWT.
// The service-role key exists only here, on the server (Supabase-provided secret).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { Action, QuestState } from './core/contract.ts';
import { emptyState, reconcileStored, runAction, withAuthority } from './logic.ts';
import type { MemberRow, OrgRow } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Clients enable task types/tags/times, reopening, lead claim/tags, work labels and
// structured references only when they see this contract (v4 replies carry none).
const CONTRACT = 7;
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify({ ...body, contract: CONTRACT }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, error: 'Sign in again.' }, 401);

    const body = await req.json().catch(() => null) as { op?: string; orgId?: string; action?: Action; expectedRev?: number } | null;
    if (!body || !body.orgId || !UUID.test(body.orgId) || (body.op !== 'load' && body.op !== 'dispatch' && body.op !== 'tick')) return json({ ok: false, error: 'Malformed request.' }, 400);

    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { data: me, error: memberError } = await admin.from('memberships').select('role').eq('org_id', body.orgId).eq('user_id', user.id).maybeSingle();
    // A database error is a server fault, never evidence that the caller isn't a member.
    if (memberError) { console.error('membership lookup failed', memberError); return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500); }
    if (!me) return json({ ok: false, error: 'You are not a member of this workspace.' }, 403);

    const { data: org, error: orgError } = await admin.from('organizations').select('id, slug, name, preset').eq('id', body.orgId).single();
    if (orgError || !org) return json({ ok: false, error: 'Workspace not found.' }, 404);
    const { data: memberRows } = await admin.from('memberships').select('user_id, role, work_role').eq('org_id', body.orgId);
    const ids = (memberRows ?? []).map(row => row.user_id);
    const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids);
    const members: MemberRow[] = [];
    for (const row of memberRows ?? []) {
      let name = profiles?.find(item => item.id === row.user_id)?.full_name ?? '';
      if (!name) { const { data } = await admin.auth.admin.getUserById(row.user_id); name = data.user?.email ?? 'Member'; }
      members.push({ user_id: row.user_id, role: row.role, work_role: row.work_role, name });
    }

    const now = Date.now();
    let { data: row, error: stateError } = await admin.from('workspace_state').select('state, rev').eq('org_id', body.orgId).maybeSingle();
    if (stateError) { console.error('state read failed', stateError); return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500); }
    if (!row) {
      const fresh = emptyState(org as OrgRow, members, now);
      const { error: initError } = await admin.from('workspace_state').insert({ org_id: body.orgId, state: fresh, rev: 1, updated_by: user.id });
      if (initError && initError.code !== '23505') { console.error('state init failed', initError); return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500); }
      await admin.from('audit_log').insert({ actor: user.id, actor_label: user.email ?? '', org_id: body.orgId, action: 'workspace.initialized' });
      ({ data: row } = await admin.from('workspace_state').select('state, rev').eq('org_id', body.orgId).single());
    }
    const stored = row!.state as QuestState;

    if (body.op === 'tick') {
      const next = reconcileStored(stored, org as OrgRow, members, now);
      if (!next) return json({ ok: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev });
      const nextRev = row!.rev + 1;
      const { data: saved } = await admin.from('workspace_state')
        .update({ state: { ...next, rev: nextRev }, rev: nextRev, updated_at: new Date(now).toISOString(), updated_by: user.id })
        .eq('org_id', body.orgId).eq('rev', row!.rev).select('rev');
      if (saved?.length) await admin.from('audit_log').insert({ actor: null, actor_label: 'system', org_id: body.orgId, action: 'task.grant/expired' });
      return json({ ok: true, state: { ...next, rev: nextRev }, rev: saved?.length ? nextRev : row!.rev });
    }
    if (body.op === 'load') {
      return json({ ok: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev, actor: user.id });
    }
    if (typeof body.expectedRev === 'number' && body.expectedRev !== row!.rev) {
      return json({ ok: false, error: 'Someone else just changed this workspace. Reloaded the latest version.', conflict: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev }, 409);
    }
    const result = runAction(stored, org as OrgRow, members, user.id, body.action as Action, now);
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);
    const nextRev = row!.rev + 1;
    const next = { ...result.state, rev: nextRev };
    const { data: saved, error: saveError } = await admin.from('workspace_state')
      .update({ state: next, rev: nextRev, updated_at: new Date(now).toISOString(), updated_by: user.id })
      .eq('org_id', body.orgId).eq('rev', row!.rev).select('rev');
    if (saveError) return json({ ok: false, error: 'Could not save. Try again.' }, 500);
    if (!saved || saved.length === 0) return json({ ok: false, error: 'Someone else just changed this workspace. Try again.', conflict: true }, 409);
    await admin.from('audit_log').insert({ actor: user.id, actor_label: user.email ?? '', org_id: body.orgId, action: `task.${(body.action as Action).type}`, detail: { eventId: result.eventId } });
    return json({ ok: true, state: next, rev: nextRev, message: result.message, eventId: result.eventId, undoable: result.undoable });
  } catch (error) {
    console.error('dispatch failed', error);
    return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500);
  }
});
