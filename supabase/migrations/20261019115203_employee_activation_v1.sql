-- Isolated activation candidate. Requires team_staging; apply this file only after review.
-- Auth creation and membership/token consumption share the Auth admin transaction.
-- Preserve legacy rows verbatim. Unbound legacy codes cannot be redeemed by this flow.
alter table public.team_activation_codes
 add column employee_id uuid references public.staged_contacts(id),
 add column org_id uuid references public.organizations(id),
 add column role public.org_role check(role <> 'owner'),
 add column work_role text,
 add column employee_version timestamptz,
 add column issued_by uuid references auth.users(id),
 add column revoked_at timestamptz,
 add column claim_id uuid unique,
 add column claim_email text,
 add constraint activation_bound_fields check(employee_id is null or (org_id is not null and role is not null and work_role is not null and employee_version is not null and issued_by is not null and created_at is not null and code_hash ~ '^[0-9a-f]{64}$')),
 add constraint activation_dates check(expires_at > created_at),
 add constraint activation_redemption check((redeemed_at is null) = (redeemed_by is null));

create unique index employee_activation_one_open on public.team_activation_codes(employee_id)
 where revoked_at is null and redeemed_at is null;
create table public.employee_auth_links (
 employee_id uuid primary key references public.staged_contacts(id),
 org_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id), activation_id uuid not null unique references public.team_activation_codes(id),
 activated_at timestamptz not null default now(), unique(org_id,user_id)
);
create table private.activation_limits(bucket text primary key, window_start timestamptz not null, attempts integer not null);
alter table public.team_activation_codes enable row level security;
alter table public.employee_auth_links enable row level security;
revoke all on public.team_activation_codes, public.employee_auth_links, private.activation_limits from public, anon, authenticated, service_role;

create function public.employee_activation_admin(p_org uuid, p_action text default 'list', p_employee uuid default null, p_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.staged_contacts; a public.team_activation_codes;
begin
 if not private.is_org_admin(p_org) then raise exception 'Organization administrator required.'; end if;
 if p_action <> 'list' then
  select * into c from public.staged_contacts where id=p_employee and org_id=p_org and archived_at is null for update;
  if not found then raise exception 'Employee unavailable.'; end if;
  if p_action='generate' then
   if not c.affiliation_confirmed then raise exception 'Confirm employee affiliation first.'; end if;
   if c.provisional_role='admin' and private.role_in(p_org)<>'owner' then raise exception 'Only an owner can grant admin.'; end if;
   if exists(select 1 from public.employee_auth_links where employee_id=c.id) or exists(
    select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.org_id=p_org and lower(u.email)=c.email
   ) then raise exception 'Employee already activated.'; end if;
   update public.team_activation_codes set revoked_at=now() where employee_id=c.id and revoked_at is null and redeemed_at is null;
   insert into public.team_activation_codes(employee_name,employee_ref,employee_id,org_id,code_hash,role,work_role,employee_version,issued_by,expires_at)
   values(c.full_name,c.id::text,c.id,p_org,p_hash,c.provisional_role,c.provisional_work_role,c.updated_at,auth.uid(),now()+interval '24 hours') returning * into a;
   perform private.audit(p_org,'activation.generated',jsonb_build_object('employee',c.id,'activation',a.id));
   return jsonb_build_object('id',a.id,'expires_at',a.expires_at);
  elsif p_action='revoke' then
   update public.team_activation_codes set revoked_at=now() where employee_id=c.id and redeemed_at is null and revoked_at is null;
   perform private.audit(p_org,'activation.revoked',jsonb_build_object('employee',c.id));
  else raise exception 'Unknown activation action.'; end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',contact.id,'name',contact.full_name,'role',contact.provisional_role,
  'affiliation_confirmed',contact.affiliation_confirmed,'expires_at',latest.expires_at,
  'status',case when l.user_id is not null or m.user_id is not null then 'active' when latest.revoked_at is not null then 'revoked'
   when latest.expires_at<=now() then 'expired' when latest.id is not null then 'pending' else 'not-issued' end) order by contact.full_name)
  from public.staged_contacts contact
  left join public.employee_auth_links l on l.employee_id=contact.id
  left join lateral(select mm.user_id from public.memberships mm join auth.users u on u.id=mm.user_id where mm.org_id=p_org and lower(u.email)=contact.email limit 1)m on true
  left join lateral(select aa.* from public.team_activation_codes aa where aa.employee_id=contact.id order by aa.created_at desc limit 1)latest on true
  where contact.org_id=p_org and contact.archived_at is null),'[]'::jsonb);
end $$;
revoke all on function public.employee_activation_admin(uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.employee_activation_admin(uuid,text,uuid,text) to authenticated;

-- Called only by the dedicated server endpoint. Persist rejected attempts too.
create function public.employee_activation_limit(p_bucket text,p_max integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.activation_limits values(p_bucket,now(),1)
 on conflict(bucket) do update set attempts=case when private.activation_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else private.activation_limits.attempts+1 end,
 window_start=case when private.activation_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else private.activation_limits.window_start end returning attempts into n;
 -- Bounded retention; never stores codes, credentials, or addresses.
 delete from private.activation_limits where window_start<now()-interval '1 day';
 return n<=p_max;
end $$;

create function public.employee_activation_lookup(p_hash text,p_email text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.team_activation_codes; c public.staged_contacts; v_claim uuid;
begin
 select * into a from public.team_activation_codes where code_hash=p_hash and employee_id is not null for update;
 if not found or a.revoked_at is not null or a.expires_at<=now() then return null; end if;
 if a.redeemed_at is not null then
  if p_email is not null and a.claim_email=p_email then return jsonb_build_object('activated',true); end if;
  return null;
 end if;
 select * into c from public.staged_contacts where id=a.employee_id;
 if c.archived_at is not null or not c.affiliation_confirmed or c.updated_at<>a.employee_version
  or not exists(select 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role in ('owner','admin'))
  or (a.role='admin' and not exists(select 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role='owner')) then return null; end if;
 if p_email is not null then
  if a.claim_email is not null and a.claim_email<>p_email then return null; end if;
  v_claim:=coalesce(a.claim_id,gen_random_uuid());
  update public.team_activation_codes set claim_id=v_claim,claim_email=p_email where id=a.id;
 end if;
 return jsonb_build_object('employee_id',c.id,'name',c.full_name,'company',(select name from public.organizations where id=c.org_id),'claim',v_claim);
end $$;

-- Server-controlled app_metadata supplies the claim. Clients cannot set app_metadata.
-- GoTrue sets app_metadata then confirms in its creation transaction. Raising rolls back all writes.
create function private.activate_employee_on_auth_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.team_activation_codes; c public.staged_contacts; claim text:=new.raw_app_meta_data->>'quest_employee_activation';
begin
 if claim is null or new.email_confirmed_at is null then return new; end if;
 select * into a from public.team_activation_codes where claim_id=claim::uuid;
 if not found then raise exception 'Activation unavailable.'; end if;
 if a.redeemed_by=new.id then return new; end if;
 select * into c from public.staged_contacts where id=a.employee_id for update;
 select * into a from public.team_activation_codes where claim_id=claim::uuid for update;
 if not found or a.revoked_at is not null or a.redeemed_at is not null or a.expires_at<=now()
  or a.claim_email<>lower(new.email) or new.email_confirmed_at is null then raise exception 'Activation unavailable.'; end if;
 perform 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role in ('owner','admin') for share;
 if not found then raise exception 'Activation authorization changed.'; end if;
 if c.archived_at is not null or not c.affiliation_confirmed or c.updated_at<>a.employee_version
  or c.org_id<>a.org_id or c.provisional_role<>a.role or c.provisional_work_role<>a.work_role
  or not exists(select 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role in ('owner','admin'))
  or (a.role='admin' and not exists(select 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role='owner'))
 then raise exception 'Activation authorization changed.'; end if;
 insert into public.employee_auth_links(employee_id,org_id,user_id,activation_id) values(c.id,c.org_id,new.id,a.id);
 insert into public.memberships(org_id,user_id,role,work_role) values(c.org_id,new.id,a.role,a.work_role);
 update public.staged_contacts set email=lower(new.email),updated_at=now() where id=c.id;
 update public.team_activation_codes set redeemed_at=now(),redeemed_by=new.id where id=a.id;
 perform private.audit(c.org_id,'activation.completed',jsonb_build_object('employee',c.id,'user',new.id,'activation',a.id));
 return new;
end $$;
revoke all on function private.activate_employee_on_auth_insert() from public,anon,authenticated,service_role;
create trigger quest_employee_activation after insert or update of raw_app_meta_data,email_confirmed_at on auth.users for each row execute function private.activate_employee_on_auth_insert();
revoke all on function public.employee_activation_limit(text,integer,integer),public.employee_activation_lookup(text,text) from public,anon,authenticated;
grant execute on function public.employee_activation_limit(text,integer,integer),public.employee_activation_lookup(text,text) to service_role;
