-- Server-side delivery for existing employee-bound activation codes.
-- Raw codes are never stored: only their SHA-256 hashes remain in team_activation_codes.
alter table public.team_activation_codes
  add column email_delivery_status text not null default 'not-requested'
    check (email_delivery_status in ('not-requested', 'pending', 'sent', 'failed')),
  add column email_delivery_attempted_at timestamptz,
  add column email_delivery_sent_at timestamptz;

-- A valid, existing code can be mailed again without rotating it. Replacing a live link
-- requires an explicit confirmation from the authorized caller.
create function public.employee_activation_issue(
  p_org uuid,
  p_employee uuid,
  p_hash text,
  p_replace boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_org_admin(p_org) then
    raise exception 'Organization administrator required.';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid activation code hash.';
  end if;
  if not exists (
    select 1 from public.staged_contacts c
    where c.id = p_employee and c.org_id = p_org and c.archived_at is null
      and c.email is not null and btrim(c.email) <> ''
  ) then
    raise exception 'Employee email is required before issuing an invitation.';
  end if;
  if not p_replace and exists (
    select 1 from public.team_activation_codes a
    where a.employee_id = p_employee and a.org_id = p_org
      and a.revoked_at is null and a.redeemed_at is null and a.expires_at > now()
  ) then
    raise exception 'An active setup link already exists. Confirm replacement before issuing another.';
  end if;
  return public.employee_activation_admin(p_org, 'generate', p_employee, p_hash);
end;
$$;

revoke all on function public.employee_activation_issue(uuid, uuid, text, boolean)
  from public, anon, service_role;
grant execute on function public.employee_activation_issue(uuid, uuid, text, boolean)
  to authenticated;

-- User actions require current workspace-admin authorization. The record action is reserved
-- for the Edge Function's service-role client and accepts only a delivery outcome.
create function public.employee_activation_delivery(
  p_action text,
  p_org uuid default null,
  p_employee uuid default null,
  p_hash text default null,
  p_activation uuid default null,
  p_status text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a public.team_activation_codes;
  c public.staged_contacts;
  v_org_name text;
  v_delivery jsonb;
begin
  if p_action = 'record' then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Service role required.' using errcode = '42501';
    end if;
    if p_status not in ('sent', 'failed') then
      raise exception 'Invalid delivery status.';
    end if;
    update public.team_activation_codes
      set email_delivery_status = p_status,
          email_delivery_attempted_at = coalesce(email_delivery_attempted_at, now()),
          email_delivery_sent_at = case when p_status = 'sent' then now() else null end
      where id = p_activation and email_delivery_status = 'pending'
        and revoked_at is null and redeemed_at is null
      returning jsonb_build_object('id', id, 'status', email_delivery_status) into v_delivery;
    if v_delivery is null then
      raise exception 'Pending activation delivery was not found.';
    end if;
    return v_delivery;
  end if;

  if not private.is_org_admin(p_org) then
    raise exception 'Organization administrator required.';
  end if;

  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', latest.employee_id,
        'status', latest.email_delivery_status,
        'attempted_at', latest.email_delivery_attempted_at,
        'sent_at', latest.email_delivery_sent_at
      ) order by contact_row.full_name)
      from public.staged_contacts contact_row
      join lateral (
        select code_row.employee_id, code_row.email_delivery_status,
          code_row.email_delivery_attempted_at, code_row.email_delivery_sent_at
        from public.team_activation_codes code_row
        where code_row.employee_id = contact_row.id and code_row.org_id = p_org
        order by code_row.created_at desc limit 1
      ) latest on true
      where contact_row.org_id = p_org and contact_row.archived_at is null
    ), '[]'::jsonb);
  end if;

  if p_action <> 'prepare' or p_employee is null or p_hash is null
      or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid delivery request.';
  end if;

  select * into a from public.team_activation_codes
    where employee_id = p_employee and org_id = p_org and code_hash = p_hash
    for update;
  if not found or a.revoked_at is not null or a.redeemed_at is not null or a.expires_at <= now() then
    raise exception 'Setup link unavailable.';
  end if;

  select * into c from public.staged_contacts
    where id = p_employee and org_id = p_org and archived_at is null;
  if not found or not c.affiliation_confirmed or c.email is null or btrim(c.email) = ''
      or c.updated_at is distinct from a.employee_version
      or c.provisional_role is distinct from a.role
      or c.provisional_work_role is distinct from a.work_role
      or not exists (
        select 1 from public.memberships m
        where m.org_id = p_org and m.user_id = a.issued_by and m.role in ('owner', 'admin')
      )
      or (a.role = 'admin' and not exists (
        select 1 from public.memberships m
        where m.org_id = p_org and m.user_id = a.issued_by and m.role = 'owner'
      ))
      or exists (select 1 from public.employee_auth_links l where l.employee_id = c.id)
      or exists (
        select 1 from public.memberships m join auth.users u on u.id = m.user_id
        where m.org_id = p_org and lower(u.email) = lower(c.email)
      ) then
    raise exception 'Employee or setup link is no longer available.';
  end if;

  select o.name into v_org_name from public.organizations o where o.id = p_org;
  if v_org_name is null then
    raise exception 'Workspace unavailable.';
  end if;

  update public.team_activation_codes set
    email_delivery_status = 'pending',
    email_delivery_attempted_at = now(),
    email_delivery_sent_at = null
    where id = a.id;

  return jsonb_build_object(
    'id', a.id,
    'email', c.email,
    'name', c.full_name,
    'organization', v_org_name,
    'expires_at', a.expires_at
  );
end;
$$;

revoke all on function public.employee_activation_delivery(text, uuid, uuid, text, uuid, text)
  from public, anon;
grant execute on function public.employee_activation_delivery(text, uuid, uuid, text, uuid, text)
  to authenticated, service_role;
