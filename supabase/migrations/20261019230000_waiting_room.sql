-- Waiting room: anyone signed in without a workspace joins one queue automatically.
-- An Owner or Admin places them with a role in one step; the membership is created right away,
-- with no separate invitation to accept. Granting Owner or Admin still requires an Owner.
-- A waiting-room entry is an access request with no workspace yet (org_id is null).
--
-- Visibility trade-off: owners and admins of any workspace see the waiting room. Today there is
-- one customer workspace; revisit (route by workspace) before a second customer is onboarded.

alter table public.access_requests alter column org_id drop not null;

create unique index if not exists access_requests_one_waiting
  on public.access_requests (user_id) where org_id is null and status = 'pending';

-- Join (or update the note on) your own waiting-room entry. Without a note it never re-adds
-- someone whose last waiting-room request was declined; asking again needs a note.
create or replace function public.join_waiting_room(p_message text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_note text := left(btrim(coalesce(p_message, '')), 500); r public.access_requests;
begin
  if v_user is null or private.my_email() is null then raise exception 'Confirm your email before joining the waiting room.'; end if;
  select * into r from public.access_requests where user_id = v_user and org_id is null and status = 'pending';
  if not found then
    if v_note = '' and exists (select 1 from public.access_requests where user_id = v_user and org_id is null and status = 'denied') then
      return jsonb_build_object('declined', true);
    end if;
    insert into public.access_requests (org_id, user_id, message) values (null, v_user, v_note) returning * into r;
    perform private.audit(null, 'waiting_room.joined');
  elsif v_note <> '' then
    update public.access_requests set message = v_note where id = r.id returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'since', r.created_at,
    'position', (select count(*) from public.access_requests where org_id is null and status = 'pending' and created_at <= r.created_at));
end $$;

-- Asking a workspace by name: clear answers; an unknown name lands in the waiting room instead of nowhere.
create or replace function public.request_access(p_workspace text, p_message text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_user uuid := (select auth.uid()); v_note text := left(coalesce(p_message, ''), 500);
begin
  if v_user is null or private.my_email() is null then raise exception 'Confirm your email before requesting access.'; end if;
  select id, name into v_org, v_name from public.organizations where slug = lower(btrim(p_workspace)) or lower(name) = lower(btrim(p_workspace)) limit 1;
  if v_org is null then
    perform public.join_waiting_room(left(btrim('Asked for “' || btrim(p_workspace) || '”. ' || v_note), 500));
    return 'No workspace matched that name, so you’re in the waiting room with your note. An Owner or Admin will place you.';
  end if;
  if exists (select 1 from public.memberships where org_id = v_org and user_id = v_user) then return 'You’re already a member of ' || v_name || '.'; end if;
  insert into public.access_requests (org_id, user_id, message) values (v_org, v_user, v_note) on conflict do nothing;
  perform private.audit(v_org, 'access.requested');
  return 'Request sent to ' || v_name || '’s owners and admins.';
end $$;

-- Deciding works for both kinds: a request to this workspace, or a waiting-room entry placed into it.
drop function if exists public.decide_access_request(uuid, boolean, public.org_role, text);
create function public.decide_access_request(p_request uuid, p_approve boolean, p_role public.org_role default 'member', p_work_role text default 'field', p_org uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.access_requests; v_org uuid;
begin
  perform private.require_section('people');
  select * into r from public.access_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'That request is no longer pending.'; end if;
  if r.org_id is not null and p_org is not null and p_org <> r.org_id then raise exception 'That request is for another workspace.'; end if;
  v_org := coalesce(r.org_id, p_org);
  if v_org is null then raise exception 'Choose the workspace to place them in.'; end if;
  if not private.is_org_admin(v_org) then raise exception 'Only owners and admins decide access requests.'; end if;
  if p_approve and p_role in ('owner', 'admin') and private.role_in(v_org) <> 'owner' then raise exception 'Only an owner can grant owner or admin.'; end if;
  if p_approve then
    insert into public.memberships (org_id, user_id, role, work_role, added_by)
    values (v_org, r.user_id, p_role, case when p_role = 'reviewer' then 'reviewer' else p_work_role end, (select auth.uid()))
    on conflict (org_id, user_id) do nothing;
    -- Their other open requests for this workspace are settled by this decision.
    update public.access_requests set status = 'cancelled' where user_id = r.user_id and org_id = v_org and status = 'pending' and id <> r.id;
  end if;
  update public.access_requests set org_id = case when p_approve then v_org else org_id end,
    status = case when p_approve then 'approved' else 'denied' end,
    granted_role = case when p_approve then p_role end, decided_by = (select auth.uid()), decided_at = now() where id = p_request;
  perform private.audit(v_org, case when p_approve then 'access.approved' else 'access.denied' end,
    jsonb_build_object('user_id', r.user_id, 'role', p_role, 'waiting_room', r.org_id is null));
end $$;
revoke all on function public.decide_access_request(uuid, boolean, public.org_role, text, uuid) from public, anon;
grant execute on function public.decide_access_request(uuid, boolean, public.org_role, text, uuid) to authenticated;

revoke all on function public.join_waiting_room(text) from public, anon;
grant execute on function public.join_waiting_room(text) to authenticated;

-- Approvers see this workspace's requests plus the waiting room.
create or replace function public.org_admin_overview(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins can view member administration.'; end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'full_name', p.full_name, 'role', m.role, 'work_role', m.work_role, 'since', m.created_at) order by m.created_at)
      from public.memberships m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
      where m.org_id = p_org), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'email', u.email, 'full_name', p.full_name, 'message', r.message, 'created_at', r.created_at, 'waiting', r.org_id is null) order by r.created_at)
      from public.access_requests r join auth.users u on u.id = r.user_id left join public.profiles p on p.id = r.user_id
      where r.status = 'pending' and (r.org_id = p_org or r.org_id is null)
        and not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = r.user_id)), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'work_role', i.work_role, 'expires_at', i.expires_at) order by i.created_at)
      from public.invitations i
      where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()), '[]'::jsonb));
end $$;

-- The signed-in person's own waiting-room place.
create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = '' as $$
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
      from public.access_requests r join public.organizations o on o.id = r.org_id where r.user_id = u.id), '[]'::jsonb),
    'waiting', (
      select jsonb_build_object('id', r.id, 'since', r.created_at, 'message', r.message,
        'position', (select count(*) from public.access_requests w where w.org_id is null and w.status = 'pending' and w.created_at <= r.created_at))
      from public.access_requests r where r.user_id = u.id and r.org_id is null and r.status = 'pending'),
    'waiting_declined', exists (select 1 from public.access_requests r where r.user_id = u.id and r.org_id is null and r.status = 'denied')
      and not exists (select 1 from public.access_requests r where r.user_id = u.id and r.org_id is null and r.status = 'pending'))
  from auth.users u where u.id = (select auth.uid());
$$;
