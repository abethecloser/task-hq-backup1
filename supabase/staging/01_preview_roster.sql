-- STEP 1 — DRY-RUN PREVIEW (read-only). Safe to run on production at any time.
-- A single SELECT: it writes nothing, creates nothing and needs no migration.
-- Paste the roster below (same rows as 02_seed_roster.sql), run, and review every row's
-- `verdict` before anything is written.
--
-- Columns, per person:
--   staging_key        stable id you choose: lowercase letters, digits, dashes (e.g. 'jane-doe')
--   org_slug           REQUIRED and explicit: 'quest-roofing' or the Construction org's slug.
--                      Nothing defaults to Roofing. Rows for an organization that doesn't
--                      exist yet are reported and skipped.
--   full_name, email, phone, title     as written in the directory; email/phone may be null
--   org_role           provisional: admin | supervisor | member | reviewer   (never owner)
--   work_role          provisional: manager | coordinator | field | sales | estimator | reviewer
--   reports_to_key     staging_key of another staged person, or null
--   reports_to_email   email of an ACTIVE member of the same org (e.g. the owner), or null.
--                      Never filled in by default.
with roster (staging_key, org_slug, full_name, email, phone, title, org_role, work_role, reports_to_key, reports_to_email) as (
  values
    -- ('jane-doe', 'quest-roofing', 'Jane Doe', 'jane@example.com', null, 'Estimator', 'member', 'estimator', null, null),
    (null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text)
),
r as (
  select staging_key, org_slug, btrim(full_name) as full_name, nullif(lower(btrim(email)), '') as email, phone, title,
         coalesce(org_role, 'member') as org_role, coalesce(work_role, 'field') as work_role, reports_to_key, nullif(lower(btrim(reports_to_email)), '') as reports_to_email
  from roster where staging_key is not null
),
checked as (
  select r.*, o.id as org_id, o.name as org_name,
    -- Already an active member of this org (e.g. the owner): never staged.
    exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and lower(u.email) = r.email) as active_member_here,
    -- Member of a different org with the same email: warning only.
    (select string_agg(o2.name, ', ') from public.memberships m join auth.users u on u.id = m.user_id join public.organizations o2 on o2.id = m.org_id
       where lower(u.email) = r.email and m.org_id is distinct from o.id) as member_elsewhere,
    exists (select 1 from public.invitations i where i.org_id = o.id and i.email = r.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) as open_invitation_here,
    exists (select 1 from auth.users u where lower(u.email) = r.email) as has_account,
    (select count(*) from r r2 where r2.staging_key = r.staging_key) as dup_key_in_roster,
    (select count(*) from r r2 where r.email is not null and r2.email = r.email and r2.org_slug = r.org_slug) as dup_email_in_roster,
    (r.reports_to_key is null or exists (select 1 from r r3 where r3.staging_key = r.reports_to_key and r3.org_slug = r.org_slug)) as reports_to_key_ok,
    (r.reports_to_email is null or exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id where m.org_id = o.id and lower(u.email) = r.reports_to_email)) as reports_to_member_ok
  from r left join public.organizations o on o.slug = r.org_slug
)
select staging_key, org_slug, coalesce(org_name, '— missing —') as organization, full_name, email, org_role, work_role,
  case
    when org_id is null then 'SKIP: organization does not exist (create it first; never routed to another org)'
    when staging_key !~ '^[a-z0-9][a-z0-9-]{0,62}$' then 'FIX: staging_key must be lowercase letters, digits, dashes'
    when dup_key_in_roster > 1 then 'FIX: staging_key repeated in roster'
    when dup_email_in_roster > 1 then 'FIX: email repeated in roster for this org'
    when org_role = 'owner' then 'FIX: owners are never staged'
    when org_role not in ('admin', 'supervisor', 'member', 'reviewer') then 'FIX: unknown org_role'
    when work_role not in ('manager', 'coordinator', 'field', 'sales', 'estimator', 'reviewer') then 'FIX: unknown work_role'
    when org_role = 'reviewer' and work_role <> 'reviewer' then 'FIX: a reviewer''s work_role must be reviewer'
    when email is not null and email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'FIX: email looks invalid'
    when active_member_here then 'SKIP: already an active member here (not staged, membership untouched)'
    when not reports_to_key_ok then 'FIX: reports_to_key not in roster for this org'
    when not reports_to_member_ok then 'FIX: reports_to_email is not an active member of this org'
    else 'STAGE'
  end as verdict,
  concat_ws('; ',
    case when member_elsewhere is not null then 'member of ' || member_elsewhere end,
    case when open_invitation_here then 'open invitation already exists (shows as Invited)' end,
    case when has_account then 'has a Task-HQ account' end,
    case when email is null then 'no email: can be staged, cannot be invited until added' end) as notes
from checked
order by verdict, full_name;
