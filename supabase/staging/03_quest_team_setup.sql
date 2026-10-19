-- Quest team setup (2026-10-17). Paste into the Supabase SQL Editor (project task-hq) and run.
-- One atomic block: if anything fails, nothing is written. Sends nothing to anyone.
--
-- Creates:
--   * Workspaces "Quest Construction" and "Quest Drafting & Design" (Quest Roofing exists).
--   * Owner invitations for admin@questroofing.com in both new workspaces (Abraham accepts on sign-in).
--   * Admin invitations for team@enternovum.com in all three workspaces (Alexia accepts on sign-in).
--   * Display name "Alexia Valenzuela" on team@enternovum.com (the "alias").
--   * Staged people from the Podio member lists, all "Not invited" (no account, no access).
--     Alkeith is already staged in Roofing; his planned role becomes Admin.
-- It creates NO memberships and NO accounts (checked at the end; the block aborts otherwise).
-- Safe to run once. A second run stops at the first step ("duplicate key ... organizations_slug_key").
do $$
declare
  v_alexia uuid := (select id from auth.users where lower(email) = 'team@enternovum.com');
  v_roof uuid := (select id from public.organizations where slug = 'quest-roofing');
  v_con uuid; v_dd uuid; v_org uuid;
  v_members int := (select count(*) from public.memberships);
  v_users int := (select count(*) from auth.users);
  r record;
begin
  if v_alexia is null or v_roof is null then raise exception 'ABORT: expected account or Quest Roofing not found'; end if;

  -- 1. Workspaces.
  insert into public.organizations (slug, name, preset, created_by) values ('quest-construction', 'Quest Construction', 'general', v_alexia) returning id into v_con;
  insert into public.organizations (slug, name, preset, created_by) values ('quest-drafting-design', 'Quest Drafting & Design', 'general', v_alexia) returning id into v_dd;
  insert into public.audit_log (actor, actor_label, org_id, action, detail) values
    (v_alexia, 'team@enternovum.com', v_con, 'platform.organization_created', '{"slug":"quest-construction"}'),
    (v_alexia, 'team@enternovum.com', v_dd, 'platform.organization_created', '{"slug":"quest-drafting-design"}');

  -- 2. Abraham owns both new workspaces (invitation; he accepts when he next signs in).
  foreach v_org in array array[v_con, v_dd] loop
    insert into public.invitations (org_id, email, role, work_role, invited_by, invited_by_label, expires_at)
      values (v_org, 'admin@questroofing.com', 'owner', 'manager', v_alexia, 'Task-HQ platform team', now() + interval '30 days');
    insert into public.audit_log (actor, actor_label, org_id, action, detail) values (v_alexia, 'team@enternovum.com', v_org, 'platform.owner_invited', '{"email":"admin@questroofing.com"}');
  end loop;

  -- 3. Alexia is an admin in all three (invitation; accepted by Alexia herself).
  foreach v_org in array array[v_roof, v_con, v_dd] loop
    insert into public.invitations (org_id, email, role, work_role, invited_by, invited_by_label, expires_at)
      values (v_org, 'team@enternovum.com', 'admin', 'manager', v_alexia, 'Platform setup for Abraham (requested by Alexia)', now() + interval '30 days');
    insert into public.audit_log (actor, actor_label, org_id, action, detail) values (v_alexia, 'team@enternovum.com', v_org, 'invitation.created', '{"email":"team@enternovum.com","role":"admin","note":"platform setup on the owner''s behalf"}');
  end loop;

  -- 4. Alias.
  update public.profiles set full_name = 'Alexia Valenzuela' where id = v_alexia;

  -- 5. Staged people (Not invited). Planned roles grant nothing.
  update public.staged_contacts set provisional_role = 'admin', provisional_work_role = 'manager', updated_at = now()
    where org_id = v_roof and email = 'alk.constructionsolutions@gmail.com' and archived_at is null;
  for r in select * from (values
    (v_roof, 'kristin-montes', 'Kristin Montes', 'monteskristint@gmail.com', 'admin', 'manager', ''),
    (v_roof, 'ralph-palad', 'Ralph Palad', 'ralphalexispalad@gmail.com', 'member', 'field', ''),
    (v_con, 'kristin-montes', 'Kristin Montes', 'monteskristint@gmail.com', 'admin', 'manager', ''),
    (v_con, 'alkeith-cabezzas', 'Alkeith Cabezzas', 'alk.constructionsolutions@gmail.com', 'admin', 'manager', ''),
    (v_con, 'ralph-palad', 'Ralph Palad', 'ralphalexispalad@gmail.com', 'member', 'field', ''),
    (v_con, 'andres-chavez', 'Andres Chavez', 'andres@questconstruction.com', 'reviewer', 'reviewer', 'Client in Podio (ArchiPlan). Planned view-only; confirm his role.'),
    (v_dd, 'kristin-montes', 'Kristin Montes', 'monteskristint@gmail.com', 'admin', 'manager', ''),
    (v_dd, 'ralph-palad', 'Ralph Palad', 'ralphalexispalad@gmail.com', 'member', 'field', ''),
    (v_dd, 'andres-chavez', 'Andres Chavez', 'andres@questconstruction.com', 'reviewer', 'reviewer', 'Client in Podio (ArchiPlan). Planned view-only; confirm his role.'),
    (v_dd, 'tinesha-lewis', 'Tinesha Lewis', 'tl.archipd@outlook.com', 'reviewer', 'reviewer', 'Guest in Podio (ArchiPlan). Planned view-only; confirm her role.'),
    (v_dd, 'mariazarinaallam', 'mariazarinaallam@gmail.com', 'mariazarinaallam@gmail.com', 'member', 'field', 'Name not set in Podio; add it when known.')
  ) as t(org, key, name, email, role, work, note) loop
    insert into public.staged_contacts (org_id, staging_key, full_name, email, provisional_role, provisional_work_role, notes, source, created_by)
      values (r.org, r.key, r.name, r.email, r.role::public.org_role, r.work, r.note, 'Podio member lists (2026-10-17)', v_alexia);
    insert into public.audit_log (actor, actor_label, org_id, action, detail) values (v_alexia, 'team@enternovum.com', r.org, 'staging.contact_added', jsonb_build_object('email', r.email));
  end loop;

  -- Invariants.
  if (select count(*) from public.memberships) <> v_members then raise exception 'ABORT: memberships changed'; end if;
  if (select count(*) from auth.users) <> v_users then raise exception 'ABORT: accounts changed'; end if;
end $$;

-- What now exists (read-only summary).
select o.name as workspace,
  (select string_agg(u.email || ' (' || m.role || ')', ', ') from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id) as active_members,
  (select string_agg(i.email || ' → ' || i.role, ', ') from public.invitations i where i.org_id = o.id and i.accepted_at is null and i.revoked_at is null) as open_invitations,
  (select string_agg(c.full_name || ' · planned ' || c.provisional_role, ', ' order by c.full_name) from public.staged_contacts c where c.org_id = o.id and c.archived_at is null) as staged_not_invited
from public.organizations o order by o.created_at;
