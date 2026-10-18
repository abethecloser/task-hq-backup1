-- CANDIDATE — not applied. Team staging: represent people before they are invited.
--
-- Apply on its own (SQL Editor, or apply_migration after approval). Do NOT use
-- `supabase db push`: this folder also holds unapplied candidates (intake, operational
-- attention, platform owner-invite hardening) that must not ride along.
--
-- What this is:
--   staged_contacts     People an owner/admin plans to bring in. NOT accounts, NOT members.
--                       Provisional roles and reporting lines are planning data only; no
--                       permission anywhere reads them.
--   staged_assignments  Work planned for a staged person. The task engine only accepts real
--                       members as owners, so planned work stays here until that person is
--                       active and an owner creates the real task.
--
-- What this is not:
--   No rows in auth.users, memberships or invitations are created by staging. Invitation and
--   membership state are DERIVED by email from the real tables (org_staging_overview), so
--   there is one source of truth and no trigger. Nothing here sends email, calls a webhook or
--   schedules anything: the project has no pg_net, database webhooks or pg_cron, and the only
--   triggers are on auth.users, which staging never touches.
--
-- Access: owners/admins of the same organization only, through security-definer functions.
-- Clients, the dispatch function (service_role), platform admins and support-access grants
-- get no direct access to these tables. Contact details are personal data.

create table public.staged_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Stable, human-readable key so the roster script is idempotent (e.g. 'jane-doe').
  staging_key text not null check (staging_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text check (email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone text check (phone is null or length(phone) <= 40),
  title text check (title is null or length(title) <= 120),
  -- Provisional only: used to pre-fill an invitation later. Owners are never staged.
  provisional_role public.org_role not null default 'member' check (provisional_role <> 'owner'),
  provisional_work_role text not null default 'field'
    check (provisional_work_role in ('manager', 'coordinator', 'field', 'sales', 'estimator', 'reviewer')),
  -- Reporting line: another staged contact OR an active member of the SAME organization.
  reports_to_contact uuid,
  reports_to_user uuid,
  -- Must be confirmed by an owner/admin before an invitation can be prepared.
  affiliation_confirmed boolean not null default false,
  affiliation_confirmed_by uuid references auth.users (id) on delete set null,
  affiliation_confirmed_at timestamptz,
  source text not null default '' check (length(source) <= 200),
  notes text not null default '' check (length(notes) <= 500),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (org_id, staging_key),
  unique (org_id, id),
  check (reports_to_contact is null or reports_to_user is null),
  check (reports_to_contact is distinct from id),
  check (provisional_role <> 'reviewer' or provisional_work_role = 'reviewer'),
  -- Composite keys keep every reference inside one tenant.
  foreign key (org_id, reports_to_contact) references public.staged_contacts (org_id, id) on delete set null (reports_to_contact),
  foreign key (org_id, reports_to_user) references public.memberships (org_id, user_id) on delete set null (reports_to_user)
);
create unique index staged_contacts_one_email_per_org on public.staged_contacts (org_id, email) where email is not null and archived_at is null;
create index staged_contacts_org_idx on public.staged_contacts (org_id) where archived_at is null;

create table public.staged_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  next_action text not null default '' check (length(next_action) <= 200),
  due date,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'planned' check (status in ('planned', 'converted', 'dropped')),
  -- Set when an owner turns this into a real Task-HQ task after the person is active.
  converted_task_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (org_id, contact_id, title),
  foreign key (org_id, contact_id) references public.staged_contacts (org_id, id) on delete cascade
);

-- ── Row-level security and privileges ──────────────────────────────────────
alter table public.staged_contacts enable row level security;
alter table public.staged_assignments enable row level security;
-- Defence in depth only: no role below is granted table access, so reads go through the
-- functions further down. If a direct grant is ever added, these policies still apply.
create policy staged_contacts_admin_read on public.staged_contacts for select to authenticated using (private.is_org_admin(org_id));
create policy staged_assignments_admin_read on public.staged_assignments for select to authenticated using (private.is_org_admin(org_id));
revoke all on public.staged_contacts, public.staged_assignments from public, anon, authenticated, service_role;
-- Not added to the supabase_realtime publication: nothing is broadcast.

-- ── Read: staged people with derived invitation/membership state ───────────
-- state: 'not-invited' | 'invited' (open invitation for that email) | 'active' (member)
--        'expired' (only an expired/revoked invitation exists)
create function public.org_staging_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins can view staged people.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'key', c.staging_key, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'title', c.title,
      'provisional_role', c.provisional_role, 'provisional_work_role', c.provisional_work_role,
      'reports_to_contact', c.reports_to_contact, 'reports_to_user', c.reports_to_user,
      'affiliation_confirmed', c.affiliation_confirmed, 'affiliation_confirmed_at', c.affiliation_confirmed_at,
      'source', c.source, 'notes', c.notes,
      'state', case
        when m.user_id is not null then 'active'
        when i.id is not null and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() then 'invited'
        when i.id is not null then 'expired'
        else 'not-invited' end,
      'member_user_id', m.user_id,
      'invitation', case when i.id is null then null else jsonb_build_object('id', i.id, 'role', i.role, 'work_role', i.work_role, 'expires_at', i.expires_at) end,
      'planned', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'next_action', a.next_action, 'due', a.due, 'priority', a.priority, 'notes', a.notes) order by a.due nulls last, a.created_at)
        from public.staged_assignments a where a.org_id = c.org_id and a.contact_id = c.id and a.status = 'planned'), '[]'::jsonb)
    ) order by lower(c.full_name))
    from public.staged_contacts c
    left join lateral (
      select mm.user_id from public.memberships mm join auth.users u on u.id = mm.user_id
      where c.email is not null and mm.org_id = c.org_id and lower(u.email) = c.email limit 1) m on true
    left join lateral (
      select inv.* from public.invitations inv
      where c.email is not null and inv.org_id = c.org_id and inv.email = c.email
      order by inv.created_at desc limit 1) i on true
    where c.org_id = p_org and c.archived_at is null), '[]'::jsonb);
end;
$$;

-- ── Write: confirm (or un-confirm) organization affiliation ────────────────
create function public.confirm_staged_affiliation(p_contact uuid, p_confirmed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.staged_contacts where id = p_contact and archived_at is null for update;
  -- Same answer whether the contact is missing or belongs to another organization.
  if v_org is null or not private.is_org_admin(v_org) then raise exception 'That staged person isn’t available.'; end if;
  update public.staged_contacts
     set affiliation_confirmed = p_confirmed,
         affiliation_confirmed_by = case when p_confirmed then (select auth.uid()) end,
         affiliation_confirmed_at = case when p_confirmed then now() end,
         updated_at = now()
   where id = p_contact;
  perform private.audit(v_org, case when p_confirmed then 'staging.affiliation_confirmed' else 'staging.affiliation_unconfirmed' end, jsonb_build_object('contact', p_contact));
end;
$$;

-- ── Activation step 1: prepare (record) an invitation from a staged person ─
-- Records an invitation exactly like create_invitation (which it calls, so every existing
-- owner/admin rule applies). Sends nothing. Membership happens only when the person signs
-- in with that confirmed email and accepts.
create function public.invite_staged_contact(p_contact uuid, p_days integer default 14) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.staged_contacts; v_id uuid;
begin
  select * into c from public.staged_contacts where id = p_contact and archived_at is null for update;
  if not found or not private.is_org_admin(c.org_id) then raise exception 'That staged person isn’t available.'; end if;
  if not c.affiliation_confirmed then raise exception 'Confirm that % belongs to this organization before inviting them.', c.full_name; end if;
  if c.email is null then raise exception 'Add an email for % before inviting them.', c.full_name; end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = c.org_id and lower(u.email) = c.email) then
    raise exception '% is already a member.', c.email;
  end if;
  v_id := public.create_invitation(c.org_id, c.email, c.provisional_role, c.provisional_work_role, p_days);
  perform private.audit(c.org_id, 'staging.invitation_prepared', jsonb_build_object('contact', c.id, 'invitation', v_id));
  return v_id;
end;
$$;

revoke all on function public.org_staging_overview(uuid), public.confirm_staged_affiliation(uuid, boolean), public.invite_staged_contact(uuid, integer) from public, anon;
grant execute on function public.org_staging_overview(uuid), public.confirm_staged_affiliation(uuid, boolean), public.invite_staged_contact(uuid, integer) to authenticated;
