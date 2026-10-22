-- Identity v1 (2026-10-20). One invite path: a personal setup link that lasts seven days, works
-- once and can be revoked. Redemption requires an account whose email the person has just proven
-- with a six-digit code (Supabase Auth); the endpoint no longer creates accounts for a typed email.
--
-- Built on the production definitions of employee_activation_v1 (verified identical by body hash
-- on 2026-10-20). Changes nothing else: existing codes, links, memberships, invitations and the
-- legacy Auth trigger stay as they are (the trigger acts only on server-set app metadata, which
-- nothing sets any more). Apply this file alone, after the migration history is reconciled.

-- Only change: new setup links last seven days instead of 24 hours.
create or replace function public.employee_activation_admin(p_org uuid, p_action text default 'list', p_employee uuid default null, p_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.staged_contacts; a public.team_activation_codes;
begin
 if not private.is_org_admin(p_org) then raise exception 'Organization administrator required.'; end if;
 if p_action <> 'list' then
  select * into c from public.staged_contacts where id=p_employee and org_id=p_org and archived_at is null for update;
  if not found then raise exception 'Employee unavailable.'; end if;
  if p_action='generate' then
   if not c.affiliation_confirmed then raise exception 'Confirm employee affiliation first.'; end if;
   if c.provisional_role='admin' and private.role_in(p_org)<>'owner' then raise exception 'Only an owner can grant admin.'; end if;
   if exists(select 1 from public.employee_auth_links where employee_id=c.id) or exists(
    select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.org_id=p_org and lower(u.email)=c.email
   ) then raise exception 'Employee already activated.'; end if;
   update public.team_activation_codes set revoked_at=now() where employee_id=c.id and revoked_at is null and redeemed_at is null;
   insert into public.team_activation_codes(employee_name,employee_ref,employee_id,org_id,code_hash,role,work_role,employee_version,issued_by,expires_at)
   values(c.full_name,c.id::text,c.id,p_org,p_hash,c.provisional_role,c.provisional_work_role,c.updated_at,auth.uid(),now()+interval '7 days') returning * into a;
   perform private.audit(p_org,'activation.generated',jsonb_build_object('employee',c.id,'activation',a.id));
   return jsonb_build_object('id',a.id,'expires_at',a.expires_at);
  elsif p_action='revoke' then
   update public.team_activation_codes set revoked_at=now() where employee_id=c.id and redeemed_at is null and revoked_at is null;
   perform private.audit(p_org,'activation.revoked',jsonb_build_object('employee',c.id));
  else raise exception 'Unknown activation action.'; end if;
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',contact.id,'name',contact.full_name,'role',contact.provisional_role,
  'affiliation_confirmed',contact.affiliation_confirmed,'expires_at',latest.expires_at,
  'status',case when l.user_id is not null or m.user_id is not null then 'active' when latest.revoked_at is not null then 'revoked'
   when latest.expires_at<=now() then 'expired' when latest.id is not null then 'pending' else 'not-issued' end) order by contact.full_name)
  from public.staged_contacts contact
  left join public.employee_auth_links l on l.employee_id=contact.id
  left join lateral(select mm.user_id from public.memberships mm join auth.users u on u.id=mm.user_id where mm.org_id=p_org and lower(u.email)=contact.email limit 1)m on true
  left join lateral(select aa.* from public.team_activation_codes aa where aa.employee_id=contact.id order by aa.created_at desc limit 1)latest on true
  where contact.org_id=p_org and contact.archived_at is null),'[]'::jsonb);
end $$;

-- Server only (employee-activation endpoint, service role). The endpoint has verified the
-- caller's session and that it comes from a fresh email code; this re-checks everything else.
create function public.employee_activation_redeem(p_hash text, p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.team_activation_codes; c public.staged_contacts; v_email text; v_confirmed timestamptz; v_password boolean;
begin
 select lower(u.email), u.email_confirmed_at, coalesce(u.encrypted_password,'')<>'' into v_email, v_confirmed, v_password from auth.users u where u.id=p_user;
 if v_email is null or v_confirmed is null then return jsonb_build_object('result','unverified'); end if;
 select * into a from public.team_activation_codes where code_hash=p_hash and employee_id is not null;
 if not found then return jsonb_build_object('result','unavailable'); end if;
 -- Same lock order as the Auth trigger: employee, then code.
 select * into c from public.staged_contacts where id=a.employee_id for update;
 select * into a from public.team_activation_codes where id=a.id for update;
 if a.redeemed_at is not null then
  -- A lost reply: the same person asking again learns it worked, nobody else learns anything.
  if a.redeemed_by=p_user then return jsonb_build_object('result','activated','org',a.org_id,'has_password',v_password); end if;
  return jsonb_build_object('result','unavailable');
 end if;
 if a.revoked_at is not null or a.expires_at<=now() then return jsonb_build_object('result','unavailable'); end if;
 perform 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role in ('owner','admin') for share;
 if not found
  or c.archived_at is not null or not c.affiliation_confirmed or c.updated_at<>a.employee_version
  or c.org_id<>a.org_id or c.provisional_role<>a.role or c.provisional_work_role<>a.work_role
  or (a.role='admin' and not exists(select 1 from public.memberships where org_id=a.org_id and user_id=a.issued_by and role='owner'))
 then return jsonb_build_object('result','unavailable'); end if;
 -- The email the manager has on file, if any, is the one that must be proven.
 if coalesce(c.email,'')<>'' and lower(c.email)<>v_email then return jsonb_build_object('result','email-mismatch'); end if;
 -- Existing memberships are never changed by a setup link.
 if exists(select 1 from public.memberships where org_id=a.org_id and user_id=p_user)
  or exists(select 1 from public.employee_auth_links where org_id=a.org_id and user_id=p_user)
  or exists(select 1 from public.employee_auth_links where employee_id=c.id)
 then return jsonb_build_object('result','already-member'); end if;
 insert into public.employee_auth_links(employee_id,org_id,user_id,activation_id) values(c.id,c.org_id,p_user,a.id);
 insert into public.memberships(org_id,user_id,role,work_role,added_by) values(c.org_id,p_user,a.role,a.work_role,a.issued_by);
 update public.staged_contacts set email=v_email,updated_at=now() where id=c.id;
 update public.team_activation_codes set redeemed_at=now(),redeemed_by=p_user,claim_email=v_email where id=a.id;
 update public.access_requests set status='cancelled' where org_id=a.org_id and user_id=p_user and status='pending';
 perform private.audit(c.org_id,'activation.completed',jsonb_build_object('employee',c.id,'user',p_user,'activation',a.id,'verified','email-code'));
 return jsonb_build_object('result','activated','org',a.org_id,'has_password',v_password);
end $$;
revoke all on function public.employee_activation_redeem(text,uuid) from public,anon,authenticated;
grant execute on function public.employee_activation_redeem(text,uuid) to service_role;
