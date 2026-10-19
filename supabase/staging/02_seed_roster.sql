-- STEP 3 — STAGE THE ROSTER (after migration 20261018030000_team_staging.sql is applied).
--
-- DRY RUN BY DEFAULT: everything happens inside one transaction that ends in ROLLBACK.
-- Review the two result sets (preview, then what would be stored). To write for real,
-- change the final ROLLBACK to COMMIT — only after approval.
--
-- Idempotent: re-running updates the same rows (matched by org + staging_key); it never
-- duplicates people, never resets a confirmed affiliation, never touches auth.users,
-- memberships or invitations, and sends nothing. An invariant check at the end aborts the
-- whole transaction if any account, membership or invitation count changed.
begin;

create temp table _before on commit drop as
  select (select count(*) from auth.users) as users, (select count(*) from public.memberships) as memberships,
         (select count(*) from public.invitations) as invitations,
         (select md5(string_agg(org_id::text || user_id::text || role::text || work_role, ',' order by org_id, user_id)) from public.memberships) as membership_hash;

-- ── Roster: keep identical to 01_preview_roster.sql ────────────────────────
create temp table _roster (
  staging_key text, org_slug text, full_name text, email text, phone text, title text,
  org_role text, work_role text, reports_to_key text, reports_to_email text
) on commit drop;
insert into _roster values
  -- ('jane-doe', 'quest-roofing', 'Jane Doe', 'jane@example.com', null, 'Estimator', 'member', 'estimator', null, null),
  (null, null, null, null, null, null, null, null, null, null);
delete from _roster where staging_key is null;
update _roster set full_name = btrim(full_name), email = nullif(lower(btrim(email)), ''), reports_to_email = nullif(lower(btrim(reports_to_email)), ''),
  org_role = coalesce(org_role, 'member'), work_role = coalesce(work_role, 'field');

-- Planned work for staged people (optional). Kept out of real tasks until they are active.
create temp table _planned (staging_key text, org_slug text, title text, next_action text, due date, priority text, notes text) on commit drop;
insert into _planned values
  -- ('jane-doe', 'quest-roofing', 'Walk the Maple Ave roof with the crew', 'Bring the moisture meter', '2026-10-24', 'normal', ''),
  (null, null, null, null, null, null, null);
delete from _planned where staging_key is null;

-- ── Verdict per row (same rules as the preview) ────────────────────────────
create temp table _verdict on commit drop as
select r.*, o.id as org_id,
  case
    when o.id is null then 'SKIP: organization does not exist'
    when (select count(*) from _roster r2 where r2.staging_key = r.staging_key and r2.org_slug = r.org_slug) > 1 then 'FIX: staging_key repeated'
    when r.email is not null and (select count(*) from _roster r2 where r2.email = r.email and r2.org_slug = r.org_slug) > 1 then 'FIX: email repeated'
    when exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and lower(u.email) = r.email) then 'SKIP: already an active member'
    when exists (select 1 from public.staged_contacts c where c.org_id = o.id and c.email = r.email and c.staging_key <> r.staging_key and c.archived_at is null) then 'FIX: email already staged under another key'
    else 'STAGE'
  end as verdict
from _roster r left join public.organizations o on o.slug = r.org_slug;

select staging_key, org_slug, full_name, email, org_role, work_role, verdict,
       case when exists (select 1 from public.staged_contacts c where c.org_id = v.org_id and c.staging_key = v.staging_key) then 'update' else 'insert' end as action
from _verdict v order by verdict, full_name;

-- ── Write staged people (only STAGE rows) ──────────────────────────────────
insert into public.staged_contacts (org_id, staging_key, full_name, email, phone, title, provisional_role, provisional_work_role, source)
select org_id, staging_key, full_name, email, phone, title, org_role::public.org_role, work_role, 'company directory (staged 2026-10-18)'
from _verdict where verdict = 'STAGE'
on conflict (org_id, staging_key) do update set
  full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, title = excluded.title,
  provisional_role = excluded.provisional_role, provisional_work_role = excluded.provisional_work_role, updated_at = now();
  -- affiliation_confirmed, archived_at and created_* are deliberately left as they are.

-- Reporting lines (second pass, once every staged row exists). Only what the roster says.
update public.staged_contacts c set reports_to_contact = p.id, reports_to_user = null, updated_at = now()
from _verdict v join public.staged_contacts p on p.org_id = v.org_id and p.staging_key = v.reports_to_key
where v.verdict = 'STAGE' and c.org_id = v.org_id and c.staging_key = v.staging_key;
update public.staged_contacts c set reports_to_user = m.user_id, reports_to_contact = null, updated_at = now()
from _verdict v join public.memberships m on m.org_id = v.org_id join auth.users u on u.id = m.user_id and lower(u.email) = v.reports_to_email
where v.verdict = 'STAGE' and v.reports_to_key is null and c.org_id = v.org_id and c.staging_key = v.staging_key;

insert into public.staged_assignments (org_id, contact_id, title, next_action, due, priority, notes)
select c.org_id, c.id, btrim(p.title), coalesce(p.next_action, ''), p.due, coalesce(p.priority, 'normal'), coalesce(p.notes, '')
from _planned p join public.organizations o on o.slug = p.org_slug join public.staged_contacts c on c.org_id = o.id and c.staging_key = p.staging_key
on conflict (org_id, contact_id, title) where status = 'planned' do update set next_action = excluded.next_action, due = excluded.due, priority = excluded.priority, notes = excluded.notes, updated_at = now();

-- ── What would be stored ───────────────────────────────────────────────────
select o.name as organization, c.staging_key, c.full_name, c.email, c.provisional_role, c.provisional_work_role,
       coalesce(rc.full_name, u.email) as reports_to, c.affiliation_confirmed,
       (select count(*) from public.staged_assignments a where a.contact_id = c.id and a.status = 'planned') as planned_work
from public.staged_contacts c join public.organizations o on o.id = c.org_id
left join public.staged_contacts rc on rc.id = c.reports_to_contact left join auth.users u on u.id = c.reports_to_user
where c.archived_at is null order by o.name, c.full_name;

-- ── Invariants: staging never creates accounts, memberships or invitations ──
do $$
declare b record;
begin
  select * into b from _before;
  if (select count(*) from auth.users) <> b.users then raise exception 'ABORT: auth.users changed'; end if;
  if (select count(*) from public.memberships) <> b.memberships then raise exception 'ABORT: memberships changed'; end if;
  if (select count(*) from public.invitations) <> b.invitations then raise exception 'ABORT: invitations changed'; end if;
  if (select md5(string_agg(org_id::text || user_id::text || role::text || work_role, ',' order by org_id, user_id)) from public.memberships) is distinct from b.membership_hash then
    raise exception 'ABORT: an existing membership (e.g. the owner''s) changed';
  end if;
  raise notice 'Invariants hold: no accounts, memberships or invitations created or changed.';
end $$;

rollback;  -- ← change to COMMIT only after the dry run has been reviewed and approved
