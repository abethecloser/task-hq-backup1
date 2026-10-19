-- Owner administration during temporary restricted navigation (2026-10-19).
-- Sections can be reopened for an organization role, decided by the caller's existing
-- membership (auth user id + memberships.role), never by email. Owners keep People & Roles
-- (owner-only administration and activation approvals); every other restricted section
-- stays restricted. Reverse with: delete from private.section_role_access where section = 'people';
-- The People & Roles functions keep all their existing permission checks.

create table private.section_role_access (
  section text not null references private.restricted_sections(section) on delete cascade,
  role public.org_role not null,
  primary key (section, role)
);
alter table private.section_role_access enable row level security;

insert into private.section_role_access (section, role) values ('people', 'owner');

-- Allowed when the section isn't restricted, the caller is allowlisted, or the caller holds a
-- role that reopens it. The guarded functions still check the target organization themselves.
create or replace function private.section_allowed(p_section text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from private.restricted_sections where section = p_section)
      or exists (select 1 from private.full_navigation_users where user_id = (select auth.uid()))
      or exists (select 1 from private.section_role_access a join public.memberships m on m.role = a.role
                 where a.section = p_section and m.user_id = (select auth.uid()));
$$;

-- by_org: sections reopened for the caller in each organization, by their role there.
create or replace function public.my_navigation() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'full', exists (select 1 from private.full_navigation_users where user_id = (select auth.uid())),
    'restricted', coalesce((select jsonb_agg(section order by section) from private.restricted_sections), '[]'::jsonb),
    'by_org', coalesce((select jsonb_object_agg(org_id, sections) from (
        select m.org_id, jsonb_agg(a.section order by a.section) as sections
        from public.memberships m join private.section_role_access a on a.role = m.role
        where m.user_id = (select auth.uid()) group by m.org_id) reopened), '{}'::jsonb));
$$;
