-- Team-staging isolation and activation test (20261018030000_team_staging.sql).
-- Like rls_isolation.sql: one block, every fixture rolled back by the final exception.
-- Output: "RESULT pass=<n> fail=<n> | <details>". Run only on an authorized database.
do $test$
declare
  a uuid := gen_random_uuid();   -- owner of org X
  b uuid := gen_random_uuid();   -- member of org X
  d uuid := gen_random_uuid();   -- owner of org Y
  pa uuid := gen_random_uuid();  -- platform admin, not a member of X
  s uuid := gen_random_uuid();   -- the staged person's own account (created later, as at sign-up)
  x uuid; y uuid; cx uuid; cy uuid; cboss uuid; inv uuid; n int; j jsonb; st text;
  ok int := 0; bad int := 0; notes text := '';
  users0 int; members0 int; invites0 int;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (a, 'ts-a@example.test', now(), '{}'), (b, 'ts-b@example.test', now(), '{}'),
    (d, 'ts-d@example.test', now(), '{}'), (pa, 'ts-pa@example.test', now(), '{}');
  insert into private.platform_admins (user_id, granted_by) values (pa, 'team_staging test');
  insert into public.organizations (slug, name) values ('ts-x', 'TS X') returning id into x;
  insert into public.organizations (slug, name) values ('ts-y', 'TS Y') returning id into y;
  insert into public.memberships (org_id, user_id, role, work_role) values (x, a, 'owner', 'manager'), (x, b, 'member', 'field'), (y, d, 'owner', 'manager');
  select count(*) into users0 from auth.users; select count(*) into members0 from public.memberships; select count(*) into invites0 from public.invitations;

  -- Staging (as the SQL operator) creates no accounts, memberships or invitations.
  insert into public.staged_contacts (org_id, staging_key, full_name, email, provisional_role, provisional_work_role)
    values (x, 'sam-staged', 'Sam Staged', 'ts-s@example.test', 'member', 'estimator') returning id into cx;
  insert into public.staged_contacts (org_id, staging_key, full_name, email) values (x, 'boss', 'Boss Staged', null) returning id into cboss;
  insert into public.staged_contacts (org_id, staging_key, full_name, email) values (y, 'yara', 'Yara Y', 'ts-yara@example.test') returning id into cy;
  insert into public.staged_assignments (org_id, contact_id, title) values (x, cx, 'Measure garage roof');
  update public.staged_contacts set reports_to_contact = cboss where id = cx;
  update public.staged_contacts set reports_to_user = a where id = cboss;
  if (select count(*) from auth.users) = users0 and (select count(*) from public.memberships) = members0 and (select count(*) from public.invitations) = invites0
    then ok := ok + 1; else bad := bad + 1; notes := notes || 'staging created identity/membership/invitation; '; end if;

  -- Idempotent upsert by (org, staging_key): no duplicate person.
  insert into public.staged_contacts (org_id, staging_key, full_name, email) values (x, 'sam-staged', 'Sam Staged', 'ts-s@example.test')
    on conflict (org_id, staging_key) do update set full_name = excluded.full_name;
  select count(*) into n from public.staged_contacts where org_id = x and staging_key = 'sam-staged'; if n = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'upsert duplicated; '; end if;
  -- Same email twice in one org is refused.
  begin insert into public.staged_contacts (org_id, staging_key, full_name, email) values (x, 'sam-again', 'Sam Again', 'ts-s@example.test'); bad := bad + 1; notes := notes || 'duplicate email staged; ';
  exception when unique_violation then ok := ok + 1; end;
  -- Owners are never staged.
  begin insert into public.staged_contacts (org_id, staging_key, full_name, provisional_role) values (x, 'own', 'Own', 'owner'); bad := bad + 1; notes := notes || 'owner staged; ';
  exception when check_violation then ok := ok + 1; end;
  -- Reporting lines cannot cross tenants.
  begin update public.staged_contacts set reports_to_contact = cx where id = cy; bad := bad + 1; notes := notes || 'cross-org reports_to_contact; ';
  exception when foreign_key_violation then ok := ok + 1; end;
  begin update public.staged_contacts set reports_to_contact = null, reports_to_user = d where id = cx; bad := bad + 1; notes := notes || 'reports to non-member; ';
  exception when foreign_key_violation then ok := ok + 1; end;
  begin insert into public.staged_assignments (org_id, contact_id, title) values (y, cx, 'cross'); bad := bad + 1; notes := notes || 'cross-org assignment; ';
  exception when foreign_key_violation then ok := ok + 1; end;

  -- ── Owner A of X ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'email', 'ts-a@example.test')::text, true);
  j := public.org_staging_overview(x);
  if jsonb_array_length(j) = 2 then ok := ok + 1; else bad := bad + 1; notes := notes || 'owner sees ' || jsonb_array_length(j) || ' staged; '; end if;
  select e->>'state' into st from jsonb_array_elements(j) e where e->>'key' = 'sam-staged';
  if st = 'not-invited' then ok := ok + 1; else bad := bad + 1; notes := notes || 'state ' || coalesce(st, 'null') || '; '; end if;
  if (select jsonb_array_length(e->'planned') from jsonb_array_elements(j) e where e->>'key' = 'sam-staged') = 1 then ok := ok + 1; else bad := bad + 1; notes := notes || 'planned work missing; '; end if;
  if not exists (select 1 from jsonb_array_elements(j) e where e->>'key' = 'yara') then ok := ok + 1; else bad := bad + 1; notes := notes || 'owner sees other org; '; end if;
  begin perform public.org_staging_overview(y); bad := bad + 1; notes := notes || 'A read Y; '; exception when others then ok := ok + 1; end;
  begin perform 1 from public.staged_contacts; bad := bad + 1; notes := notes || 'direct table read allowed; '; exception when insufficient_privilege then ok := ok + 1; end;
  -- Invitation needs confirmed affiliation first.
  begin perform public.invite_staged_contact(cx, 7); bad := bad + 1; notes := notes || 'invited unconfirmed; '; exception when others then ok := ok + 1; end;
  perform public.confirm_staged_affiliation(cx, true);
  -- Contacts without email can't be invited.
  perform public.confirm_staged_affiliation(cboss, true);
  begin perform public.invite_staged_contact(cboss, 7); bad := bad + 1; notes := notes || 'invited without email; '; exception when others then ok := ok + 1; end;
  inv := public.invite_staged_contact(cx, 7);
  select e->>'state' into st from jsonb_array_elements(public.org_staging_overview(x)) e where e->>'key' = 'sam-staged';
  if st = 'invited' then ok := ok + 1; else bad := bad + 1; notes := notes || 'after invite state ' || coalesce(st, 'null') || '; '; end if;
  execute 'reset role';
  -- The invitation carries the provisional roles; still no membership.
  if exists (select 1 from public.invitations where id = inv and role = 'member' and work_role = 'estimator' and email = 'ts-s@example.test') then ok := ok + 1; else bad := bad + 1; notes := notes || 'invitation roles wrong; '; end if;
  if (select count(*) from public.memberships) = members0 then ok := ok + 1; else bad := bad + 1; notes := notes || 'invite created membership; '; end if;

  -- ── Member B of X, owner D of Y, platform admin PA, anon: no access ──
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.org_staging_overview(x); bad := bad + 1; notes := notes || 'member B read staging; '; exception when others then ok := ok + 1; end;
  begin perform public.confirm_staged_affiliation(cx, false); bad := bad + 1; notes := notes || 'member B changed affiliation; '; exception when others then ok := ok + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  begin perform public.org_staging_overview(x); bad := bad + 1; notes := notes || 'Y owner read X staging; '; exception when others then ok := ok + 1; end;
  begin perform public.invite_staged_contact(cx, 7); bad := bad + 1; notes := notes || 'Y owner invited X contact; '; exception when others then ok := ok + 1; end;
  perform set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  begin perform public.org_staging_overview(x); bad := bad + 1; notes := notes || 'platform admin read staging; '; exception when others then ok := ok + 1; end;
  execute 'reset role';
  execute 'set local role anon';
  begin perform public.org_staging_overview(x); bad := bad + 1; notes := notes || 'anon read staging; '; exception when others then ok := ok + 1; end;
  execute 'reset role';
  execute 'set local role service_role';
  begin perform 1 from public.staged_contacts; bad := bad + 1; notes := notes || 'service_role read staging; '; exception when insufficient_privilege then ok := ok + 1; end;
  execute 'reset role';

  -- ── Activation: the person creates an account with that email and accepts ──
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (s, 'ts-s@example.test', now(), '{}');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform public.accept_invitation(inv);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select e->>'state' into st from jsonb_array_elements(public.org_staging_overview(x)) e where e->>'key' = 'sam-staged';
  if st = 'active' then ok := ok + 1; else bad := bad + 1; notes := notes || 'after accept state ' || coalesce(st, 'null') || '; '; end if;
  -- An active member can't be invited again from staging.
  begin perform public.invite_staged_contact(cx, 7); bad := bad + 1; notes := notes || 're-invited active member; '; exception when others then ok := ok + 1; end;
  execute 'reset role';
  if exists (select 1 from public.memberships where org_id = x and user_id = s and role = 'member' and work_role = 'estimator') then ok := ok + 1; else bad := bad + 1; notes := notes || 'membership roles wrong; '; end if;
  -- The owner's membership is untouched throughout.
  if exists (select 1 from public.memberships where org_id = x and user_id = a and role = 'owner' and work_role = 'manager') then ok := ok + 1; else bad := bad + 1; notes := notes || 'owner membership changed; '; end if;

  raise exception 'RESULT pass=% fail=% | %', ok, bad, coalesce(nullif(notes, ''), 'all checks passed');
end;
$test$;
