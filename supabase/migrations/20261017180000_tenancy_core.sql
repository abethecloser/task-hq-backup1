-- Task-HQ multi-tenant core.
-- Two authority levels:
--   PLATFORM      private.platform_admins (not exposed through the API). Platform admins
--                 administer Task-HQ itself; they get NO access to an organization's data
--                 unless that organization's owner grants time-limited, audited support access.
--   ORGANIZATION  public.memberships (owner, admin, supervisor, member, reviewer), tenant-scoped.
-- Clients never write tenant tables directly: every change goes through security-definer
-- functions (below) or the `dispatch` Edge Function, and is audited.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.org_role as enum ('owner', 'admin', 'supervisor', 'member', 'reviewer');

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  preset text not null default 'general' check (preset in ('roofing', 'general')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or length(full_name) <= 120),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null,
  work_role text not null check (work_role in ('manager', 'coordinator', 'field', 'sales', 'estimator', 'reviewer')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role public.org_role not null,
  work_role text not null check (work_role in ('manager', 'coordinator', 'field', 'sales', 'estimator', 'reviewer')),
  invited_by uuid references auth.users (id) on delete set null,
  invited_by_label text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create unique index invitations_one_open_per_email on public.invitations (org_id, email) where accepted_at is null and revoked_at is null;

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null default '' check (length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  granted_role public.org_role,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index access_requests_one_pending on public.access_requests (org_id, user_id) where status = 'pending';

-- Shared task data per organization. Written only by the `dispatch` Edge Function
-- (service role), which runs the Task-HQ engine with the JWT-verified actor.
create table public.workspace_state (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  state jsonb not null,
  rev integer not null default 1 check (rev > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_label text not null default '',
  org_id uuid references public.organizations (id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index audit_log_org_idx on public.audit_log (org_id, at desc);

create table private.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null
);

create table private.support_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  granted_by uuid not null references auth.users (id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
revoke all on all tables in schema private from public, anon, authenticated;

-- ── Helpers (security definer; stable; empty search_path) ──────────────────

create function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.platform_admins where user_id = (select auth.uid()));
$$;

create function private.role_in(p_org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select role from public.memberships where org_id = p_org and user_id = (select auth.uid());
$$;

create function private.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = (select auth.uid()));
$$;

create function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.role_in(p_org) in ('owner', 'admin'), false);
$$;

-- Platform admins see an organization's data only during an owner-granted support window.
create function private.has_support_access(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() and exists (
    select 1 from private.support_grants g
    where g.org_id = p_org and g.revoked_at is null and g.expires_at > now());
$$;

create function private.shares_org(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user);
$$;

create function private.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = (select auth.uid()) and email_confirmed_at is not null;
$$;

create function private.audit(p_org uuid, p_action text, p_detail jsonb default '{}'::jsonb, p_label text default '')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, actor_label, org_id, action, detail)
  values ((select auth.uid()), coalesce(nullif(p_label, ''), coalesce((select email from auth.users where id = (select auth.uid())), 'system')), p_org, p_action, p_detail);
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.is_platform_admin(), private.role_in(uuid), private.is_member(uuid), private.is_org_admin(uuid),
  private.has_support_access(uuid), private.shares_org(uuid), private.my_email() to authenticated;

-- ── Row-level security ─────────────────────────────────────────────────────

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.access_requests enable row level security;
alter table public.workspace_state enable row level security;
alter table public.audit_log enable row level security;
alter table private.platform_admins enable row level security;
alter table private.support_grants enable row level security;

create policy organizations_read on public.organizations for select to authenticated
  using (private.is_member(id) or private.has_support_access(id));

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_org(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy memberships_read on public.memberships for select to authenticated
  using (private.is_member(org_id) or private.has_support_access(org_id));

create policy invitations_read on public.invitations for select to authenticated
  using (private.is_org_admin(org_id) or email = private.my_email());

create policy access_requests_read on public.access_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_org_admin(org_id));

create policy workspace_state_read on public.workspace_state for select to authenticated
  using (private.is_member(org_id) or private.has_support_access(org_id));

create policy audit_read on public.audit_log for select to authenticated
  using (org_id is not null and private.is_org_admin(org_id));

-- Defence in depth: clients may only read; all writes are via functions below.
revoke all on public.organizations, public.memberships, public.invitations, public.access_requests,
  public.workspace_state, public.audit_log from anon;
revoke insert, update, delete, truncate on public.organizations, public.memberships, public.invitations,
  public.access_requests, public.workspace_state, public.audit_log from authenticated;
revoke all on public.profiles from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
grant select on public.organizations, public.profiles, public.memberships, public.invitations,
  public.access_requests, public.workspace_state, public.audit_log to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ── Profiles and sign-up access requests ───────────────────────────────────

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- "Request access" sign-ups name a workspace; the request reaches its admins only
-- once the email is confirmed. Unknown workspace names are ignored (no enumeration).
create function private.request_from_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_wanted text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'requested_workspace', '')));
  v_org uuid;
begin
  if v_wanted = '' or new.email_confirmed_at is null or old.email_confirmed_at is not null then return new; end if;
  select id into v_org from public.organizations where slug = v_wanted or lower(name) = v_wanted limit 1;
  if v_org is not null and not exists (select 1 from public.memberships where org_id = v_org and user_id = new.id) then
    insert into public.access_requests (org_id, user_id, message) values (v_org, new.id, 'Requested at sign-up')
    on conflict do nothing;
    insert into public.audit_log (actor, actor_label, org_id, action) values (new.id, new.email, v_org, 'access.requested');
  end if;
  return new;
end;
$$;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row execute function private.request_from_signup();

insert into public.profiles (id, full_name)
select id, nullif(btrim(coalesce(raw_user_meta_data ->> 'full_name', '')), '') from auth.users
on conflict (id) do nothing;

-- ── Signed-in context ──────────────────────────────────────────────────────

create function public.my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'email_confirmed', u.email_confirmed_at is not null,
    'full_name', (select full_name from public.profiles where id = u.id),
    'is_platform_admin', private.is_platform_admin(),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', o.id, 'slug', o.slug, 'name', o.name, 'preset', o.preset, 'role', m.role, 'work_role', m.work_role) order by o.name)
      from public.memberships m join public.organizations o on o.id = m.org_id where m.user_id = u.id), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'org_name', o.name, 'role', i.role, 'invited_by', i.invited_by_label, 'expires_at', i.expires_at) order by i.created_at)
      from public.invitations i join public.organizations o on o.id = i.org_id
      where u.email_confirmed_at is not null and i.email = lower(u.email) and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'org_name', o.name, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc)
      from public.access_requests r join public.organizations o on o.id = r.org_id where r.user_id = u.id), '[]'::jsonb))
  from auth.users u where u.id = (select auth.uid());
$$;

-- ── Organization-level operations ──────────────────────────────────────────

create function public.request_access(p_workspace text, p_message text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_user uuid := (select auth.uid());
begin
  if v_user is null or private.my_email() is null then raise exception 'Confirm your email before requesting access.'; end if;
  select id into v_org from public.organizations where slug = lower(btrim(p_workspace)) or lower(name) = lower(btrim(p_workspace)) limit 1;
  -- Same answer whether or not the workspace exists, so names can't be probed.
  if v_org is null or exists (select 1 from public.memberships where org_id = v_org and user_id = v_user) then
    return 'If that workspace exists, its owners will see your request.';
  end if;
  insert into public.access_requests (org_id, user_id, message) values (v_org, v_user, left(coalesce(p_message, ''), 500)) on conflict do nothing;
  perform private.audit(v_org, 'access.requested');
  return 'If that workspace exists, its owners will see your request.';
end;
$$;

create function public.decide_access_request(p_request uuid, p_approve boolean, p_role public.org_role default 'member', p_work_role text default 'field')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'That request is no longer pending.'; end if;
  if not private.is_org_admin(r.org_id) then raise exception 'Only owners and admins decide access requests.'; end if;
  if p_approve and p_role in ('owner', 'admin') and private.role_in(r.org_id) <> 'owner' then raise exception 'Only an owner can grant owner or admin.'; end if;
  if p_approve then
    insert into public.memberships (org_id, user_id, role, work_role, added_by)
    values (r.org_id, r.user_id, p_role, case when p_role = 'reviewer' then 'reviewer' else p_work_role end, (select auth.uid()))
    on conflict (org_id, user_id) do nothing;
  end if;
  update public.access_requests set status = case when p_approve then 'approved' else 'denied' end,
    granted_role = case when p_approve then p_role end, decided_by = (select auth.uid()), decided_at = now() where id = p_request;
  perform private.audit(r.org_id, case when p_approve then 'access.approved' else 'access.denied' end, jsonb_build_object('user_id', r.user_id, 'role', p_role));
end;
$$;

create function public.create_invitation(p_org uuid, p_email text, p_role public.org_role default 'member', p_work_role text default 'field', p_days integer default 14)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins invite people.'; end if;
  if p_role in ('owner', 'admin') and private.role_in(p_org) <> 'owner' then raise exception 'Only an owner can invite owners or admins.'; end if;
  if p_days not between 1 and 30 then raise exception 'Invitations expire after 1–30 days.'; end if;
  insert into public.invitations (org_id, email, role, work_role, invited_by, invited_by_label, expires_at)
  values (p_org, v_email, p_role, case when p_role = 'reviewer' then 'reviewer' else p_work_role end, (select auth.uid()),
    coalesce((select email from auth.users where id = (select auth.uid())), ''), now() + make_interval(days => p_days))
  returning id into v_id;
  perform private.audit(p_org, 'invitation.created', jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end;
$$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  select * into i from public.invitations where id = p_invitation and accepted_at is null and revoked_at is null for update;
  if not found then raise exception 'That invitation is no longer open.'; end if;
  if not (private.is_org_admin(i.org_id) or (private.is_platform_admin() and i.role = 'owner')) then raise exception 'Not allowed.'; end if;
  update public.invitations set revoked_at = now() where id = p_invitation;
  perform private.audit(i.org_id, 'invitation.revoked', jsonb_build_object('email', i.email));
end;
$$;

-- Accepting proves control of the account: the caller's confirmed email must match.
create function public.accept_invitation(p_invitation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.invitations; v_email text := private.my_email();
begin
  if v_email is null then raise exception 'Confirm your email before accepting an invitation.'; end if;
  select * into i from public.invitations where id = p_invitation for update;
  if not found or i.email <> v_email then raise exception 'This invitation is not for your account.'; end if;
  if i.revoked_at is not null or i.accepted_at is not null then raise exception 'This invitation is no longer open.'; end if;
  if i.expires_at <= now() then raise exception 'This invitation has expired. Ask for a new one.'; end if;
  insert into public.memberships (org_id, user_id, role, work_role, added_by)
  values (i.org_id, (select auth.uid()), i.role, i.work_role, i.invited_by)
  on conflict (org_id, user_id) do update set role = excluded.role, work_role = excluded.work_role;
  update public.invitations set accepted_at = now(), accepted_by = (select auth.uid()) where id = p_invitation;
  update public.access_requests set status = 'cancelled' where org_id = i.org_id and user_id = (select auth.uid()) and status = 'pending';
  perform private.audit(i.org_id, 'invitation.accepted', jsonb_build_object('role', i.role));
  return i.org_id;
end;
$$;

create function public.set_member_role(p_org uuid, p_user uuid, p_role public.org_role, p_work_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_current public.org_role;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins change roles.'; end if;
  select role into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if not found then raise exception 'That person is not a member.'; end if;
  if (p_role in ('owner', 'admin') or v_current in ('owner', 'admin')) and private.role_in(p_org) <> 'owner' then raise exception 'Only an owner changes owners or admins.'; end if;
  if v_current = 'owner' and p_role <> 'owner' and (select count(*) from public.memberships where org_id = p_org and role = 'owner') = 1 then
    raise exception 'An organization must keep at least one owner.';
  end if;
  update public.memberships set role = p_role, work_role = case when p_role = 'reviewer' then 'reviewer' else p_work_role end where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.role_changed', jsonb_build_object('user_id', p_user, 'role', p_role));
end;
$$;

create function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_current public.org_role;
begin
  select role into v_current from public.memberships where org_id = p_org and user_id = p_user for update;
  if not found then raise exception 'That person is not a member.'; end if;
  if p_user <> (select auth.uid()) then
    if not private.is_org_admin(p_org) then raise exception 'Only owners and admins remove members.'; end if;
    if v_current in ('owner', 'admin') and private.role_in(p_org) <> 'owner' then raise exception 'Only an owner removes owners or admins.'; end if;
  end if;
  if v_current = 'owner' and (select count(*) from public.memberships where org_id = p_org and role = 'owner') = 1 then
    raise exception 'An organization must keep at least one owner.';
  end if;
  delete from public.memberships where org_id = p_org and user_id = p_user;
  perform private.audit(p_org, 'member.removed', jsonb_build_object('user_id', p_user));
end;
$$;

-- Owner-granted, time-limited support access for the platform team (audited).
create function public.grant_support_access(p_org uuid, p_hours integer, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if private.role_in(p_org) is distinct from 'owner' then raise exception 'Only an owner grants support access.'; end if;
  if p_hours not between 1 and 72 then raise exception 'Support access lasts 1–72 hours.'; end if;
  insert into private.support_grants (org_id, granted_by, reason, expires_at)
  values (p_org, (select auth.uid()), btrim(p_reason), now() + make_interval(hours => p_hours)) returning id into v_id;
  perform private.audit(p_org, 'support.granted', jsonb_build_object('hours', p_hours, 'reason', p_reason));
  return v_id;
end;
$$;

create function public.revoke_support_access(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins revoke support access.'; end if;
  update private.support_grants set revoked_at = now() where org_id = p_org and revoked_at is null and expires_at > now();
  perform private.audit(p_org, 'support.revoked');
end;
$$;

-- ── Platform-level operations (platform admins only, audited) ──────────────

create function public.platform_list_organizations() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'preset', o.preset, 'created_at', o.created_at,
      'members', (select count(*) from public.memberships m where m.org_id = o.id),
      'owners', (select count(*) from public.memberships m where m.org_id = o.id and m.role = 'owner'),
      'open_owner_invitations', (select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'expires_at', i.expires_at))
         from public.invitations i where i.org_id = o.id and i.role = 'owner' and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
      'support_access_until', (select max(g.expires_at) from private.support_grants g where g.org_id = o.id and g.revoked_at is null and g.expires_at > now()))
      order by o.created_at)
    from public.organizations o), '[]'::jsonb);
end;
$$;

create function public.platform_create_organization(p_slug text, p_name text, p_preset text default 'general') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only.'; end if;
  insert into public.organizations (slug, name, preset, created_by) values (lower(btrim(p_slug)), btrim(p_name), p_preset, (select auth.uid())) returning id into v_id;
  perform private.audit(v_id, 'platform.organization_created', jsonb_build_object('slug', p_slug, 'name', p_name));
  return v_id;
end;
$$;

-- The first owner is invited, never assigned: membership exists only after the
-- account holder signs in and accepts with the matching confirmed email.
create function public.platform_invite_owner(p_org uuid, p_email text, p_days integer default 14) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only.'; end if;
  if p_days not between 1 and 30 then raise exception 'Invitations expire after 1–30 days.'; end if;
  insert into public.invitations (org_id, email, role, work_role, invited_by, invited_by_label, expires_at)
  values (p_org, v_email, 'owner', 'manager', (select auth.uid()), 'Task-HQ platform team', now() + make_interval(days => p_days))
  returning id into v_id;
  perform private.audit(p_org, 'platform.owner_invited', jsonb_build_object('email', v_email));
  return v_id;
end;
$$;

revoke all on function public.my_context(), public.request_access(text, text), public.decide_access_request(uuid, boolean, public.org_role, text),
  public.create_invitation(uuid, text, public.org_role, text, integer), public.revoke_invitation(uuid), public.accept_invitation(uuid),
  public.set_member_role(uuid, uuid, public.org_role, text), public.remove_member(uuid, uuid), public.grant_support_access(uuid, integer, text),
  public.revoke_support_access(uuid), public.platform_list_organizations(), public.platform_create_organization(text, text, text),
  public.platform_invite_owner(uuid, text, integer) from public, anon;
grant execute on function public.my_context(), public.request_access(text, text), public.decide_access_request(uuid, boolean, public.org_role, text),
  public.create_invitation(uuid, text, public.org_role, text, integer), public.revoke_invitation(uuid), public.accept_invitation(uuid),
  public.set_member_role(uuid, uuid, public.org_role, text), public.remove_member(uuid, uuid), public.grant_support_access(uuid, integer, text),
  public.revoke_support_access(uuid), public.platform_list_organizations(), public.platform_create_organization(text, text, text),
  public.platform_invite_owner(uuid, text, integer) to authenticated;

-- Live updates of shared task data (RLS still applies to realtime).
alter publication supabase_realtime add table public.workspace_state;

-- Internal functions are never callable by clients (Supabase default privileges grant
-- EXECUTE broadly; take it back for everything that isn't an RLS helper).
revoke all on function private.audit(uuid, text, jsonb, text), private.handle_new_user(), private.request_from_signup() from public, anon, authenticated;
