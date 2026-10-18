-- Synthetic fixtures only. Run after all migrations, with a database operator.
-- Transaction rolls back on success; psql ON_ERROR_STOP exits nonzero on failure.
\set ON_ERROR_STOP on
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r uuid := gen_random_uuid(); f uuid := gen_random_uuid();
  x uuid := gen_random_uuid(); y uuid := gen_random_uuid();
  source_ text := 'test-' || gen_random_uuid()::text;
  envelope_ jsonb; receipt_ jsonb; duplicate_ jsonb; state_ jsonb; n int;
  passed int := 0; key_ text; channel_ text;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (a,'intake-owner@example.test',now(),'{}'),(b,'intake-other@example.test',now(),'{}'),(r,'intake-reviewer@example.test',now(),'{}'),(f,'intake-follow-up@example.test',now(),'{}');
  insert into public.organizations(id,slug,name,preset) values (x,'intake-' || substr(x::text,1,12),'Construction fixture','general'),(y,'intake-' || substr(y::text,1,12),'Roofing fixture','roofing');
  insert into public.memberships(org_id,user_id,role,work_role) values (x,a,'owner','manager'),(y,b,'owner','manager'),(x,r,'reviewer','reviewer'),(x,f,'member','sales');
  insert into public.workspace_state(org_id,state) values
    (x,jsonb_build_object('tasks','[]'::jsonb,'leads','[]'::jsonb,'events','[]'::jsonb,'rev',1)),
    (y,jsonb_build_object('tasks','[]'::jsonb,'leads','[]'::jsonb,'events','[]'::jsonb,'rev',1));
  insert into private.intake_sources(id,org_id,channel,source_url,follow_up_owner,approved_by,approval_note,enabled)
    values (source_,x,'website','https://example.test/',a,a,'Synthetic isolated test approval',true);
  envelope_ := jsonb_build_object('version',1,'sourceId',source_,'externalId','fixture-1','receivedAt','2026-10-17T00:00:00Z',
    'contact',jsonb_build_object('name',' Synthetic inquiry ','email','FIXTURE@example.test','phone','(602) 555-0100'),
    'inquiry',jsonb_build_object('need',' Synthetic estimate ','address','Synthetic address'));

  execute 'set local role anon';
  begin perform public.receive_intake(envelope_); raise exception 'ASSERT anonymous intake allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  begin perform 1 from public.intake_events; raise exception 'ASSERT anonymous receipts visible';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.receive_intake(envelope_); raise exception 'ASSERT missing JWT subject allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  begin perform public.receive_intake(envelope_); raise exception 'ASSERT foreign tenant intake allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'role','authenticated')::text,true);
  begin perform public.receive_intake(envelope_); raise exception 'ASSERT reviewer intake allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin insert into private.intake_sources(id,org_id,channel,source_url,follow_up_owner,approved_by,approval_note)
    values ('forged',x,'website','https://example.test/',a,a,'forged mapping'); raise exception 'ASSERT client mapping allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  begin update public.workspace_state set state='{}' where org_id=x; get diagnostics n=row_count;
    if n <> 0 then raise exception 'ASSERT direct task write allowed'; end if; passed := passed+1;
  exception when insufficient_privilege then passed := passed+1; end;

  for key_ in select unnest(array['version','sourceId','externalId','receivedAt','contact','inquiry']) loop
    begin perform public.receive_intake(envelope_ - key_); raise exception 'ASSERT missing field accepted: %',key_;
    exception when invalid_parameter_value then passed := passed+1; end;
  end loop;
  begin perform public.receive_intake(jsonb_set(envelope_,'{contact}',jsonb_build_object('name','No contact'))); raise exception 'ASSERT no contact accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.receive_intake(jsonb_set(envelope_,'{contact,email}','"invalid"')); raise exception 'ASSERT invalid email accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.receive_intake(jsonb_set(envelope_,'{contact,phone}','"abc123"')); raise exception 'ASSERT invalid phone accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.receive_intake(envelope_ || jsonb_build_object('orgId',y)); raise exception 'ASSERT client tenant override accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.receive_intake(jsonb_set(envelope_,'{sourceId}','"construction.unmapped"')); raise exception 'ASSERT unmapped source accepted';
  exception when insufficient_privilege then passed := passed+1; end;
  receipt_ := public.receive_intake(envelope_);
  if (receipt_->>'status') is distinct from 'accepted' or (receipt_->>'orgId') is distinct from x::text then raise exception 'ASSERT bad receipt'; end if; passed := passed+1;
  duplicate_ := public.receive_intake(jsonb_set(envelope_,'{contact,email}','"fixture@example.test"'));
  if (duplicate_->>'status') is distinct from 'duplicate' or (duplicate_->>'receiptId') is distinct from (receipt_->>'receiptId') then raise exception 'ASSERT retry duplicated'; end if; passed := passed+1;
  begin perform public.receive_intake(jsonb_set(envelope_,'{inquiry,need}','"Different request"')); raise exception 'ASSERT changed retry accepted';
  exception when unique_violation then passed := passed+1; end;
  select state into state_ from public.workspace_state where org_id=x;
  if jsonb_array_length(state_->'leads') <> 1 or jsonb_array_length(state_->'tasks') <> 1 or jsonb_array_length(state_->'events') <> 1
    or state_->'leads'->0->>'simulated' <> 'false' or state_->'leads'->0->>'email' <> 'fixture@example.test'
    or state_->'tasks'->0->>'owner' <> a::text or state_->'tasks'->0->>'leadId' <> receipt_->>'leadId'
    or state_->'leads'->0->>'followUpTaskId' <> receipt_->>'taskId'
  then raise exception 'ASSERT lead/task/event not atomic or linked'; end if; passed := passed+1;
  begin insert into public.intake_events(org_id,source_id,external_id,envelope,lead_id,task_id,actor)
    values (x,source_,'forged-receipt',envelope_,gen_random_uuid(),gen_random_uuid(),a); raise exception 'ASSERT client forged receipt';
  exception when insufficient_privilege then passed := passed+1; end;
  begin update public.intake_events set event_kind='intake.accepted' where org_id=x; get diagnostics n=row_count;
    if n <> 0 then raise exception 'ASSERT client updated receipt'; end if; passed := passed+1;
  exception when insufficient_privilege then passed := passed+1; end;
  begin delete from public.intake_events where org_id=x; get diagnostics n=row_count;
    if n <> 0 then raise exception 'ASSERT client deleted receipt'; end if; passed := passed+1;
  exception when insufficient_privilege then passed := passed+1; end;
  select count(*) into n from public.intake_events where org_id=x;
  if n <> 1 then raise exception 'ASSERT duplicate signal event'; end if; passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  select count(*) into n from public.intake_events where org_id=x;
  if n <> 0 then raise exception 'ASSERT foreign tenant reads events'; end if; passed := passed+1;
  select state into state_ from public.workspace_state where org_id=y;
  if jsonb_array_length(state_->'leads') <> 0 or jsonb_array_length(state_->'tasks') <> 0 then raise exception 'ASSERT Construction entered Roofing'; end if; passed := passed+1;
  execute 'reset role';
  -- Even an operator-created mapping into a Roofing-preset organization fails.
  insert into private.intake_sources(id,org_id,channel,source_url,follow_up_owner,approved_by,approval_note,enabled)
    values (source_ || '-roof',y,'website','https://example.test/',b,b,'Synthetic forbidden Roofing mapping',true);
  execute 'set local role authenticated';
  begin perform public.receive_intake(jsonb_set(envelope_,'{sourceId}',to_jsonb(source_ || '-roof'))); raise exception 'ASSERT Roofing intake allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'reset role';
  -- Disable source: already committed receipts remain safe to reconcile;
  -- new events must fail. Removed owner must also fail new deliveries.
  update private.intake_sources set enabled=false where id=source_;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  duplicate_ := public.receive_intake(envelope_);
  if (duplicate_->>'status') is distinct from 'duplicate' then raise exception 'ASSERT disabled receipt unavailable'; end if; passed := passed+1;
  begin perform public.receive_intake(jsonb_set(envelope_,'{externalId}','"fixture-disabled"')); raise exception 'ASSERT disabled source accepted';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'reset role';
  update private.intake_sources set enabled=true,follow_up_owner=r where id=source_;
  execute 'set local role authenticated';
  begin perform public.receive_intake(jsonb_set(envelope_,'{externalId}','"fixture-reviewer-owner"')); raise exception 'ASSERT reviewer follow-up assigned';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'reset role';
  -- A disabled source must not block normal membership removal. Re-enabling
  -- with that former member must fail closed instead of assigning stale work.
  update private.intake_sources set enabled=false,follow_up_owner=f where id=source_;
  execute 'set local role authenticated';
  perform public.remove_member(x,f);
  execute 'reset role';
  if exists (select 1 from public.memberships where org_id=x and user_id=f) then raise exception 'ASSERT mapped member removal blocked'; end if; passed := passed+1;
  update private.intake_sources set enabled=true where id=source_;
  execute 'set local role authenticated';
  begin perform public.receive_intake(jsonb_set(envelope_,'{externalId}','"fixture-removed-owner"')); raise exception 'ASSERT former member assigned';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'reset role';
  -- All four source channels share the exact transaction and metadata contract.
  -- Roll each successful synthetic delivery back so the suite's counts stay one.
  foreach channel_ in array array['website','ai_receptionist','business_email','manual'] loop
    begin
      update private.intake_sources set follow_up_owner=a,channel=channel_,enabled=true where id=source_;
      update public.workspace_state set state=jsonb_set(state,'{events}',(select jsonb_agg(jsonb_build_object('id','history-'||i,'at',0,'actor','system','kind','system','text','Synthetic history')) from generate_series(1,400) i)) where org_id=x;
      execute 'set local role authenticated';
      duplicate_:=public.receive_intake(jsonb_set(envelope_,'{externalId}',to_jsonb('channel-'||channel_)));
      select state into state_ from public.workspace_state where org_id=x;
      if jsonb_array_length(state_->'events')<>400 then raise exception 'ASSERT intake exceeded shared history bound';end if;
      if not exists(select 1 from jsonb_array_elements(state_->'leads') lead_ where lead_->>'id'=duplicate_->>'leadId' and lead_->'intake'->>'channel'=channel_) then raise exception 'ASSERT intake channel metadata';end if;
      raise exception using errcode='Z0001',message='Synthetic channel rollback';
    exception when sqlstate 'Z0001' then passed:=passed+1;
    end;
    execute 'reset role';
  end loop;
  -- Force downstream audit failure; verify the entire intake rolls back.
  update private.intake_sources set follow_up_owner=a where id=source_;
  execute format('alter table public.audit_log add constraint intake_fixture_failure check (action <> %L or org_id is distinct from %L::uuid) not valid','intake.accepted',x);
  execute 'set local role authenticated';
  begin perform public.receive_intake(jsonb_set(envelope_,'{externalId}','"fixture-atomic-failure"')); raise exception 'ASSERT forced audit failure did not fail';
  exception when check_violation then passed := passed+1; end;
  select count(*) into n from public.intake_events where source_id=source_;
  select state into state_ from public.workspace_state where org_id=x;
  if n <> 1 or jsonb_array_length(state_->'leads') <> 1 or jsonb_array_length(state_->'tasks') <> 1 then raise exception 'ASSERT partial transaction persisted'; end if; passed := passed+1;
  execute 'reset role';
  raise notice 'INTAKE PASS: % assertions; all fixtures rolled back.',passed;
end;
$test$;
rollback;
