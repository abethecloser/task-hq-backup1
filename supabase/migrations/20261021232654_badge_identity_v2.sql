-- Badge identity v2 (2026-10-21): a badge proves who is at the phone; it records no attendance.
-- Attendance has one source of truth: public.shift_sessions / shift_records (shift_command).
-- badge_verify keeps badge_scan's phone binding and new-phone approval, and requires the
-- signed-in account (verified by the badge-check-in function) to be the badge's owner.
-- badge_scan and the existing work_check_ins rows are left in place as history; the
-- badge-check-in function no longer calls badge_scan, so no new in/out toggles are written.
-- Rollback: drop function public.badge_verify(text, text, uuid); redeploy badge-check-in v2.

create function public.badge_verify(p_code_hash text, p_device_hash text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.work_badges; v_role public.org_role; v_name text;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_device_hash !~ '^[0-9a-f]{64}$' or p_user is null then return jsonb_build_object('result', 'unavailable'); end if;
  select * into b from public.work_badges where code_hash = p_code_hash and revoked_at is null for update;
  if not found then return jsonb_build_object('result', 'unavailable'); end if;
  -- Never another person's badge: nothing is bound or touched for a mismatched account.
  if b.user_id <> p_user then return jsonb_build_object('result', 'mismatch'); end if;
  select m.role into v_role from public.memberships m where m.org_id = b.org_id and m.user_id = b.user_id;
  if v_role is null or v_role in ('owner', 'admin') then return jsonb_build_object('result', 'unavailable'); end if;
  select coalesce(p.full_name, '') into v_name from public.profiles p where p.id = b.user_id;

  if b.device_hash is null then
    update public.work_badges set device_hash = p_device_hash where id = b.id;
  elsif b.device_hash <> p_device_hash then
    if not exists (select 1 from public.work_check_ins where user_id = b.user_id and org_id = b.org_id and kind = 'device' and status = 'pending' and device_hash = p_device_hash) then
      insert into public.work_check_ins (org_id, user_id, kind, device_hash, note) values (b.org_id, b.user_id, 'device', p_device_hash, 'Scanned from a new phone');
      perform private.audit(b.org_id, 'badge.new_phone', jsonb_build_object('user_id', b.user_id));
    end if;
    return jsonb_build_object('result', 'device-pending', 'name', coalesce(v_name, ''));
  end if;
  update public.work_badges set last_used_at = now() where id = b.id;
  perform private.audit(b.org_id, 'badge.verified', jsonb_build_object('user_id', b.user_id));
  return jsonb_build_object('result', 'ok', 'name', coalesce(v_name, ''), 'org_id', b.org_id);
end $$;
revoke all on function public.badge_verify(text, text, uuid) from public, anon, authenticated;
grant execute on function public.badge_verify(text, text, uuid) to service_role;
