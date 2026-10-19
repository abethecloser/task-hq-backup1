-- People & Access: one read-only status per staged person, from the authoritative records.
-- Identity is staged_contacts.id; the account resolves through employee_auth_links first, then a
-- membership whose account email matches. Activation validity mirrors
-- private.activate_employee_on_auth_insert / employee_activation_lookup exactly, so an edited,
-- expired or revoked code is never shown as sent. Unbound legacy code rows are not considered.
-- Writes are unchanged: employee-activation (generate/revoke) and the invitation functions.

create function public.org_people_access(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Organization administrator required.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.full_name, 'email', c.email,
      'role', c.provisional_role, 'work_role', c.provisional_work_role,
      'affiliation_confirmed', c.affiliation_confirmed,
      'member', case when mem.user_id is null then null else jsonb_build_object('user_id', mem.user_id, 'role', mem.role, 'work_role', mem.work_role) end,
      'invitation', case when inv.id is null then null else jsonb_build_object('id', inv.id, 'role', inv.role, 'work_role', inv.work_role, 'expires_at', inv.expires_at, 'expired', inv.expires_at <= now()) end,
      'activation', case when code.id is null then null else jsonb_build_object('expires_at', code.expires_at, 'state', cs.state) end,
      'status', case
        when mem.user_id is not null then 'active'
        when cs.state = 'valid' then 'link-sent'
        when inv.id is not null and inv.expires_at > now() then 'invited'
        when cs.state = 'invalidated' then 'link-invalid'
        when cs.state in ('expired', 'revoked') then 'link-expired'
        when inv.id is not null then 'invite-expired'
        when c.email is null then 'needs-email'
        else 'ready' end
    ) order by c.full_name)
    from public.staged_contacts c
    left join lateral (
      select m.user_id, m.role, m.work_role from public.memberships m
      where m.org_id = p_org and (
        m.user_id in (select l.user_id from public.employee_auth_links l where l.employee_id = c.id)
        or (c.email is not null and m.user_id in (select u.id from auth.users u where lower(u.email) = c.email)))
      limit 1) mem on true
    left join lateral (
      select i.* from public.invitations i
      where i.org_id = p_org and c.email is not null and i.email = c.email and i.accepted_at is null and i.revoked_at is null
      order by i.created_at desc limit 1) inv on true
    left join lateral (
      select a.* from public.team_activation_codes a where a.employee_id = c.id order by a.created_at desc limit 1) code on true
    cross join lateral (select case
      when code.id is null then null
      when code.redeemed_at is not null then 'redeemed'
      when code.revoked_at is not null then 'revoked'
      when code.expires_at <= now() then 'expired'
      when not c.affiliation_confirmed or c.updated_at is distinct from code.employee_version
        or c.provisional_role is distinct from code.role or c.provisional_work_role is distinct from code.work_role
        or not exists (select 1 from public.memberships x where x.org_id = p_org and x.user_id = code.issued_by and x.role in ('owner', 'admin'))
        or (code.role = 'admin' and not exists (select 1 from public.memberships x where x.org_id = p_org and x.user_id = code.issued_by and x.role = 'owner'))
        then 'invalidated'
      else 'valid' end as state) cs
    where c.org_id = p_org and c.archived_at is null), '[]'::jsonb);
end;
$$;

revoke all on function public.org_people_access(uuid) from public, anon;
grant execute on function public.org_people_access(uuid) to authenticated;
