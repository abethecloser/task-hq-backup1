-- Shift/Check-In v1 candidate. Isolated from workspace_state/dispatch. NOT applied remotely.
-- Server timestamps are authoritative. Client-reported times remain evidence, never hours.
create table public.shift_sessions (
 id uuid primary key, org_id uuid not null references public.organizations(id), employee uuid not null references auth.users(id),
 state text not null default 'active' check(state in ('active','checkout_pending','checked_out')),
 started_at timestamptz not null default clock_timestamp(), ended_at timestamptz,
 checkout_requested_at timestamptz, focus text not null default '' check(length(focus)<=1000),
 task_id text not null default '', project_id text not null default '', eod_draft text not null default '' check(length(eod_draft)<=5000),
 review_required boolean not null default false,
 check((state='checked_out')=(ended_at is not null)), check(ended_at is null or ended_at>=started_at), unique(org_id,id)
);
create unique index shift_one_open on public.shift_sessions(org_id,employee) where state<>'checked_out';
create index shift_employee_history on public.shift_sessions(org_id,employee,started_at desc);
create table public.shift_records (
 id uuid primary key, org_id uuid not null, shift_id uuid not null, author uuid not null references auth.users(id),
 kind text not null check(kind in ('check_in','context','capture','request_checkout','eod','checkout','exception_checkout','correction','adjustment')),
 text text not null default '' check(length(text)<=5000), data jsonb not null default '{}', created_at timestamptz not null default clock_timestamp(),
 foreign key(org_id,shift_id) references public.shift_sessions(org_id,id)
);
create unique index shift_one_eod on public.shift_records(shift_id) where kind='eod';
create index shift_records_parent on public.shift_records(shift_id,created_at);
create table public.shift_media (
 id uuid primary key, org_id uuid not null, shift_id uuid not null, employee uuid not null references auth.users(id),
 path text not null unique, mime text not null, bytes bigint not null check(bytes between 1 and 52428800),
 status text not null default 'pending' check(status in ('pending','ready')), task_id text not null default '', project_id text not null default '',
 created_at timestamptz not null default clock_timestamp(), foreign key(org_id,shift_id) references public.shift_sessions(org_id,id)
);
create index shift_media_parent on public.shift_media(shift_id);
create table private.shift_receipts (
 org_id uuid not null, actor uuid not null, id uuid not null, action text not null, shift_id uuid, data jsonb not null, response jsonb not null,
 primary key(org_id,actor,id)
);
revoke all on public.shift_sessions, public.shift_records, public.shift_media from public, anon, authenticated;
revoke all on private.shift_receipts from public, anon, authenticated;
alter table public.shift_sessions enable row level security;
alter table public.shift_records enable row level security;
alter table public.shift_media enable row level security;
alter table private.shift_receipts enable row level security;
grant select on public.shift_sessions,public.shift_records,public.shift_media to authenticated;

create function private.shift_manager(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.role_in(p_org) in ('owner','admin','supervisor'),false)
$$;
create function private.shift_readable(p_org uuid,p_employee uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and ((select auth.uid())=p_employee or private.shift_manager(p_org))
$$;
revoke all on function private.shift_manager(uuid),private.shift_readable(uuid,uuid) from public,anon;
grant execute on function private.shift_manager(uuid),private.shift_readable(uuid,uuid) to authenticated;
create policy shift_read on public.shift_sessions for select to authenticated using(private.shift_readable(org_id,employee));
create policy shift_records_read on public.shift_records for select to authenticated using(exists(select 1 from public.shift_sessions s where s.id=shift_id and private.shift_readable(s.org_id,s.employee)));
create policy shift_media_read on public.shift_media for select to authenticated using(private.shift_readable(org_id,employee));

create function private.shift_json(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('employee_name',(select full_name from public.profiles where id=s.employee),'records',coalesce((select jsonb_agg(r order by r.created_at) from public.shift_records r where r.shift_id=s.id),'[]'::jsonb),
 'media',coalesce((select jsonb_agg(m order by m.created_at) from public.shift_media m where m.shift_id=s.id),'[]'::jsonb)) from public.shift_sessions s where s.id=p_id
$$;
revoke all on function private.shift_json(uuid) from public,anon,authenticated;

create function public.shift_list(p_org uuid default null,p_team boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view shifts.'; end if;
 if p_team and (p_org is null or not private.shift_manager(p_org)) then raise exception 'Team shifts require organization manager access.'; end if;
 return jsonb_build_object('server_now',clock_timestamp(),'can_manage',coalesce(private.shift_manager(p_org),false),
  'shifts',coalesce((select jsonb_agg(private.shift_json(s.id) order by s.started_at desc) from (
   select * from public.shift_sessions where (p_org is null or org_id=p_org) and (employee=auth.uid() or (p_team and private.shift_manager(org_id)))
   order by (state<>'checked_out') desc,started_at desc limit 50) s),'[]'::jsonb));
end $$;
revoke all on function public.shift_list(uuid,boolean) from public,anon;
grant execute on function public.shift_list(uuid,boolean) to authenticated;

create function private.shift_context(p_org uuid,p_employee uuid,p_task text,p_project text) returns text
language plpgsql stable security definer set search_path='' as $$
declare w jsonb; t jsonb;
begin
 if coalesce(p_task,'')='' and coalesce(p_project,'')='' then return ''; end if;
 select state into w from public.workspace_state where org_id=p_org;
 if coalesce(p_task,'')<>'' then
  select value into t from jsonb_array_elements(coalesce(w->'tasks','[]'::jsonb)) where value->>'id'=p_task;
  if t is null or (not private.shift_manager(p_org) and coalesce(t->>'owner','')<>p_employee::text and coalesce(t->>'approver','')<>p_employee::text) then raise exception 'Assigned work is not available.'; end if;
  if coalesce(p_project,'')<>'' and coalesce(t->>'projectId','')<>p_project then raise exception 'Task and job do not match.'; end if;
 end if;
 if coalesce(p_project,'')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(w->'projects','[]'::jsonb)) where value->>'id'=p_project) then raise exception 'Job/site is not available.'; end if;
 return coalesce(nullif(p_project,''),t->>'projectId','');
end $$;
revoke all on function private.shift_context(uuid,uuid,text,text) from public,anon,authenticated;

create function public.shift_command(p_org uuid,p_request uuid,p_action text,p_shift uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare original_data jsonb:=p_data; s public.shift_sessions; receipt private.shift_receipts; employee_id uuid; at_time timestamptz; body text;
 task_id text:=coalesce(p_data->>'task_id',''); project_id text:=coalesce(p_data->>'project_id','');
 media_id uuid; m public.shift_media; mime_type text; media_bytes bigint; from_time timestamptz; to_time timestamptz; result jsonb; audit_kind text;
begin
 if auth.uid() is null or p_request is null or p_org is null then raise exception 'Sign in and provide a request ID and organization.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid action data.'; end if;
 body:=btrim(coalesce(p_data->>'text',''));
 if length(body)>5000 or length(task_id)>200 or length(project_id)>200 then raise exception 'Action data is too long.'; end if;
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
 at_time:=clock_timestamp();
 if p_action='check_in' then
  if exists(select 1 from public.shift_sessions where org_id=p_org and employee=employee_id and state<>'checked_out') then raise exception 'You already have an open shift. Refresh to resume it.'; end if;
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
revoke all on function public.shift_command(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.shift_command(uuid,uuid,text,uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('quest-shift-media','quest-shift-media',false,52428800,
 array['image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','video/webm','video/mp4','video/quicktime']) on conflict(id) do nothing;
do $$ begin if exists(select 1 from storage.buckets where id='quest-shift-media' and public) then raise exception 'Shift media bucket must be private.'; end if; end $$;
create policy shift_media_upload on storage.objects for insert to authenticated with check(bucket_id='quest-shift-media' and exists(
 select 1 from public.shift_media m where m.path=name and m.employee=auth.uid() and m.status='pending'));
create policy shift_media_download on storage.objects for select to authenticated using(bucket_id='quest-shift-media' and exists(
 select 1 from public.shift_media m where m.path=name and private.shift_readable(m.org_id,m.employee)));
-- No overwrite/delete policy. Pending reservations survive interrupted uploads; retries use the same path.
