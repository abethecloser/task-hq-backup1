-- Run only on an explicitly authorized disposable test database. All fixtures
-- roll back. The guarded scripts/intake-db/run.mjs executes this suite.
\set ON_ERROR_STOP on
begin;
do $test$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); y uuid:=gen_random_uuid();
 state_ jsonb; authority_ jsonb; original_ jsonb; record_ jsonb; r jsonb; n int; checks_ int:=0; stamp_ bigint:=floor(extract(epoch from now())*1000)-10000;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(a,'ops-owner@example.test',now(),'{}'),(b,'ops-foreign@example.test',now(),'{}'),(m,'ops-member@example.test',now(),'{}');
 insert into public.organizations(id,slug,name) values(x,'ops-'||substr(x::text,1,12),'Synthetic Operations'),(y,'ops-'||substr(y::text,1,12),'Synthetic Other');
 insert into public.memberships(org_id,user_id,role,work_role) values(x,a,'owner','manager'),(x,m,'member','field'),(y,b,'owner','manager');
 state_:=jsonb_build_object('workspace',jsonb_build_object('tenantId',x),'tasks','[]'::jsonb,'leads','[]'::jsonb,'events','[]'::jsonb,'rev',1);
 original_:=state_;
 select jsonb_agg(jsonb_build_array(user_id::text,role::text,work_role) order by user_id) into authority_ from public.memberships where org_id=x;
 record_:=jsonb_build_object('id','overdue-synthetic','orgId',x,'rule','overdue','severity','high','subject',jsonb_build_object('kind','task','id','synthetic'),'accountableId',a,'assignmentRequired',false,'conditionVersion',1,'what','Synthetic task overdue','why','Synthetic','nextAction','Review synthetic task','suggestedAction',null);
 execute 'set local role service_role';
 perform public.initialize_workspace(x,a,state_);perform public.initialize_workspace(x,a,state_);
 r:=public.commit_workspace_action(x,a,1,state_,'task.synthetic','{}',authority_);
 if r->>'rev' is distinct from '2' then raise exception 'ASSERT commit revision'; end if;checks_:=checks_+1;
 r:=public.commit_workspace_action(x,a,1,state_,'task.synthetic','{}',authority_);
 if r->>'conflict' is distinct from 'true' then raise exception 'ASSERT stale commit'; end if;checks_:=checks_+1;
 r:=public.sync_operational_attention(x,a,2,jsonb_build_array(record_),true,stamp_,authority_);
 if r->>'opened' is distinct from '1' then raise exception 'ASSERT open attention'; end if;checks_:=checks_+1;
 r:=public.sync_operational_attention(x,a,2,jsonb_build_array(record_||jsonb_build_object('what','Countdown prose changed')),true,stamp_+1,authority_);
 if r->>'changed' is distinct from '0' or r->>'opened' is distinct from '0' then raise exception 'ASSERT duplicate automation'; end if;checks_:=checks_+1;
 begin perform public.sync_operational_attention(x,a,2,'[]',true,stamp_-1,authority_);raise exception 'ASSERT older evaluation accepted';exception when serialization_failure then checks_:=checks_+1;end;
 begin perform public.sync_operational_attention(x,m,2,'[]',true,stamp_+2,authority_);raise exception 'ASSERT member ran automation';exception when insufficient_privilege then checks_:=checks_+1;end;
 execute 'reset role';
 -- Membership demotion/removal is independent of workspace rev. It must make
 -- the prior authority snapshot unusable, even though expectedRev still matches.
 update public.memberships set work_role='reviewer',role='reviewer' where org_id=x and user_id=m;
 execute 'set local role service_role';
 begin perform public.commit_workspace_action(x,a,2,state_,'task.synthetic','{}',authority_);raise exception 'ASSERT stale authority committed';exception when serialization_failure then checks_:=checks_+1;end;
 execute 'reset role';
 select jsonb_agg(jsonb_build_array(user_id::text,role::text,work_role) order by user_id) into authority_ from public.memberships where org_id=x;
 execute 'set local role service_role';
 r:=public.sync_operational_attention(x,a,2,'[]',true,stamp_+3,authority_);
 if r->>'resolved' is distinct from '1' then raise exception 'ASSERT resolve attention';end if;checks_:=checks_+1;
 r:=public.sync_operational_attention(x,a,2,'[]',true,stamp_+4,authority_);
 if r->>'resolved' is distinct from '0' then raise exception 'ASSERT duplicate resolution';end if;checks_:=checks_+1;
 execute 'reset role';
 -- Force an audit failure and prove state/revision roll back with it.
 execute format('alter table public.audit_log add constraint ops_fixture_failure check (action<>%L or org_id is distinct from %L::uuid) not valid','task.fail',x);
 execute 'set local role service_role';
 begin perform public.commit_workspace_action(x,a,2,state_,'task.fail','{}',authority_);raise exception 'ASSERT forced audit failure';exception when check_violation then checks_:=checks_+1;end;
 execute 'reset role';
 select rev into n from public.workspace_state where org_id=x;if n<>2 then raise exception 'ASSERT partial state commit';end if;checks_:=checks_+1;
 select count(*) into n from public.audit_log where org_id=x and action='workspace.initialized';if n<>1 then raise exception 'ASSERT duplicate initialization';end if;checks_:=checks_+1;
 select count(*) into n from public.audit_log where org_id=x and action='automation.attention_changed';if n<>2 then raise exception 'ASSERT duplicate automation audit';end if;checks_:=checks_+1;
 execute 'set local role authenticated';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 select count(*) into n from public.operational_attention where org_id=x;if n<>0 then raise exception 'ASSERT foreign attention read';end if;checks_:=checks_+1;
 begin perform public.sync_operational_attention(x,a,2,'[]',true,stamp_+5,authority_);raise exception 'ASSERT direct automation RPC';exception when insufficient_privilege then checks_:=checks_+1;end;
 begin perform public.commit_workspace_action(x,a,2,state_,'forged','{}',authority_);raise exception 'ASSERT direct task commit RPC';exception when insufficient_privilege then checks_:=checks_+1;end;
 begin delete from public.operational_attention where org_id=x;raise exception 'ASSERT client attention delete';exception when insufficient_privilege then checks_:=checks_+1;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 select count(*) into n from public.operational_attention where org_id=x;if n<>1 then raise exception 'ASSERT own scoped attention read';end if;checks_:=checks_+1;
 execute 'reset role';
 raise notice 'OPERATIONS PASS: % assertions; fixtures rolled back.',checks_;
end;
$test$;
rollback;
