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
  foreign key (org_id, contact_id) references public.staged_contacts (org_id, id) on delete cascade
);
-- One live plan per title per person; dropped/converted plans don't block re-planning.
create unique index staged_assignments_one_planned_title on public.staged_assignments (org_id, contact_id, title) where status = 'planned';

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

-- ── People & Roles: add / edit / remove staged people (no access, no email) ─
-- Saves a person to the directory of p_org. Never creates an account, membership or
-- invitation, and never prepares one: inviting is a separate, explicit step.
create function public.save_staged_contact(
  p_org uuid, p_contact uuid, p_full_name text, p_email text, p_phone text, p_title text,
  p_role public.org_role, p_work_role text, p_reports_to_contact uuid, p_reports_to_user uuid, p_notes text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name text := btrim(coalesce(p_full_name, ''));
  v_id uuid := p_contact; c public.staged_contacts; v_walk uuid; v_steps int := 0; v_key text;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins can add people.'; end if;
  if v_name = '' then raise exception 'Enter the person’s name.'; end if;
  if p_role = 'owner' then raise exception 'Owners aren’t staged. An owner adds another owner by inviting them directly.'; end if;
  if v_email is not null and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception '% is already an active member here.', v_email;
  end if;
  if v_email is not null and exists (select 1 from public.staged_contacts where org_id = p_org and email = v_email and archived_at is null and id is distinct from p_contact) then
    raise exception '% is already in this directory.', v_email;
  end if;
  if p_reports_to_contact is not null and p_reports_to_user is not null then raise exception 'Choose one person they report to.'; end if;
  if p_reports_to_contact is not null and not exists (select 1 from public.staged_contacts where id = p_reports_to_contact and org_id = p_org and archived_at is null) then
    raise exception 'They can only report to someone in this organization.';
  end if;
  if p_reports_to_user is not null and not exists (select 1 from public.memberships where org_id = p_org and user_id = p_reports_to_user) then
    raise exception 'They can only report to someone in this organization.';
  end if;
  if p_contact is not null then
    select * into c from public.staged_contacts where id = p_contact and archived_at is null for update;
    if not found or c.org_id <> p_org then raise exception 'That staged person isn’t available.'; end if;
    -- An open invitation is tied to the email; changing it would orphan the invitation.
    if c.email is distinct from v_email and exists (select 1 from public.invitations i where i.org_id = p_org and i.email = c.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) then
      raise exception 'Revoke the open invitation for % before changing the email.', c.email;
    end if;
    -- No reporting loops.
    v_walk := p_reports_to_contact;
    while v_walk is not null and v_steps < 200 loop
      if v_walk = p_contact then raise exception 'That would create a reporting loop.'; end if;
      select reports_to_contact into v_walk from public.staged_contacts where id = v_walk;
      v_steps := v_steps + 1;
    end loop;
    update public.staged_contacts set full_name = v_name, email = v_email, phone = nullif(btrim(coalesce(p_phone, '')), ''), title = nullif(btrim(coalesce(p_title, '')), ''),
      provisional_role = p_role, provisional_work_role = case when p_role = 'reviewer' then 'reviewer' when p_work_role = 'reviewer' then 'field' else p_work_role end,
      reports_to_contact = p_reports_to_contact, reports_to_user = p_reports_to_user, notes = left(coalesce(p_notes, ''), 500), updated_at = now()
    where id = p_contact;
    perform private.audit(p_org, 'staging.contact_updated', jsonb_build_object('contact', p_contact));
  else
    v_key := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 50);
    v_key := (case when v_key ~ '^[a-z0-9]' then v_key else 'person' end) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into public.staged_contacts (org_id, staging_key, full_name, email, phone, title, provisional_role, provisional_work_role, reports_to_contact, reports_to_user, notes, source, created_by)
    values (p_org, v_key, v_name, v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_title, '')), ''), p_role,
      case when p_role = 'reviewer' then 'reviewer' when p_work_role = 'reviewer' then 'field' else p_work_role end,
      p_reports_to_contact, p_reports_to_user, left(coalesce(p_notes, ''), 500), 'People & Roles', (select auth.uid()))
    returning id into v_id;
    perform private.audit(p_org, 'staging.contact_added', jsonb_build_object('contact', v_id));
  end if;
  return v_id;
end;
$$;

-- Removes a person who never became active. Their planned work is dropped; anyone who
-- reported to them reports to nobody. An open invitation must be revoked first.
create function public.remove_staged_contact(p_contact uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.staged_contacts;
begin
  select * into c from public.staged_contacts where id = p_contact and archived_at is null for update;
  if not found or not private.is_org_admin(c.org_id) then raise exception 'That staged person isn’t available.'; end if;
  if c.email is not null and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = c.org_id and lower(u.email) = c.email) then
    raise exception '% is already an active member. Manage them in the directory instead.', c.full_name;
  end if;
  if c.email is not null and exists (select 1 from public.invitations i where i.org_id = c.org_id and i.email = c.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) then
    raise exception 'Revoke the open invitation for % first.', c.email;
  end if;
  update public.staged_contacts set reports_to_contact = null, updated_at = now() where reports_to_contact = p_contact;
  update public.staged_assignments set status = 'dropped', updated_at = now() where contact_id = p_contact and status = 'planned';
  update public.staged_contacts set archived_at = now(), updated_at = now() where id = p_contact;
  perform private.audit(c.org_id, 'staging.contact_removed', jsonb_build_object('contact', p_contact));
end;
$$;

-- ── Planned work (Planned — not assigned) ──────────────────────────────────
create function public.save_staged_assignment(p_contact uuid, p_assignment uuid, p_title text, p_next_action text, p_due date, p_priority text, p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.staged_contacts; v_id uuid := p_assignment; v_title text := btrim(coalesce(p_title, ''));
begin
  select * into c from public.staged_contacts where id = p_contact and archived_at is null;
  if not found or not private.is_org_admin(c.org_id) then raise exception 'That staged person isn’t available.'; end if;
  if v_title = '' then raise exception 'Name the planned work.'; end if;
  if coalesce(p_priority, 'normal') not in ('normal', 'high') then raise exception 'Priority is normal or high.'; end if;
  if exists (select 1 from public.staged_assignments where org_id = c.org_id and contact_id = c.id and title = v_title and status = 'planned' and id is distinct from p_assignment) then
    raise exception '“%” is already planned for %.', v_title, c.full_name;
  end if;
  if p_assignment is null then
    insert into public.staged_assignments (org_id, contact_id, title, next_action, due, priority, notes, created_by)
    values (c.org_id, c.id, v_title, left(coalesce(p_next_action, ''), 200), p_due, coalesce(p_priority, 'normal'), left(coalesce(p_notes, ''), 1000), (select auth.uid()))
    returning id into v_id;
  else
    update public.staged_assignments set title = v_title, next_action = left(coalesce(p_next_action, ''), 200), due = p_due, priority = coalesce(p_priority, 'normal'), notes = left(coalesce(p_notes, ''), 1000), updated_at = now()
    where id = p_assignment and org_id = c.org_id and contact_id = c.id and status = 'planned';
    if not found then raise exception 'That planned work isn’t available.'; end if;
  end if;
  perform private.audit(c.org_id, 'staging.plan_saved', jsonb_build_object('contact', c.id, 'plan', v_id));
  return v_id;
end;
$$;

create function public.remove_staged_assignment(p_assignment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.staged_assignments where id = p_assignment and status = 'planned' for update;
  if v_org is null or not private.is_org_admin(v_org) then raise exception 'That planned work isn’t available.'; end if;
  update public.staged_assignments set status = 'dropped', updated_at = now() where id = p_assignment;
  perform private.audit(v_org, 'staging.plan_removed', jsonb_build_object('plan', p_assignment));
end;
$$;

-- After the person is ACTIVE and an owner/admin has created the real task through the
-- normal task engine, record which task the plan became. Never creates the task itself.
create function public.mark_staged_assignment_converted(p_assignment uuid, p_task_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.staged_assignments; c public.staged_contacts;
begin
  select * into a from public.staged_assignments where id = p_assignment and status = 'planned' for update;
  if not found or not private.is_org_admin(a.org_id) then raise exception 'That planned work isn’t available.'; end if;
  select * into c from public.staged_contacts where id = a.contact_id;
  if c.email is null or not exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = a.org_id and lower(u.email) = c.email) then
    raise exception '% isn’t an active member yet.', c.full_name;
  end if;
  if coalesce(btrim(p_task_id), '') = '' then raise exception 'Missing task.'; end if;
  update public.staged_assignments set status = 'converted', converted_task_id = btrim(p_task_id), updated_at = now() where id = p_assignment;
  perform private.audit(a.org_id, 'staging.plan_converted', jsonb_build_object('plan', p_assignment, 'task', p_task_id));
end;
$$;

-- ── Bulk prepare (all or nothing). Records invitations; sends nothing. ──────
create function public.invite_staged_contacts(p_contacts uuid[], p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid; v_out jsonb := '[]'::jsonb;
begin
  if coalesce(array_length(p_contacts, 1), 0) = 0 then raise exception 'Choose at least one person.'; end if;
  if array_length(p_contacts, 1) > 50 then raise exception 'Prepare at most 50 invitations at a time.'; end if;
  foreach v_contact in array p_contacts loop
    v_out := v_out || jsonb_build_object('contact', v_contact, 'invitation', public.invite_staged_contact(v_contact, p_days));
  end loop;
  return v_out;
end;
$$;

revoke all on function public.org_staging_overview(uuid), public.confirm_staged_affiliation(uuid, boolean), public.invite_staged_contact(uuid, integer),
  public.save_staged_contact(uuid, uuid, text, text, text, text, public.org_role, text, uuid, uuid, text), public.remove_staged_contact(uuid),
  public.save_staged_assignment(uuid, uuid, text, text, date, text, text), public.remove_staged_assignment(uuid),
  public.mark_staged_assignment_converted(uuid, text), public.invite_staged_contacts(uuid[], integer) from public, anon;
grant execute on function public.org_staging_overview(uuid), public.confirm_staged_affiliation(uuid, boolean), public.invite_staged_contact(uuid, integer),
  public.save_staged_contact(uuid, uuid, text, text, text, text, public.org_role, text, uuid, uuid, text), public.remove_staged_contact(uuid),
  public.save_staged_assignment(uuid, uuid, text, text, date, text, text), public.remove_staged_assignment(uuid),
  public.mark_staged_assignment_converted(uuid, text), public.invite_staged_contacts(uuid[], integer) to authenticated;
