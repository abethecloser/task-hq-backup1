-- Owners/admins need to see who they are managing (emails live in auth.users,
-- which clients can't read). Read-only; scoped to one organization the caller administers.
create function public.org_admin_overview(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then raise exception 'Only owners and admins can view member administration.'; end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'full_name', p.full_name, 'role', m.role, 'work_role', m.work_role, 'since', m.created_at) order by m.created_at)
      from public.memberships m join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
      where m.org_id = p_org), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'email', u.email, 'full_name', p.full_name, 'message', r.message, 'created_at', r.created_at) order by r.created_at)
      from public.access_requests r join auth.users u on u.id = r.user_id left join public.profiles p on p.id = r.user_id
      where r.org_id = p_org and r.status = 'pending'), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'work_role', i.work_role, 'expires_at', i.expires_at) order by i.created_at)
      from public.invitations i
      where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()), '[]'::jsonb));
end;
$$;
revoke all on function public.org_admin_overview(uuid) from public, anon;
grant execute on function public.org_admin_overview(uuid) to authenticated;
