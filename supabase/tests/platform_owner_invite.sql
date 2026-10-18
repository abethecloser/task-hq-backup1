-- Platform-admin boundary test for 20261018020000_harden_platform_owner_invite.sql.
-- NOT YET EXECUTED. Run only on an authorized, disposable staging database after the
-- candidate migration. Like rls_isolation.sql it rolls everything back and reports
-- "RESULT pass=<n> fail=<n> | <details>".
do $test$
declare
  o uuid := gen_random_uuid();  -- existing owner of org X
  pa uuid;                       -- existing platform admin
  x uuid; e uuid; inv uuid;
  n int; ok int := 0; bad int := 0; notes text := '';
begin
  select user_id into pa from private.platform_admins limit 1;
  if pa is null then raise exception 'RESULT pass=0 fail=1 | no platform admin to test with'; end if;
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (o, 'poi-owner@example.test', now(), '{}');
  insert into public.organizations (slug, name) values ('poi-x', 'POI X') returning id into x;
  insert into public.organizations (slug, name) values ('poi-empty', 'POI Empty') returning id into e;
  insert into public.memberships (org_id, user_id, role, work_role) values (x, o, 'owner', 'manager');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  -- 1. Cannot add an owner to an organization that already has one.
  begin perform public.platform_invite_owner(x, 'intruder@example.test', 7); bad := bad + 1; notes := notes || 'invited 2nd owner into owned org; ';
  exception when others then ok := ok + 1; end;
  -- 2. Can bootstrap the first owner of an empty organization.
  begin select public.platform_invite_owner(e, 'first@example.test', 7) into inv; ok := ok + 1;
  exception when others then bad := bad + 1; notes := notes || 'first-owner bootstrap failed: ' || sqlerrm || '; '; end;
  -- 3. Cannot open a second first-owner invitation while one is open.
  begin perform public.platform_invite_owner(e, 'second@example.test', 7); bad := bad + 1; notes := notes || 'two open first-owner invitations; ';
  exception when others then ok := ok + 1; end;
  -- 4. Platform admin still sees no task data of X.
  select count(*) into n from public.workspace_state where org_id = x; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'platform admin reads X state; '; end if;
  -- 5. Requesting operational access creates a pending request, not a membership.
  perform public.request_access('poi-x', 'platform staff');
  execute 'reset role';
  select count(*) into n from public.memberships where org_id = x and user_id = pa; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'request granted membership; '; end if;
  select count(*) into n from public.access_requests where org_id = x and user_id = pa and status = 'pending'; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'no pending request; '; end if;

  raise exception 'RESULT pass=% fail=% | %', ok, bad, coalesce(nullif(notes, ''), 'all checks passed');
end;
$test$;
