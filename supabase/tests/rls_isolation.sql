-- Task-HQ tenant-isolation and authority test. Runs entirely inside one block that
-- ends by raising an exception, so every fixture is rolled back. Output is the
-- exception message: "RESULT pass=<n> fail=<n> | <details>". Last run 2026-10-17: pass=36 fail=0.
do $test$
declare
  a uuid := gen_random_uuid(); -- owner of org X
  b uuid := gen_random_uuid(); -- member of org Y
  c uuid := gen_random_uuid(); -- outsider, confirmed
  u uuid := gen_random_uuid(); -- unconfirmed account
  pa uuid;                      -- existing platform admin
  x uuid; y uuid; inv uuid; req uuid;
  n int; ok int := 0; bad int := 0; notes text := '';
  procedure_failed boolean;
begin
  select user_id into pa from private.platform_admins limit 1;
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (a, 'rls-a@example.test', now(), '{}'), (b, 'rls-b@example.test', now(), '{}'),
    (c, 'rls-c@example.test', now(), '{}'), (u, 'rls-u@example.test', null, '{}');
  insert into public.organizations (slug, name) values ('rls-x', 'RLS X') returning id into x;
  insert into public.organizations (slug, name) values ('rls-y', 'RLS Y') returning id into y;
  insert into public.memberships (org_id, user_id, role, work_role) values (x, a, 'owner', 'manager'), (y, b, 'member', 'field');
  insert into public.workspace_state (org_id, state) values (x, '{"secret":"x"}'), (y, '{"secret":"y"}');

  -- helper to act as a signed-in user
  -- (role switch + JWT claims, exactly how PostgREST runs requests)
  -- ── outsider C sees nothing ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'email', 'rls-c@example.test')::text, true);
  select count(*) into n from public.organizations; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'C sees orgs; '; end if;
  select count(*) into n from public.workspace_state; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'C sees state; '; end if;
  select count(*) into n from public.memberships; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'C sees memberships; '; end if;
  -- direct writes are denied
  begin insert into public.memberships (org_id, user_id, role, work_role) values (x, c, 'owner', 'manager'); bad := bad + 1; notes := notes || 'C inserted membership; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  begin update public.workspace_state set state = '{}' where org_id = x; get diagnostics n = row_count; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'C updated state; '; end if;
  exception when insufficient_privilege then ok := ok + 1; end;
  begin perform 1 from private.platform_admins; bad := bad + 1; notes := notes || 'C read platform_admins; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.platform_create_organization('rls-z', 'RLS Z'); bad := bad + 1; notes := notes || 'C created org; ';
  exception when others then ok := ok + 1; end;
  begin perform public.org_admin_overview(x); bad := bad + 1; notes := notes || 'C read X overview; ';
  exception when others then ok := ok + 1; end;
  -- C requests access to X (confirmed email)
  perform public.request_access('rls-x', 'please');
  execute 'reset role';
  select id into req from public.access_requests where org_id = x and user_id = c and status = 'pending';
  if req is not null then ok := ok + 1; else bad := bad + 1; notes := notes || 'request not created; '; end if;

  -- ── member B of Y: sees Y only, cannot touch X ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'email', 'rls-b@example.test')::text, true);
  select count(*) into n from public.organizations where id = x; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'B sees X; '; end if;
  select count(*) into n from public.workspace_state where org_id = y; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'B cannot see own Y; '; end if;
  select count(*) into n from public.workspace_state where org_id = x; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'B sees X state; '; end if;
  select count(*) into n from public.access_requests where org_id = x; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'B sees X requests; '; end if;
  begin perform public.decide_access_request(req, true, 'member', 'field'); bad := bad + 1; notes := notes || 'B approved X request; ';
  exception when others then ok := ok + 1; end;
  begin perform public.create_invitation(x, 'evil@example.test', 'owner', 'manager', 7); bad := bad + 1; notes := notes || 'B invited into X; ';
  exception when others then ok := ok + 1; end;
  begin perform public.create_invitation(y, 'friend@example.test', 'member', 'field', 7); bad := bad + 1; notes := notes || 'member B invited (should need admin); ';
  exception when others then ok := ok + 1; end;
  begin perform public.org_admin_overview(y); bad := bad + 1; notes := notes || 'member B read admin overview; ';
  exception when others then ok := ok + 1; end;
  execute 'reset role';

  -- ── owner A of X: approves C, invites, cannot reach Y ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'email', 'rls-a@example.test')::text, true);
  select count(*) into n from public.access_requests where id = req; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'A cannot see request; '; end if;
  select jsonb_array_length(public.org_admin_overview(x)->'requests') into n; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'overview misses request; '; end if;
  perform public.decide_access_request(req, true, 'member', 'field');
  select count(*) into n from public.memberships where org_id = x and user_id = c; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'approval did not add C; '; end if;
  begin perform public.create_invitation(y, 'x@example.test', 'member', 'field', 7); bad := bad + 1; notes := notes || 'A invited into Y; ';
  exception when others then ok := ok + 1; end;
  select count(*) into n from public.workspace_state where org_id = y; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'A sees Y state; '; end if;
  inv := public.create_invitation(x, 'rls-u@example.test', 'member', 'field', 7);
  select jsonb_array_length(public.org_admin_overview(x)->'members') into n; if n = 2 then ok := ok + 1; else bad := bad + 1; notes := notes || 'owner overview wrong; '; end if;
  begin perform public.org_admin_overview(y); bad := bad + 1; notes := notes || 'A read Y overview; ';
  exception when others then ok := ok + 1; end;
  begin perform public.remove_member(x, a); bad := bad + 1; notes := notes || 'last owner removed; ';
  exception when others then ok := ok + 1; end;
  execute 'reset role';

  -- ── invitation acceptance needs the matching, confirmed email ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'email', 'rls-b@example.test')::text, true);
  begin perform public.accept_invitation(inv); bad := bad + 1; notes := notes || 'wrong email accepted; ';
  exception when others then ok := ok + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'email', 'rls-u@example.test')::text, true);
  begin perform public.accept_invitation(inv); bad := bad + 1; notes := notes || 'unconfirmed accepted; ';
  exception when others then ok := ok + 1; end;
  execute 'reset role';

  -- ── platform admin: no tenant data without an owner-granted support window ──
  if pa is not null then
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
    select count(*) into n from public.workspace_state; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'platform admin sees state without grant; '; end if;
    begin perform public.org_admin_overview(x); bad := bad + 1; notes := notes || 'platform admin read overview; ';
    exception when others then ok := ok + 1; end;
    select jsonb_array_length(public.platform_list_organizations()) into n; if n >= 2 then ok := ok + 1; else bad := bad + 1; notes := notes || 'platform list failed; '; end if;
    execute 'reset role';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    perform public.grant_support_access(x, 2, 'RLS test window');
    execute 'reset role';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
    select count(*) into n from public.workspace_state where org_id = x; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'support grant ineffective; '; end if;
    select count(*) into n from public.workspace_state where org_id = y; if n = 0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'support leaks to Y; '; end if;
    execute 'reset role';
  end if;

  -- ── anonymous ──
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform 1 from public.organizations limit 1; bad := bad + 1; notes := notes || 'anon read orgs; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.my_context(); bad := bad + 1; notes := notes || 'anon called my_context; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.org_admin_overview(x); bad := bad + 1; notes := notes || 'anon called overview; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.rls_auto_enable(); bad := bad + 1; notes := notes || 'anon called rls_auto_enable; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  execute 'reset role';

  raise exception 'RESULT pass=% fail=% | %', ok, bad, coalesce(nullif(notes, ''), 'all checks passed');
end
$test$;
