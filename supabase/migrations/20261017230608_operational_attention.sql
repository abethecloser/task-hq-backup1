-- Server-only atomic persistence and bounded operational attention. No scheduler,
-- source enablement, account provisioning or customer communications.
begin;
create table public.operational_attention (
  org_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null check (length(rule_key) between 1 and 200),
  record jsonb not null,
  fingerprint jsonb not null,
  source_rev integer not null,
  first_seen_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key(org_id,rule_key)
);
alter table public.operational_attention enable row level security;
revoke all on public.operational_attention from public, anon, authenticated;
grant select on public.operational_attention to authenticated;
grant select,insert,update on public.operational_attention to service_role;
create policy operational_attention_read on public.operational_attention for select to authenticated
  using(private.is_member(org_id));

-- A workspace revision alone cannot order evaluations of time-based rules.
create table private.operational_evaluations (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  evaluated_at bigint not null,
  source_rev integer not null
);
alter table private.operational_evaluations enable row level security;
revoke all on private.operational_evaluations from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update on private.operational_evaluations to service_role;

-- Row locking requires UPDATE privilege in PostgreSQL. Keep that privilege
-- away from the service role's membership API: expose only this private lock.
create function private.lock_workspace_authority(p_org uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_agg(jsonb_build_array(user_id::text,role::text,work_role) order by user_id)
  from (select user_id,role,work_role from public.memberships where org_id=p_org for share) locked;
$$;
revoke all on function private.lock_workspace_authority(uuid) from public,anon,authenticated;
grant execute on function private.lock_workspace_authority(uuid) to service_role;

-- Service role is already privileged to write workspace state. These invoker
-- RPCs make the state write + audit one transaction instead of two requests.
create function public.commit_workspace_action(p_org uuid,p_actor uuid,p_expected_rev integer,p_state jsonb,p_action text,p_detail jsonb,p_authority jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_rev integer; authority_ jsonb;
begin
  authority_:=private.lock_workspace_authority(p_org);
  if authority_ is distinct from p_authority then raise exception using errcode='40001',message='Workspace authority changed; re-evaluate'; end if;
  if not exists(select 1 from public.memberships where org_id=p_org and user_id=p_actor) then
    raise exception using errcode='42501',message='Workspace membership required'; end if;
  if p_state->'workspace'->>'tenantId' is distinct from p_org::text
    or jsonb_typeof(p_state->'tasks') is distinct from 'array' or jsonb_typeof(p_state->'leads') is distinct from 'array'
    or p_expected_rev is null or p_expected_rev<1 or coalesce(length(p_action),0) not between 1 and 200 then
    raise exception using errcode='22023',message='Invalid workspace commit'; end if;
  update public.workspace_state set state=p_state || jsonb_build_object('rev',p_expected_rev+1),rev=p_expected_rev+1,
    updated_at=statement_timestamp(),updated_by=p_actor where org_id=p_org and rev=p_expected_rev returning rev into v_rev;
  if not found then return jsonb_build_object('ok',false,'conflict',true); end if;
  insert into public.audit_log(actor,actor_label,org_id,action,detail) values(p_actor,'authenticated member',p_org,p_action,p_detail);
  return jsonb_build_object('ok',true,'rev',v_rev);
end;
$$;
create function public.initialize_workspace(p_org uuid,p_actor uuid,p_state jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
  if not exists(select 1 from public.memberships where org_id=p_org and user_id=p_actor) then
    raise exception using errcode='42501',message='Workspace membership required'; end if;
  if p_state->'workspace'->>'tenantId' is distinct from p_org::text then raise exception using errcode='22023',message='Invalid workspace initialization'; end if;
  insert into public.workspace_state(org_id,state,rev,updated_by) values(p_org,p_state || '{"rev":1}'::jsonb,1,p_actor) on conflict(org_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then
    insert into public.audit_log(actor,actor_label,org_id,action) values(p_actor,'authenticated member',p_org,'workspace.initialized'); end if;
end;
$$;

create function public.sync_operational_attention(p_org uuid,p_actor uuid,p_expected_rev integer,p_records jsonb,p_complete boolean,p_evaluated_at bigint,p_authority jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_rev integer; watermark_ bigint; authority_ jsonb; r jsonb; key_ text; fp jsonb; existing public.operational_attention%rowtype;
  opened_ integer:=0; changed_ integer:=0; resolved_ integer:=0;
begin
  authority_:=private.lock_workspace_authority(p_org);
  if authority_ is distinct from p_authority then raise exception using errcode='40001',message='Workspace authority changed; re-evaluate'; end if;
  if not exists(select 1 from public.memberships where org_id=p_org and user_id=p_actor and role in ('owner','admin','supervisor') and work_role<>'reviewer') then
    raise exception using errcode='42501',message='Operational manager membership required'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>200 or p_complete is null or p_evaluated_at is null or p_evaluated_at<0 or p_evaluated_at>extract(epoch from statement_timestamp())*1000+300000 then
    raise exception using errcode='22023',message='Invalid attention batch'; end if;
  -- Serialize with task/intake commits and refuse a stale projection.
  select rev into v_rev from public.workspace_state where org_id=p_org for update;
  if not found or v_rev is distinct from p_expected_rev then raise exception using errcode='40001',message='Workspace changed; re-evaluate'; end if;
  select evaluated_at into watermark_ from private.operational_evaluations where org_id=p_org;
  if watermark_>p_evaluated_at then raise exception using errcode='40001',message='A newer operational evaluation already committed'; end if;
  if (select count(*) from jsonb_array_elements(p_records)) <> (select count(distinct x->>'id') from jsonb_array_elements(p_records) x) then
    raise exception using errcode='22023',message='Duplicate attention key'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    key_:=r->>'id';
    if r->>'orgId' is distinct from p_org::text or coalesce(length(key_),0) not between 1 and 200
      or coalesce(r->>'severity','') not in ('critical','high','normal') or jsonb_typeof(r->'subject') is distinct from 'object' then
      raise exception using errcode='22023',message='Invalid scoped attention record'; end if;
    -- Countdown prose changes each poll; only meaningful condition/ownership/
    -- next-action changes reopen or update a durable attention event.
    fp:=jsonb_build_array(r->'rule',r->'severity',r->'subject',r->'accountableId',r->'assignmentRequired',r->'nextAction',r->'conditionVersion');
    select * into existing from public.operational_attention where org_id=p_org and rule_key=key_;
    if not found then
      insert into public.operational_attention(org_id,rule_key,record,fingerprint,source_rev) values(p_org,key_,r,fp,v_rev);
      opened_:=opened_+1;
    elsif existing.resolved_at is not null or existing.fingerprint is distinct from fp then
      update public.operational_attention set record=r,fingerprint=fp,source_rev=v_rev,changed_at=statement_timestamp(),resolved_at=null where org_id=p_org and rule_key=key_;
      changed_:=changed_+1;
    end if;
  end loop;
  if p_complete then
    update public.operational_attention set resolved_at=statement_timestamp(),changed_at=statement_timestamp(),source_rev=v_rev
      where org_id=p_org and resolved_at is null and not exists(select 1 from jsonb_array_elements(p_records) x where x->>'id'=rule_key);
    get diagnostics resolved_=row_count;
  end if;
  insert into private.operational_evaluations(org_id,evaluated_at,source_rev) values(p_org,p_evaluated_at,v_rev)
    on conflict(org_id) do update set evaluated_at=excluded.evaluated_at,source_rev=excluded.source_rev
    where operational_evaluations.evaluated_at<excluded.evaluated_at or operational_evaluations.source_rev<>excluded.source_rev;
  if opened_+changed_+resolved_>0 then
    insert into public.audit_log(actor,actor_label,org_id,action,detail) values(p_actor,'automation',p_org,'automation.attention_changed',
      jsonb_build_object('opened',opened_,'changed',changed_,'resolved',resolved_,'sourceRevision',v_rev));
  end if;
  return jsonb_build_object('ok',true,'orgId',p_org,'sourceRevision',v_rev,'opened',opened_,'changed',changed_,'resolved',resolved_,'complete',p_complete);
end;
$$;
revoke all on function public.commit_workspace_action(uuid,uuid,integer,jsonb,text,jsonb,jsonb),public.initialize_workspace(uuid,uuid,jsonb),public.sync_operational_attention(uuid,uuid,integer,jsonb,boolean,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.commit_workspace_action(uuid,uuid,integer,jsonb,text,jsonb,jsonb),public.initialize_workspace(uuid,uuid,jsonb),public.sync_operational_attention(uuid,uuid,integer,jsonb,boolean,bigint,jsonb) to service_role;
commit;
