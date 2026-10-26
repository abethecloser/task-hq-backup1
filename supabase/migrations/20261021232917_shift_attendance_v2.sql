-- Shift attendance v2 (2026-10-21): forgotten checkouts, late EOD, configurable shift length.
-- Builds on shift_activity_v1; its tables were empty when this was written.
-- A shift still open past the organization's maximum length is closed by the system as
-- 'auto_closed': ended_at stays NULL (the actual end is unknown, never invented) and
-- closed_at records when the system closed it, with an 'auto_close' record (author NULL,
-- data.system = true) so system closure is never mistaken for an employee checkout.
-- The employee's next check-in waits for a late EOD (explanation + work summary) on that shift.
-- Limits are elapsed hours, not clock boundaries, so overnight shifts need no time zone.
-- Rollback (tables are append-only history; only do this before real shifts exist):
--   drop function public.shift_set_policy(uuid, integer); drop function private.shift_sweep(uuid, uuid);
--   drop function private.shift_max_hours(uuid); drop table private.shift_policy;
--   then re-run shift_list and shift_command from 20261019113920_shift_activity_v1.sql and
--   restore its state/kind checks, author not null and the shift_one_open index.

create table private.shift_policy (
 org_id uuid primary key references public.organizations(id) on delete cascade,
 max_shift_hours integer not null default 16 check (max_shift_hours between 4 and 24),
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
alter table private.shift_policy enable row level security;
revoke all on private.shift_policy from public, anon, authenticated;

create function private.shift_max_hours(p_org uuid) returns integer language sql stable security definer set search_path='' as $$
 select coalesce((select max_shift_hours from private.shift_policy where org_id = p_org), 16)
$$;
revoke all on function private.shift_max_hours(uuid) from public, anon, authenticated;

do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid = 'public.shift_sessions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%checkout_pending%' loop
  execute format('alter table public.shift_sessions drop constraint %I', c.conname);
 end loop;
 for c in select conname from pg_constraint where conrelid = 'public.shift_records'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%exception_checkout%' loop
  execute format('alter table public.shift_records drop constraint %I', c.conname);
 end loop;
end $$;
alter table public.shift_sessions add column closed_at timestamptz;
alter table public.shift_sessions add constraint shift_sessions_state_check check (state in ('active','checkout_pending','checked_out','auto_closed'));
-- Kept after a later manager adjustment, as history of the system closure.
alter table public.shift_sessions add constraint shift_sessions_auto_closed_at check (state <> 'auto_closed' or closed_at is not null);
drop index public.shift_one_open;
create unique index shift_one_open on public.shift_sessions(org_id, employee) where state in ('active','checkout_pending');

alter table public.shift_records alter column author drop not null;
alter table public.shift_records add constraint shift_records_kind_check check (kind in ('check_in','context','capture','request_checkout','eod','checkout','exception_checkout','correction','adjustment','auto_close','late_eod'));
alter table public.shift_records add constraint shift_records_system_author check (author is not null or kind = 'auto_close');
create unique index shift_one_late_eod on public.shift_records(shift_id) where kind = 'late_eod';
create unique index shift_one_auto_close on public.shift_records(shift_id) where kind = 'auto_close';

-- Close shifts left open past the limit. p_employee null = everyone in the organization.
create function private.shift_sweep(p_org uuid, p_employee uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.shift_sessions; at_time timestamptz := clock_timestamp(); hours integer := private.shift_max_hours(p_org);
begin
 for s in select * from public.shift_sessions where org_id = p_org and (p_employee is null or employee = p_employee)
   and state in ('active','checkout_pending') and started_at < at_time - make_interval(hours => hours) for update loop
  update public.shift_sessions set state = 'auto_closed', closed_at = at_time, review_required = true where id = s.id;
  insert into public.shift_records(id, org_id, shift_id, author, kind, text, data, created_at)
  values (gen_random_uuid(), s.org_id, s.id, null, 'auto_close',
    'Closed automatically: no checkout within ' || hours || ' hours. Actual end time unknown.',
    jsonb_build_object('system', true, 'max_shift_hours', hours, 'state_before', s.state), at_time);
 end loop;
end $$;
revoke all on function private.shift_sweep(uuid, uuid) from public, anon, authenticated;

create function public.shift_set_policy(p_org uuid, p_max_shift_hours integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_org_admin(p_org) then raise exception 'Only owners and admins change shift settings.'; end if;
 if p_max_shift_hours is null or p_max_shift_hours not between 4 and 24 then raise exception 'Choose a maximum shift of 4 to 24 hours.'; end if;
 insert into private.shift_policy(org_id, max_shift_hours, updated_by, updated_at) values (p_org, p_max_shift_hours, auth.uid(), now())
 on conflict (org_id) do update set max_shift_hours = excluded.max_shift_hours, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
 perform private.audit(p_org, 'shift.policy', jsonb_build_object('max_shift_hours', p_max_shift_hours));
 return jsonb_build_object('max_shift_hours', p_max_shift_hours);
end $$;
revoke all on function public.shift_set_policy(uuid, integer) from public, anon;
grant execute on function public.shift_set_policy(uuid, integer) to authenticated;

-- Now volatile: listing your shifts (or the team's, for managers) applies the stale-shift rule first.
create or replace function public.shift_list(p_org uuid default null,p_team boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view shifts.'; end if;
 if p_team and (p_org is null or not private.shift_manager(p_org)) then raise exception 'Team shifts require organization manager access.'; end if;
 if p_org is not null then perform private.shift_sweep(p_org, case when p_team then null else auth.uid() end); end if;
 return jsonb_build_object('server_now',clock_timestamp(),'can_manage',coalesce(private.shift_manager(p_org),false),
  'max_shift_hours', case when p_org is null then null else private.shift_max_hours(p_org) end,
  'late_eod_due', case when p_org is null then null else (select to_jsonb(x.id) from public.shift_sessions x where x.org_id=p_org and x.employee=auth.uid() and x.state='auto_closed'
     and not exists(select 1 from public.shift_records r where r.shift_id=x.id and r.kind='late_eod') order by x.started_at desc limit 1) end,
  'shifts',coalesce((select jsonb_agg(private.shift_json(s.id) order by s.started_at desc) from (
   select * from public.shift_sessions where (p_org is null or org_id=p_org) and (employee=auth.uid() or (p_team and private.shift_manager(org_id)))
   order by (state in ('active','checkout_pending')) desc,started_at desc limit 50) s),'[]'::jsonb));
end $$;

create or replace function public.shift_command(p_org uuid,p_request uuid,p_action text,p_shift uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare original_data jsonb:=p_data; s public.shift_sessions; receipt private.shift_receipts; employee_id uuid; at_time timestamptz; body text;
 task_id text:=coalesce(p_data->>'task_id',''); project_id text:=coalesce(p_data->>'project_id','');
 media_id uuid; m public.shift_media; mime_type text; media_bytes bigint; from_time timestamptz; to_time timestamptz; result jsonb; audit_kind text;
begin
 if auth.uid() is null or p_request is null or p_org is null then raise exception 'Sign in and provide a request ID and organization.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid action data.'; end if;
 body:=btrim(coalesce(p_data->>'text',''));
 if length(body)>5000 or length(task_id)>200 or length(project_id)>200 or length(coalesce(p_data->>'summary',''))>5000 then raise exception 'Action data is too long.'; end if;
 if p_action='check_in' then
  if not exists(select 1 from public.memberships where org_id=p_org and user_id=auth.uid() and role<>'reviewer' and work_role<>'reviewer') then raise exception 'Only active operational members can check in.'; end if;
  employee_id:=auth.uid();
 else
  select * into s from public.shift_sessions where id=p_shift and org_id=p_org;
  if not found or not private.shift_readable(p_org,s.employee) then raise exception 'Shift not available.'; end if;
  if s.employee<>auth.uid() and not (p_action='adjust' and private.shift_manager(p_org)) then raise exception 'Only the employee can perform this action.'; end if;
  employee_id:=s.employee;
 end if;
 -- Serialize every operation for this employee, including check-in and manager corrections.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||employee_id::text,0));
 select * into receipt from private.shift_receipts where org_id=p_org and actor=auth.uid() and id=p_request;
 if found then
  if receipt.action is distinct from p_action or receipt.shift_id is distinct from p_shift or receipt.data is distinct from p_data then raise exception 'Request ID already belongs to another action.'; end if;
  return receipt.response;
 end if;
 perform private.shift_sweep(p_org, employee_id);
 at_time:=clock_timestamp();
 if p_action='check_in' then
  if exists(select 1 from public.shift_sessions where org_id=p_org and employee=employee_id and state in ('active','checkout_pending')) then raise exception 'You already have an open shift. Refresh to resume it.'; end if;
  if exists(select 1 from public.shift_sessions x where x.org_id=p_org and x.employee=employee_id and x.state='auto_closed'
    and not exists(select 1 from public.shift_records r where r.shift_id=x.id and r.kind='late_eod')) then raise exception 'Your last shift was closed automatically. Add a late EOD for it first.'; end if;
  if length(coalesce(p_data->>'focus',''))>1000 then raise exception 'Focus is too long.'; end if;
  project_id:=private.shift_context(p_org,employee_id,task_id,project_id);
  if btrim(coalesce(p_data->>'focus',''))='' and task_id='' and project_id='' then raise exception 'Add a focus or select assigned work or a job.'; end if;
  insert into public.shift_sessions(id,org_id,employee,started_at,focus,task_id,project_id)
   values(p_request,p_org,employee_id,at_time,btrim(coalesce(p_data->>'focus','')),task_id,project_id) returning * into s;
  if coalesce(p_data->>'client_observed_at','')<>'' and abs(extract(epoch from (at_time-(p_data->>'client_observed_at')::timestamptz)))>300 then update public.shift_sessions set review_required=true where id=s.id; end if;
  audit_kind:='check_in'; body:=s.focus;
 else
  select * into s from public.shift_sessions where id=p_shift for update;
  if s.state='checked_out' and p_action not in ('correction','adjust','finish_media','capture','reserve_media') then raise exception 'Shift is checked out. Use the correction process.'; end if;
  if s.state='auto_closed' and p_action not in ('late_eod','correction','adjust','finish_media','capture','reserve_media') then raise exception 'This shift was closed automatically. Add a late EOD or request a correction.'; end if;
  case p_action
   when 'context' then
    project_id:=private.shift_context(p_org,employee_id,task_id,project_id);
    update public.shift_sessions set task_id=shift_command.task_id, project_id=shift_command.project_id where id=s.id;
    audit_kind:='context'; body:='Active work context changed.';
   when 'capture' then
    project_id:=private.shift_context(p_org,employee_id,task_id,project_id);
    if body='' and coalesce(p_data->>'media_id','')='' then raise exception 'Add a note or attachment.'; end if;
    if coalesce(p_data->>'media_id','')<>'' and not exists(select 1 from public.shift_media where id=(p_data->>'media_id')::uuid and shift_id=s.id and status='ready') then raise exception 'Attachment upload is not confirmed.'; end if;
    audit_kind:='capture';
   when 'request_checkout' then
    update public.shift_sessions set state='checkout_pending',checkout_requested_at=coalesce(checkout_requested_at,at_time) where id=s.id;
    audit_kind:='request_checkout'; body:='Checkout requested.';
   when 'draft_eod' then update public.shift_sessions set eod_draft=body where id=s.id;
   when 'submit_eod' then
    if s.state<>'checkout_pending' then raise exception 'Request checkout before submitting EOD.'; end if;
    if exists(select 1 from public.shift_records where shift_id=s.id and kind='eod') then raise exception 'EOD is already submitted. Use a correction for changes.'; end if;
    if body='' and coalesce(p_data->>'media_id','')='' then raise exception 'Add an EOD note or uploaded voice recording.'; end if;
    if coalesce(p_data->>'media_id','')<>'' and not exists(select 1 from public.shift_media where id=(p_data->>'media_id')::uuid and shift_id=s.id and status='ready' and mime like 'audio/%') then raise exception 'EOD voice upload is not confirmed.'; end if;
    update public.shift_sessions set eod_draft='' where id=s.id; audit_kind:='eod';
   when 'checkout' then
    if s.state<>'checkout_pending' or not exists(select 1 from public.shift_records where shift_id=s.id and kind='eod') then raise exception 'Submit EOD successfully before normal checkout.'; end if;
    update public.shift_sessions set state='checked_out',ended_at=at_time where id=s.id; audit_kind:='checkout'; body:='Checkout confirmed.';
   when 'exception_checkout' then
    if body='' then raise exception 'Explain why normal checkout is not possible.'; end if;
    update public.shift_sessions set state='checked_out',ended_at=at_time,review_required=true where id=s.id; audit_kind:='exception_checkout';
   when 'late_eod' then
    if s.state<>'auto_closed' then raise exception 'A late EOD is only for a shift that was closed automatically.'; end if;
    if exists(select 1 from public.shift_records where shift_id=s.id and kind='late_eod') then raise exception 'The late EOD is already recorded. Use a correction for changes.'; end if;
    if body='' or btrim(coalesce(p_data->>'summary',''))='' then raise exception 'Say why checkout was missed and summarize the work done.'; end if;
    audit_kind:='late_eod';
   when 'correction' then
    if body='' then raise exception 'Explain the requested correction.'; end if;
    update public.shift_sessions set review_required=true where id=s.id; audit_kind:='correction';
   when 'adjust' then
    if not private.shift_manager(p_org) then raise exception 'Only organization managers can adjust timestamps.'; end if;
    from_time:=(p_data->>'started_at')::timestamptz; to_time:=(p_data->>'ended_at')::timestamptz;
    if body='' or from_time is null or to_time is null or not isfinite(from_time) or not isfinite(to_time) or to_time<from_time or to_time>at_time then raise exception 'Supply valid past timestamps and a reason.'; end if;
    if exists(select 1 from public.shift_sessions where org_id=p_org and employee=employee_id and id<>s.id and from_time<coalesce(ended_at,'infinity'::timestamptz) and to_time>started_at) then raise exception 'Adjustment overlaps another shift.'; end if;
    p_data:=p_data||jsonb_build_object('before',jsonb_build_object('started_at',s.started_at,'ended_at',s.ended_at,'state',s.state));
    update public.shift_sessions set started_at=from_time,ended_at=to_time,state='checked_out',review_required=false where id=s.id; audit_kind:='adjustment';
   when 'reserve_media' then
    project_id:=private.shift_context(p_org,employee_id,task_id,project_id);
    media_id:=(p_data->>'media_id')::uuid; mime_type:=lower(split_part(p_data->>'mime',';',1)); media_bytes:=(p_data->>'bytes')::bigint;
    if media_id is null or mime_type is null or media_bytes is null or mime_type not in ('image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','video/webm','video/mp4','video/quicktime') or media_bytes not between 1 and 52428800 then raise exception 'Unsupported media.'; end if;
    insert into public.shift_media(id,org_id,shift_id,employee,path,mime,bytes,task_id,project_id)
     values(media_id,p_org,s.id,employee_id,p_org::text||'/'||employee_id::text||'/'||s.id::text||'/'||media_id::text,mime_type,media_bytes,task_id,project_id);
   when 'finish_media' then
    select * into m from public.shift_media where id=(p_data->>'media_id')::uuid and shift_id=s.id;
    if not found then raise exception 'Media reservation not found.'; end if;
    if not exists(select 1 from storage.objects where bucket_id='quest-shift-media' and name=m.path and (metadata->>'size')::bigint=m.bytes and lower(split_part(metadata->>'mimetype',';',1))=m.mime) then raise exception 'Upload bytes and type are not confirmed. Retry upload.'; end if;
    update public.shift_media set status='ready' where id=m.id;
   else raise exception 'Unknown shift action.';
  end case;
 end if;
 if audit_kind is not null then
  insert into public.shift_records(id,org_id,shift_id,author,kind,text,data,created_at) values(p_request,p_org,s.id,auth.uid(),audit_kind,body,p_data,at_time);
 end if;
 result:=private.shift_json(s.id);
 -- Keep the original payload (including before adjustments) for exact request replay checks.
 insert into private.shift_receipts(org_id,actor,id,action,shift_id,data,response)
 values(p_org,auth.uid(),p_request,p_action,p_shift,original_data,result);
 return result;
end $$;
