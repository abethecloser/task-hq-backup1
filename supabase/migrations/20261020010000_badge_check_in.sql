-- Badge check-in: each person scans their own QR badge with their own phone. The scan signs
-- them in and records a check-in (or check-out) that an Owner or Admin confirms with one tap.
--
-- Safety without extra steps for the person:
-- * The badge code is never stored, only its SHA-256 hash.
-- * A badge is bound to the first phone that scans it (only a hash of that phone's random
--   key is stored). A scan from any other phone signs no one in; it asks an Owner or Admin
--   to approve the new phone. A photographed or forwarded badge is useless elsewhere.
-- * Only the server-side scan function (service role) writes check-ins. Signed-in users
--   can read their own; Owners and Admins read and decide their workspace's.
-- * Owner and Admin accounts don't get badges; they keep their password.
-- * A day is not a calendar date: in/out toggles on the person's last event, and an "in"
--   older than 16 hours counts as a forgotten check-out (flagged for the confirmer).

create table public.work_badges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
create unique index work_badges_one_active on public.work_badges (org_id, user_id) where revoked_at is null;
alter table public.work_badges enable row level security;
revoke all on public.work_badges from public, anon, authenticated;

create table public.work_check_ins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'device')),
  at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  note text not null default '',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz
);
create index work_check_ins_org_at on public.work_check_ins (org_id, at desc);
create index work_check_ins_user_at on public.work_check_ins (user_id, org_id, at desc);
alter table public.work_check_ins enable row level security;
revoke all on public.work_check_ins from public, anon, authenticated;
grant select on public.work_check_ins to authenticated;
create policy work_check_ins_read on public.work_check_ins for select to authenticated
  using (user_id = (select auth.uid()) or private.is_org_admin(org_id));

-- Owner or Admin issues (or replaces) a person's badge. The browser generates the code and
-- sends only its hash; the code is shown once to the issuer.
create or replace function public.badge_issue(p_org uuid, p_user uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role public.org_role; v_id uuid;
begin
  perform private.require_section('people');
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins issue badges.'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Malformed badge.'; end if;
  select role into v_role from public.memberships where org_id = p_org and user_id = p_user;
  if v_role is null then raise exception 'Badges are for members of this workspace.'; end if;
  if v_role in ('owner', 'admin') then raise exception 'Owner and Admin accounts sign in with their password, not a badge.'; end if;
  update public.work_badges set revoked_at = now() where org_id = p_org and user_id = p_user and revoked_at is null;
  insert into public.work_badges (org_id, user_id, code_hash, issued_by) values (p_org, p_user, p_hash, (select auth.uid())) returning id into v_id;
  perform private.audit(p_org, 'badge.issued', jsonb_build_object('user_id', p_user));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.badge_revoke(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_section('people');
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins revoke badges.'; end if;
  update public.work_badges set revoked_at = now() where org_id = p_org and user_id = p_user and revoked_at is null;
  perform private.audit(p_org, 'badge.revoked', jsonb_build_object('user_id', p_user));
end $$;

-- What an Owner or Admin sees: who has a badge, and check-ins from the last 3 days.
create or replace function public.org_badges(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins can view badges.'; end if;
  return jsonb_build_object(
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'issued_at', b.issued_at, 'phone_linked', b.device_hash is not null, 'last_used_at', b.last_used_at))
      from public.work_badges b where b.org_id = p_org and b.revoked_at is null), '[]'::jsonb),
    'check_ins', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'user_id', c.user_id, 'email', u.email, 'full_name', p.full_name, 'kind', c.kind, 'at', c.at,
        'status', c.status, 'note', c.note, 'decided_at', c.decided_at) order by c.at desc)
      from public.work_check_ins c join auth.users u on u.id = c.user_id left join public.profiles p on p.id = c.user_id
      where c.org_id = p_org and (c.status = 'pending' or c.at > now() - interval '3 days')), '[]'::jsonb));
end $$;

-- One tap: confirm or reject a check-in, a check-out, or a new phone for a badge.
create or replace function public.decide_check_in(p_id uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.work_check_ins;
begin
  perform private.require_section('people');
  select * into c from public.work_check_ins where id = p_id and status = 'pending' for update;
  if not found then raise exception 'That check-in is no longer waiting.'; end if;
  if not private.is_org_admin(c.org_id) then raise exception 'Only owners and admins confirm check-ins.'; end if;
  if c.kind = 'device' and p_confirm then
    update public.work_badges set device_hash = c.device_hash where org_id = c.org_id and user_id = c.user_id and revoked_at is null;
  end if;
  update public.work_check_ins set status = case when p_confirm then 'confirmed' else 'rejected' end, decided_by = (select auth.uid()), decided_at = now() where id = p_id;
  perform private.audit(c.org_id, case when p_confirm then 'check_in.confirmed' else 'check_in.rejected' end, jsonb_build_object('user_id', c.user_id, 'kind', c.kind));
end $$;

-- Server only (the badge function, service role): a scan. Never callable from the browser.
create or replace function public.badge_scan(p_code_hash text, p_device_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.work_badges; v_role public.org_role; v_email text; v_name text; v_last public.work_check_ins; v_kind text; v_note text := ''; v_at timestamptz := now();
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_device_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'unavailable'); end if;
  select * into b from public.work_badges where code_hash = p_code_hash and revoked_at is null for update;
  if not found then return jsonb_build_object('result', 'unavailable'); end if;
  select m.role into v_role from public.memberships m where m.org_id = b.org_id and m.user_id = b.user_id;
  if v_role is null or v_role in ('owner', 'admin') then return jsonb_build_object('result', 'unavailable'); end if;
  select u.email, coalesce(p.full_name, '') into v_email, v_name from auth.users u left join public.profiles p on p.id = u.id where u.id = b.user_id;

  if b.device_hash is null then
    update public.work_badges set device_hash = p_device_hash where id = b.id;
  elsif b.device_hash <> p_device_hash then
    if not exists (select 1 from public.work_check_ins where user_id = b.user_id and org_id = b.org_id and kind = 'device' and status = 'pending' and device_hash = p_device_hash) then
      insert into public.work_check_ins (org_id, user_id, kind, device_hash, note) values (b.org_id, b.user_id, 'device', p_device_hash, 'Scanned from a new phone');
      perform private.audit(b.org_id, 'badge.new_phone', jsonb_build_object('user_id', b.user_id));
    end if;
    return jsonb_build_object('result', 'device-pending', 'name', v_name);
  end if;

  select * into v_last from public.work_check_ins where user_id = b.user_id and org_id = b.org_id and kind in ('in', 'out') order by at desc limit 1;
  if v_last.kind = 'in' and v_last.at > v_at - interval '16 hours' then
    v_kind := 'out';
  else
    v_kind := 'in';
    if v_last.kind = 'in' then v_note := 'Previous check-in had no check-out'; end if;
  end if;
  insert into public.work_check_ins (org_id, user_id, kind, at, note) values (b.org_id, b.user_id, v_kind, v_at, v_note);
  update public.work_badges set last_used_at = v_at where id = b.id;
  perform private.audit(b.org_id, 'check_in.' || v_kind, jsonb_build_object('user_id', b.user_id));
  return jsonb_build_object('result', 'ok', 'kind', v_kind, 'at', v_at, 'email', v_email, 'name', v_name, 'note', v_note);
end $$;

revoke all on function public.badge_scan(text, text) from public, anon, authenticated;
grant execute on function public.badge_scan(text, text) to service_role;
revoke all on function public.badge_issue(uuid, uuid, text), public.badge_revoke(uuid, uuid), public.org_badges(uuid), public.decide_check_in(uuid, boolean) from public, anon;
grant execute on function public.badge_issue(uuid, uuid, text), public.badge_revoke(uuid, uuid), public.org_badges(uuid), public.decide_check_in(uuid, boolean) to authenticated;
