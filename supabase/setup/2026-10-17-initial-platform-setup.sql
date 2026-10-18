-- Task-HQ initial platform setup, 2026-10-17.
-- Authorized in chat by the Task-HQ operator (Alexia):
--   * team@enternovum.com is the Platform Super Admin (platform level only; NOT a Quest Roofing member).
--   * admin@questroofing.com becomes Owner of Quest Roofing "after account ownership is verified":
--     implemented as an owner invitation that only that signed-in account (confirmed email) can accept.
-- Run once by the operator with database privileges. Idempotent. No users are created or changed.

begin;

insert into private.platform_admins (user_id, granted_by)
select id, 'initial setup — authorized by Task-HQ operator in chat, 2026-10-17'
from auth.users where lower(email) = 'team@enternovum.com' and email_confirmed_at is not null
on conflict (user_id) do nothing;

insert into public.organizations (slug, name, preset)
values ('quest-roofing', 'Quest Roofing', 'roofing')
on conflict (slug) do nothing;

insert into public.invitations (org_id, email, role, work_role, invited_by_label, expires_at)
select o.id, 'admin@questroofing.com', 'owner', 'manager', 'Task-HQ platform team', now() + interval '14 days'
from public.organizations o
where o.slug = 'quest-roofing'
  and not exists (select 1 from public.memberships m where m.org_id = o.id and m.role = 'owner')
on conflict do nothing;

insert into public.audit_log (actor_label, org_id, action, detail)
select 'operator: initial setup', o.id, 'platform.setup',
  jsonb_build_object('platform_admin', 'team@enternovum.com', 'organization', 'quest-roofing', 'owner_invitation', 'admin@questroofing.com')
from public.organizations o where o.slug = 'quest-roofing';

commit;
