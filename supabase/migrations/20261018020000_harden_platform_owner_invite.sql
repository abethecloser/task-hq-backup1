-- CANDIDATE — not applied to any database. Release gate for the unified-experience candidate.
--
-- Finding (2026-10-17): platform_invite_owner only checked that the caller is a
-- platform admin. A platform admin could therefore invite any address — including
-- their own — as an additional OWNER of an organization that already has one, accept
-- it, and gain the organization's task data without the owner's approval.
--
-- Fix: platform administration may only bootstrap an organization's FIRST owner.
-- Once an owner exists (or a first-owner invitation is already open), further owners
-- and every other membership come only from that organization's own owners/admins.
-- Operational access for platform staff uses request_access → owner approval.
create or replace function public.platform_invite_owner(p_org uuid, p_email text, p_days integer default 14) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only.'; end if;
  if p_days not between 1 and 30 then raise exception 'Invitations expire after 1–30 days.'; end if;
  -- Serialize against a concurrent first-owner invitation or acceptance for this org.
  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Organization not found.'; end if;
  if exists (select 1 from public.memberships where org_id = p_org and role = 'owner') then
    raise exception 'This organization already has an owner. Only its owners can add owners or members.';
  end if;
  if exists (select 1 from public.invitations where org_id = p_org and role = 'owner' and accepted_at is null and revoked_at is null and expires_at > now()) then
    raise exception 'A first-owner invitation is already open. Revoke it before inviting someone else.';
  end if;
  insert into public.invitations (org_id, email, role, work_role, invited_by, invited_by_label, expires_at)
  values (p_org, v_email, 'owner', 'manager', (select auth.uid()), 'Task-HQ platform team', now() + make_interval(days => p_days))
  returning id into v_id;
  perform private.audit(p_org, 'platform.owner_invited', jsonb_build_object('email', v_email));
  return v_id;
end;
$$;

revoke all on function public.platform_invite_owner(uuid, text, integer) from public, anon;
grant execute on function public.platform_invite_owner(uuid, text, integer) to authenticated;
