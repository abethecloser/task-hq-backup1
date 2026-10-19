-- Developer / Observer profile (2026-10-19) = the existing organization role `reviewer`
-- with work role `reviewer`. Its boundaries are already enforced on the server:
--   dispatch refuses every non-feedback action from a reviewer and never assigns them work;
--   every People, invitation, role and activation function requires owner/admin.
-- This only reopens every temporarily restricted section for that role, so observers can see
-- all modules (read-only). Reverse with: delete from private.section_role_access where role = 'reviewer';

insert into private.section_role_access (section, role)
select section, 'reviewer'::public.org_role from private.restricted_sections
on conflict do nothing;
