-- Additive, disabled until an explicitly approved mapping is inserted by an operator.
-- No website, FormSubmit, phone, account, or organization changes.
begin;
create table private.intake_sources (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  org_id uuid not null references public.organizations(id),
  channel text not null check (channel in ('website', 'ai_receptionist', 'business_email', 'manual')),
  source_url text not null check (source_url ~ '^https://'),
  -- Member removal must remain possible; acceptance rechecks membership.
  follow_up_owner uuid references auth.users(id) on delete set null,
  approved_by uuid not null references auth.users(id),
  approval_note text not null check (length(btrim(approval_note)) between 10 and 500),
  approved_at timestamptz not null default now(),
  enabled boolean not null default false
);
alter table private.intake_sources enable row level security;
revoke all on private.intake_sources from public, anon, authenticated;

-- One durable success event per source event, suitable for Daily Signal reads.
create table public.intake_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  source_id text not null references private.intake_sources(id),
  external_id text not null,
  channel text not null check(channel in ('website','ai_receptionist','business_email','manual')),
  source_url text not null check(source_url ~ '^https://'),
  event_kind text not null default 'intake.accepted' check (event_kind = 'intake.accepted'),
  envelope jsonb not null,
  lead_id uuid not null,
  task_id uuid not null,
  actor uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index intake_events_signal_idx on public.intake_events(org_id, accepted_at, id);
alter table public.intake_events enable row level security;
revoke all on public.intake_events from public, anon, authenticated;
grant select on public.intake_events to authenticated, service_role;
create policy intake_events_member_read on public.intake_events for select to authenticated
  using (private.is_member(org_id));

-- Narrow security-definer entry point: explicit JWT user + membership checks,
-- private source mapping, no client tenant/owner overrides, one transaction.
create function public.receive_intake(p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  s private.intake_sources%rowtype;
  old public.intake_events%rowtype;
  w public.workspace_state%rowtype;
  c jsonb; q jsonb; e jsonb; receipt jsonb;
  name_ text; email_ text; phone_ text; need_ text; address_ text;
  received_ timestamptz; external_ text;
  lead_ uuid := gen_random_uuid(); task_ uuid := gen_random_uuid(); event_ uuid := gen_random_uuid();
  at_ bigint := floor(extract(epoch from statement_timestamp()) * 1000);
  arrived_ bigint; next_ jsonb; role_ public.org_role;
begin
  if v_actor is null then raise exception using errcode='42501', message='INTAKE_UNAUTHORIZED'; end if;
  if jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text) > 16384
    or p_envelope->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_envelope->'sourceId') is distinct from 'string'
    or jsonb_typeof(p_envelope->'externalId') is distinct from 'string'
    or jsonb_typeof(p_envelope->'receivedAt') is distinct from 'string'
    or jsonb_typeof(p_envelope->'contact') is distinct from 'object'
    or jsonb_typeof(p_envelope->'inquiry') is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_envelope) k where k not in ('version','sourceId','externalId','receivedAt','contact','inquiry'))
  then raise exception using errcode='22023', message='INTAKE_INVALID'; end if;
  c := p_envelope->'contact'; q := p_envelope->'inquiry';
  if exists (select 1 from jsonb_object_keys(c) k where k not in ('name','email','phone'))
    or exists (select 1 from jsonb_object_keys(q) k where k not in ('need','address'))
    or exists (select 1 from jsonb_each(c) kv where jsonb_typeof(kv.value) <> 'string')
    or exists (select 1 from jsonb_each(q) kv where jsonb_typeof(kv.value) <> 'string')
  then raise exception using errcode='22023', message='INTAKE_INVALID'; end if;
  name_ := btrim(c->>'name'); email_ := lower(btrim(coalesce(c->>'email','')));
  phone_ := regexp_replace(coalesce(c->>'phone',''), '[[:space:]().-]', '', 'g');
  need_ := btrim(q->>'need'); address_ := btrim(coalesce(q->>'address',''));
  external_ := btrim(p_envelope->>'externalId');
  if coalesce(length(name_),0) not between 1 and 120 or coalesce(length(need_),0) not between 3 and 2000
    or length(address_) > 500 or length(email_) > 254
    or (email_ <> '' and email_ !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (phone_ <> '' and phone_ !~ '^\+?[0-9]{7,15}$')
    or (email_ = '' and phone_ = '') or length(external_) not between 1 and 200
    or external_ ~ '[[:cntrl:]]' or name_ ~ '[[:cntrl:]]'
    or p_envelope->>'sourceId' !~ '^[a-z0-9][a-z0-9._-]{2,79}$'
    or p_envelope->>'receivedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$'
  then raise exception using errcode='22023', message='INTAKE_INVALID'; end if;
  begin received_ := (p_envelope->>'receivedAt')::timestamptz;
  exception when others then raise exception using errcode='22023', message='INTAKE_INVALID'; end;
  if received_ > statement_timestamp() + interval '5 minutes' then
    raise exception using errcode='22023', message='INTAKE_INVALID'; end if;
  arrived_ := floor(extract(epoch from received_) * 1000);
  e := jsonb_build_object('version',1,'sourceId',p_envelope->>'sourceId','externalId',external_,
    'receivedAt',arrived_, 'contact',jsonb_build_object('name',name_,'email',email_,'phone',phone_),
    'inquiry',jsonb_build_object('need',need_,'address',address_));
  -- Serialize same-source deliveries, including retries racing their first commit.
  select * into s from private.intake_sources where id = p_envelope->>'sourceId' for update;
  if not found then raise exception using errcode='42501', message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  -- This adapter is for Construction only. Roofing is never an eligible target.
  if not exists (select 1 from public.organizations where id=s.org_id
    and preset='general' and slug <> 'quest-roofing') then
    raise exception using errcode='42501', message='INTAKE_MAPPING_INVALID'; end if;
  select role into role_ from public.memberships where org_id=s.org_id and user_id=v_actor for share;
  if role_ is null or role_ = 'reviewer' or not exists (
    select 1 from public.memberships where org_id=s.org_id and user_id=v_actor and work_role <> 'reviewer')
  then raise exception using errcode='42501', message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  select * into old from public.intake_events where source_id=s.id and external_id=external_;
  if found then
    if old.org_id <> s.org_id then raise exception using errcode='42501', message='INTAKE_MAPPING_INVALID'; end if;
    if old.envelope <> e then raise exception using errcode='23505', message='INTAKE_KEY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'status','duplicate','receiptId',old.id,'orgId',old.org_id,
      'leadId',old.lead_id,'taskId',old.task_id,'acceptedAt',old.accepted_at);
  end if;
  if not s.enabled then raise exception using errcode='42501', message='INTAKE_SOURCE_UNAVAILABLE'; end if;
  -- Approval must come from the mapped organization's owner, never a name guess.
  perform 1 from public.memberships where org_id=s.org_id and user_id=s.approved_by and role='owner' for share;
  if not found then raise exception using errcode='42501', message='INTAKE_MAPPING_INVALID'; end if;
  perform 1 from public.memberships where org_id=s.org_id and user_id=s.follow_up_owner
    and role <> 'reviewer' and work_role <> 'reviewer' for share;
  if not found then raise exception using errcode='42501', message='INTAKE_OWNER_UNAVAILABLE'; end if;
  select * into w from public.workspace_state where org_id=s.org_id for update;
  if not found or jsonb_typeof(w.state->'tasks') is distinct from 'array'
    or jsonb_typeof(w.state->'leads') is distinct from 'array' or jsonb_typeof(w.state->'events') is distinct from 'array'
  then raise exception using errcode='55000', message='INTAKE_WORKSPACE_UNAVAILABLE'; end if;
  next_ := w.state || jsonb_build_object(
    'leads', (w.state->'leads') || jsonb_build_array(jsonb_build_object(
      'id',lead_,'name',name_,'email',email_,'phone',phone_,'address',address_,'need',need_,
      'source',s.id,'arrivedAt',arrived_,'assignee',s.follow_up_owner,'assignedAt',at_,
      'firstResponseAt',null,'attempts','[]'::jsonb,'stage','new','blocker','',
      'followUpTaskId',task_,'handoffTaskId','','escalatedTo','','simulated',false,'updatedAt',at_,
      'intake',jsonb_build_object('version',1,'sourceId',s.id,'externalId',external_,'channel',s.channel,'sourceUrl',s.source_url))),
    'tasks', (w.state->'tasks') || jsonb_build_array(jsonb_build_object(
      'id',task_,'title','Follow up: ' || name_,'description',need_,'projectId','general',
      'owner',s.follow_up_owner,'nextOwner','','decisionOwner','','approver','','waitingOn','',
      'watchers','[]'::jsonb,'status','ready','priority','normal',
      'due',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD'),
      'nextAction','Review inquiry and make the first contact; log the result.',
      'dependsOn','[]'::jsonb,'blocker',null,'leadId',lead_,'ultra',false,
      'createdBy',v_actor,'createdAt',at_,'updatedAt',at_,'lastActivityAt',at_,'completedAt',null)),
    'events', (select jsonb_agg(history.value order by history.position) from jsonb_array_elements(
      jsonb_build_array(jsonb_build_object('id',event_,'at',at_,'actor',v_actor,'kind','lead',
      'text','Intake accepted from ' || s.id || '; follow-up assigned.','taskId',task_,'leadId',lead_)) || (w.state->'events')) with ordinality history(value,position) where history.position<=400),
    'rev',w.rev+1,'updatedAt',at_,'writer','intake');
  update public.workspace_state set state=next_,rev=w.rev+1,updated_at=statement_timestamp(),updated_by=v_actor where org_id=s.org_id;
  insert into public.intake_events (org_id,source_id,external_id,channel,source_url,envelope,lead_id,task_id,actor)
    values (s.org_id,s.id,external_,s.channel,s.source_url,e,lead_,task_,v_actor)
    returning jsonb_build_object('ok',true,'status','accepted','receiptId',id,'orgId',org_id,
      'leadId',lead_id,'taskId',task_id,'acceptedAt',accepted_at) into receipt;
  perform private.audit(s.org_id,'intake.accepted',jsonb_build_object('receiptId',receipt->>'receiptId','sourceId',s.id,'leadId',lead_,'taskId',task_));
  return receipt;
end;
$$;
revoke all on function public.receive_intake(jsonb) from public, anon, authenticated;
grant execute on function public.receive_intake(jsonb) to authenticated;
commit;
