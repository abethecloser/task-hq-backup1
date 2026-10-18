import { runExecCommand } from './core/executive-commands.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import type { Action, QuestState } from './core/contract.ts';
import { emptyState, reconcileStored, runAction, withAuthority } from './logic.ts';
import type { MemberRow, OrgRow } from './logic.ts';
import { commitWorkspace, authorityFor } from './persistence.ts';
import { projectOperations, automationPlan } from './automation/project.ts';


export interface DispatchDependencies {
  getUser(authorization: string): Promise<{id:string;email?:string}|null>;
  getAdmin(): SupabaseClient;
  now?: () => number;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleDispatch(req: Request, dependencies: DispatchDependencies): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const user = await dependencies.getUser(authHeader);
    if (!user) return json({ ok: false, error: 'Sign in again.' }, 401);

    const body = await req.json().catch(() => null) as { op?: string; orgId?: string; action?: Action; expectedRev?: number; limit?: number; since?:string; text?: string; subject?: {taskId?:string;leadId?:string} } | null;
    if (!body || !body.orgId || !UUID.test(body.orgId) || !['load','dispatch','tick','operations','automation','command-preview','intake-events'].includes(body.op ?? '')) return json({ ok: false, error: 'Malformed request.' }, 400);

    const admin = dependencies.getAdmin();
    const { data: me, error: memberError } = await admin.from('memberships').select('role, work_role').eq('org_id', body.orgId).eq('user_id', user.id).maybeSingle();
    // A database error is a server fault, never evidence that the caller isn't a member.
    if (memberError) { console.error('membership lookup failed', memberError); return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500); }
    if (!me) return json({ ok: false, error: 'You are not a member of this workspace.' }, 403);

    if(body.op==='intake-events') {
      const now=dependencies.now?.()??Date.now();
      const since=body.since??new Date(now-86400000).toISOString();
      if(typeof since!=='string'||!Number.isFinite(Date.parse(since))||Date.parse(since)>now) return json({ok:false,error:'Supply a valid intake event window start.'},400);
      const limit=Number.isInteger(body.limit)?Math.max(1,Math.min(200,body.limit!)):100;
      const {data:events,error:eventError}=await admin.from('intake_events')
        .select('id,org_id,source_id,external_id,channel,source_url,lead_id,task_id,accepted_at,event_kind')
        .eq('org_id',body.orgId).gte('accepted_at',new Date(since).toISOString())
        .order('accepted_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);
      if(eventError) return json({ok:false,error:'Durable intake events are unavailable; no empty result was assumed.'},503);
      return json({ok:true,version:1,orgId:body.orgId,since:new Date(since).toISOString(),truncated:(events?.length??0)>limit,
        events:(events??[]).slice(0,limit).map(e=>({id:e.id,orgId:e.org_id,sourceId:e.source_id,externalId:e.external_id,channel:e.channel,sourceUrl:e.source_url,leadId:e.lead_id,taskId:e.task_id,acceptedAt:e.accepted_at,eventKind:e.event_kind}))});
    }

    const { data: org, error: orgError } = await admin.from('organizations').select('id, slug, name, preset').eq('id', body.orgId).single();
    if (orgError || !org) return json({ ok: false, error: 'Workspace not found.' }, 404);
    const { data: memberRows, error: rosterError } = await admin.from('memberships').select('user_id, role, work_role').eq('org_id', body.orgId);
    if (rosterError) return json({ok:false,error:'Could not load workspace authority.'},503);
    if (!memberRows?.length || !memberRows.some(row=>row.user_id===user.id)) return json({ok:false,error:'Could not confirm current workspace membership.'},503);
    const ids = memberRows.map(row => row.user_id);
    const { data: profiles, error: profilesError } = await admin.from('profiles').select('id, full_name').in('id', ids);
    if (profilesError) return json({ok:false,error:'Could not load workspace people.'},503);
    const members: MemberRow[] = [];
    for (const row of memberRows ?? []) {
      let name = profiles?.find(item => item.id === row.user_id)?.full_name ?? '';
      if (!name) { const { data } = await admin.auth.admin.getUserById(row.user_id); name = data.user?.email ?? 'Member'; }
      members.push({ user_id: row.user_id, role: row.role, work_role: row.work_role, name });
    }

    const now = dependencies.now?.() ?? Date.now();
    let { data: row, error: stateError } = await admin.from('workspace_state').select('state, rev').eq('org_id', body.orgId).maybeSingle();
    if (stateError) { console.error('state read failed', stateError); return json({ ok: false, error: 'Server error. Nothing was changed.' }, 500); }
    if (!row && (body.op==='operations'||body.op==='automation'||body.op==='command-preview')) return json({ok:false,error:'Open the workspace before requesting its operational records.'},409);
    if (!row) {
      const fresh = emptyState(org as OrgRow, members, now);
      const {error:initError}=await admin.rpc('initialize_workspace',{p_org:body.orgId,p_actor:user.id,p_state:fresh});
      if(initError) return json({ok:false,error:'Could not initialize workspace. Try again.'},500);
      const loaded=await admin.from('workspace_state').select('state, rev').eq('org_id',body.orgId).single();
      if(loaded.error||!loaded.data) return json({ok:false,error:'Could not confirm workspace initialization.'},500);
      row=loaded.data;
    }
    const stored = row!.state as QuestState;

    if(body.op==='operations'||body.op==='automation'||body.op==='command-preview') {
      const authorized=withAuthority({...stored,rev:row!.rev},org as OrgRow,members);
      const currentMember=members.find(m=>m.user_id===user.id)!;
      const canRun=['owner','admin','supervisor'].includes(currentMember.role)&&currentMember.work_role!=='reviewer';
      const snapshot=projectOperations(authorized,body.orgId,user.id,now,canRun,body.op==='automation'?200:body.limit);
      if(body.op==='command-preview') {
        if(typeof body.text!=='string'||body.text.length>1000 || (body.subject && (typeof body.subject!=='object'||Array.isArray(body.subject)||Object.entries(body.subject).some(([k,v])=>!['taskId','leadId'].includes(k)||typeof v!=='string'||v.length>100)))) return json({ok:false,error:'Supply a bounded text command and optional task/lead selection.'},400);
        return json({ok:true,orgId:body.orgId,revision:row!.rev,preview:runExecCommand(authorized,{text:body.text,principal:user.id,now,modality:'text',subject:body.subject})});
      }
      if(body.op==='operations') return json({ok:true,snapshot});
      if(!canRun) return json({ok:false,error:'Only operational owners, admins and supervisors run automation.'},403);
      const plan=automationPlan(snapshot);
      if(!plan.complete) return json({ok:false,error:'Attention exceeds the bounded batch limit; no automation was committed.'},422);
      const {data:receipt,error:automationError}=await admin.rpc('sync_operational_attention',{
        p_org:body.orgId,p_actor:user.id,p_expected_rev:row!.rev,p_records:plan.records,p_complete:plan.complete,p_evaluated_at:now,p_authority:authorityFor(members),
      });
      if(automationError) return json({ok:false,error:'Automation could not be confirmed. Reload before retrying.',conflict:automationError.code==='40001'},automationError.code==='40001'?409:500);
      if(!receipt || receipt.ok!==true || receipt.orgId!==body.orgId || receipt.sourceRevision!==row!.rev) return json({ok:false,error:'Automation receipt could not be confirmed.'},500);
      return json(receipt);
    }
    if (body.op === 'tick') {
      const next = reconcileStored(stored, org as OrgRow, members, now);
      if (!next) return json({ ok: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev });
      const saved=await commitWorkspace(admin,body.orgId,user.id,row!.rev,next,'task.grant/expired',{},authorityFor(members));
      if(!saved.ok) return json(saved,saved.status);
      return json({ok:true,state:saved.state,rev:saved.rev});
    }
    if (body.op === 'load') {
      return json({ ok: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev, actor: user.id });
    }
    if (typeof body.expectedRev === 'number' && body.expectedRev !== row!.rev) {
      return json({ ok: false, error: 'Someone else just changed this workspace. Reloaded the latest version.', conflict: true, state: { ...withAuthority(stored, org as OrgRow, members), rev: row!.rev }, rev: row!.rev }, 409);
    }
    const result = runAction(stored, org as OrgRow, members, user.id, body.action as Action, now);
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);
    const saved=await commitWorkspace(admin,body.orgId,user.id,row!.rev,result.state,`task.${(body.action as Action).type}`,{eventId:result.eventId},authorityFor(members));
    if(!saved.ok) return json(saved,saved.status);
    return json({ok:true,state:saved.state,rev:saved.rev,message:result.message,eventId:result.eventId,undoable:result.undoable});
  } catch (error) {
    console.error('dispatch failed', error);
    return json({ ok: false, error: 'Server response could not be confirmed. Reload before retrying.' }, 500);
  }
}
