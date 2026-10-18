// Database integration tests: independent psql sessions, real roles/locks/SQL.
// Requires pre-applied tenancy + intake migrations on an authorized test target.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { testTarget } from './target.mjs';
import { receiveIntake } from '../../src/adapter/intake.ts';
import { emptyState, runAction } from '../../supabase/functions/dispatch/logic.ts';

let target;
try { target = testTarget(process.env); } catch (error) {
  await writeFile(new URL('../../docs/intake-db-test-result.json',import.meta.url),JSON.stringify({runId:randomUUID(),executed:false,passed:false,blocked:true,reason:error.message,at:new Date().toISOString()},null,2)+'\n');
  console.error(error.message); process.exit(2);
}
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${sqlString(JSON.stringify(value))}::jsonb`;
const runId = randomUUID();
const short = runId.slice(0,8);
const org = { id: randomUUID(), slug: `intake-test-${short}`, name: 'Synthetic Construction test', preset: 'general' };
const roofingId = randomUUID();
const owner = randomUUID(), foreign = randomUUID(), reviewer = randomUUID(), platform = randomUUID();
const sourceId = `intake-test-${runId}`, callSource = `${sourceId}-call`;
const members = [{ user_id: owner, role: 'owner', work_role: 'manager', name: 'Synthetic owner' }];
const report = { runId, executed:true, target: target.label, syntheticOnly: true, productionTouched: false, checks: [], cleanup: false };
const check = (name, detail) => { report.checks.push({ name, passed: true, detail }); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(sql, app='main', readyMarker) {
  let output='', errors='', readyResolve, readyReject;
  const ready = new Promise((resolve,reject)=>{ readyResolve=resolve; readyReject=reject; });
  // Password lives in the child environment, never command arguments or output.
  const child = spawn('psql',['-X','-qAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose'], {
    env: {...target.env,PGAPPNAME:`intake-${short}-${app}`},stdio:['pipe','pipe','pipe'],
  });
  const result = new Promise((resolve,reject)=>{
    child.on('error',()=>{ const e=new Error('Could not start psql. Install PostgreSQL client tools.'); readyReject(e); reject(e); });
    child.stdout.on('data',chunk=>{output+=chunk; if (readyMarker && output.includes(readyMarker)) readyResolve();});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    child.on('close',code=>{
      if (readyMarker && !output.includes(readyMarker)) readyReject(new Error('Lock holder did not reach readiness.'));
      resolve({code,output,errors});
    });
  });
  // Prevent rejected readiness becoming unhandled when readiness isn't needed.
  if (!readyMarker) readyResolve();
  child.stdin.on('error',()=>{});
  child.stdin.end(`set statement_timeout='20s';\n${sql}\n`);
  return { result, ready };
}
async function query(sql, app) {
  const result=await start(sql,app).result;
  if(result.code!==0) { const e=new Error(`Database test query failed (${result.errors.match(/\b(?:[0-9][0-9A-Z]{4}|P[0-9A-Z]{4})\b/)?.[0] ?? 'connection/runtime error'}).`); e.sqlResult=result; throw e; }
  return result.output.trim();
}
const claims = actor => `set local role authenticated; select set_config('request.jwt.claims',${json({sub:actor,role:'authenticated'})}::text,true);`;
const envelope = (id, source=sourceId) => ({version:1,sourceId:source,externalId:id,receivedAt:'2026-10-17T00:00:00Z',contact:{name:'Synthetic customer',email:'synthetic@example.test',phone:'+16025550100'},inquiry:{need:'Synthetic Construction test inquiry',address:'Synthetic location'}});
const receiveSql = (value, actor=owner) => `begin; ${claims(actor)} select public.receive_intake(${json(value)}); commit;`;
const receiptFrom = text => {
  const lines=text.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  const receipt=lines.find(line=>line.ok===true); assert.ok(receipt,'Durable receipt missing'); return receipt;
};
async function state() { return JSON.parse(await query(`select state from public.workspace_state where org_id=${sqlString(org.id)};`)); }
async function countEvents() { return Number(await query(`select count(*) from public.intake_events where org_id=${sqlString(org.id)};`)); }
async function waitForLock(app) {
  for(let attempt=0;attempt<30;attempt++) {
    const found=await query(`select exists(select 1 from pg_stat_activity where application_name=${sqlString(`intake-${short}-${app}`)} and wait_event_type='Lock');`);
    if(found==='t') return;
    await delay(50);
  }
  throw new Error(`Concurrent ${app} session was not observed waiting on a database lock.`);
}
// Return an object rather than a promise so callers can await readiness without
// accidentally awaiting the holder transaction's completion.
async function hold(sql,app) {
  const marker=`LOCK_READY_${short}_${app}`;
  const running=start(`begin; ${sql}\n\\echo ${marker}\nselect pg_sleep(3); commit;`,app,marker);
  await running.ready; return {done:running.result};
}
async function seed() {
  const initial=emptyState(org,members,Date.now());
  await query(`begin;
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    ${[owner,foreign,reviewer,platform].map((id,i)=>`(${sqlString(id)},${sqlString(`intake-${short}-${i}@example.test`)},now(),'{}')`).join(',')};
    insert into public.organizations(id,slug,name,preset) values
      (${sqlString(org.id)},${sqlString(org.slug)},'Synthetic Construction test','general'),
      (${sqlString(roofingId)},${sqlString(`roofing-test-${short}`)},'Synthetic Roofing test','roofing');
    insert into public.memberships(org_id,user_id,role,work_role) values
      (${sqlString(org.id)},${sqlString(owner)},'owner','manager'),
      (${sqlString(org.id)},${sqlString(reviewer)},'reviewer','reviewer'),
      (${sqlString(roofingId)},${sqlString(foreign)},'owner','manager');
    insert into private.platform_admins(user_id,granted_by) values (${sqlString(platform)},'Synthetic intake test');
    insert into public.workspace_state(org_id,state) values (${sqlString(org.id)},${json(initial)}),(${sqlString(roofingId)},${json({...initial,workspace:{...initial.workspace,tenantId:roofingId}})});
    insert into private.intake_sources(id,org_id,channel,source_url,follow_up_owner,approved_by,approval_note,enabled) values
      (${sqlString(sourceId)},${sqlString(org.id)},'website','https://example.test/form',${sqlString(owner)},${sqlString(owner)},'Authorized disposable synthetic intake test',true),
      (${sqlString(callSource)},${sqlString(org.id)},'ai_receptionist','https://example.test/call',${sqlString(owner)},${sqlString(owner)},'Authorized disposable synthetic receptionist test',true);
    commit;`);
}
async function cleanup() {
  await query(`begin;
    delete from public.intake_events where org_id in (${sqlString(org.id)},${sqlString(roofingId)});
    delete from private.intake_sources where id in (${sqlString(sourceId)},${sqlString(callSource)});
    delete from public.audit_log where org_id in (${sqlString(org.id)},${sqlString(roofingId)});
    delete from public.organizations where id in (${sqlString(org.id)},${sqlString(roofingId)});
    delete from auth.users where id in (${[owner,foreign,reviewer,platform].map(sqlString).join(',')});
    commit;`);
  const remaining=await query(`select (select count(*) from public.organizations where id in (${sqlString(org.id)},${sqlString(roofingId)})) + (select count(*) from auth.users where id in (${[owner,foreign,reviewer,platform].map(sqlString).join(',')}));`);
  assert.equal(remaining,'0','Synthetic fixture cleanup was incomplete');
  report.cleanup=true;
}
let seeded=false;
try {
  const ready=await query("select to_regprocedure('public.receive_intake(jsonb)') is not null and to_regclass('private.intake_sources') is not null and to_regprocedure('public.sync_operational_attention(uuid,uuid,integer,jsonb,boolean,bigint,jsonb)') is not null;");
  assert.equal(ready,'t','Apply the reviewed tenancy and intake migrations to the authorized non-production target first.');
  seeded=true; await seed();
  // Transactional SQL regression suite: role/RLS, validation, dedup, forced rollback.
  const suite=(await readFile(new URL('../../supabase/tests/intake.sql',import.meta.url),'utf8')).replace(/^\\set.*$/gm,'');
  const regression=await start(suite).result;
  assert.equal(regression.code,0,'SQL intake regression suite failed');
  assert.match(regression.errors,/INTAKE PASS:/);
  check('SQL transaction, validation, source controls, tenant RLS and rollback suite',regression.errors.match(/INTAKE PASS:[^\n]*/)?.[0]);
  const isolation=await start((await readFile(new URL('../../supabase/tests/rls_isolation.sql',import.meta.url),'utf8'))).result;
  assert.match(isolation.errors,/RESULT pass=\d+ fail=0/,'Existing tenancy isolation regression failed');
  check('Existing tenant isolation baseline',isolation.errors.match(/RESULT pass=\d+ fail=0/)?.[0]);

  const operationSuite=(await readFile(new URL('../../supabase/tests/operations.sql',import.meta.url),'utf8')).replace(/^\\set.*$/gm,'');
  const operationsRegression=await start(operationSuite).result;
  assert.equal(operationsRegression.code,0,'SQL operations/persistence regression suite failed');
  assert.match(operationsRegression.errors,/OPERATIONS PASS:/);
  check('Operational RLS, atomic task audit, authority and idempotent attention',operationsRegression.errors.match(/OPERATIONS PASS:[^\n]*/)?.[0]);

  for(const [id,changed,secondSource] of [['same-key',false,false],['changed-key',true,false],['two-sources',false,true]]) {
    const before=await state(), eventsBefore=await countEvents();
    const first=envelope(id), second=envelope(secondSource?`${id}-2`:id,secondSource?callSource:sourceId);
    if(changed) second.inquiry.need='Changed synthetic content';
    const held=await hold(`${claims(owner)} select public.receive_intake(${json(first)});`,'holder');
    const waiter=start(receiveSql(second),'waiter');
    await waitForLock('waiter');
    const [one,two]=await Promise.all([held.done,waiter.result]);
    assert.equal(one.code,0); const original=receiptFrom(one.output);
    if(changed) { assert.notEqual(two.code,0); assert.match(two.errors,/23505/); }
    else { assert.equal(two.code,0); const next=receiptFrom(two.output); assert.equal(next.status,secondSource?'accepted':'duplicate'); if(!secondSource) assert.equal(next.receiptId,original.receiptId); }
    const increment=secondSource?2:1, after=await state();
    assert.equal(after.rev,before.rev+increment); assert.equal(after.leads.length,before.leads.length+increment);
    assert.equal(after.tasks.length,before.tasks.length+increment); assert.equal(await countEvents(),eventsBefore+increment);
    check(`Concurrent ${id}`,{observedDatabaseLock:true,commits:increment});
  }

  // Simulate loss of the actual committed DB response, not a fabricated receipt.
  const beforeLost=await state(), lostEnvelope=envelope('response-lost'); let attempts=0;
  const result=await receiveIntake({rpc:async (_name,args)=>{
    const data=receiptFrom(await query(receiveSql(args.p_envelope)));
    if(++attempts===1) throw new Error('Synthetic response loss after real commit');
    return {data,error:null};
  }},lostEnvelope,{wait:delay});
  assert.equal(result.ok,true); assert.equal(result.status,'duplicate'); assert.equal(attempts,2);
  assert.equal((await state()).rev,beforeLost.rev+1);
  check('Retry after lost committed response',{attempts,receiptId:result.receiptId});

  // All bounded retries time out on a real source-row lock, then manual replay succeeds.
  const beforeLocked=await state();
  const locked=await hold(`select id from private.intake_sources where id=${sqlString(sourceId)} for update;`,'timeout-holder');
  const retryEnvelope=envelope('lock-timeout'); let timeouts=0;
  const retry=await receiveIntake({rpc:async (_name,args)=>{
    const response=await start(`begin; set local lock_timeout='120ms'; ${claims(owner)} select public.receive_intake(${json(args.p_envelope)}); commit;`,'timeout-waiter').result;
    assert.notEqual(response.code,0); assert.match(response.errors,/55P03/); timeouts++;
    return {data:null,error:{code:'55P03',message:'Synthetic database lock timeout'}};
  }},retryEnvelope,{wait:delay});
  assert.equal(retry.ok,false); assert.equal(retry.retryable,true); assert.equal(timeouts,3);
  assert.equal((await locked.done).code,0); assert.equal((await state()).rev,beforeLocked.rev);
  assert.equal(receiptFrom(await query(receiveSql(retryEnvelope))).status,'accepted');
  assert.equal(receiptFrom(await query(receiveSql(retryEnvelope))).status,'duplicate');
  check('Bounded real lock-timeout retry and safe later replay',{timeouts});

  // Prove the actual dispatch UPDATE predicate cannot overwrite intake.
  const snapshot=await state();
  const action={type:'task/create',task:{title:'Synthetic dispatch concurrency task',owner,nextAction:'Synthetic verification'}};
  const stale=runAction(snapshot,org,members,owner,action,Date.now()); assert.equal(stale.ok,true);
  const held=await hold(`${claims(owner)} select public.receive_intake(${json(envelope('dispatch-race'))});`,'intake-holder');
  const currentAuthority=JSON.parse(await query(`select jsonb_agg(jsonb_build_array(user_id::text,role::text,work_role) order by user_id) from public.memberships where org_id=${sqlString(org.id)};`));
  const cas=start(`begin; set local role service_role;
    select public.commit_workspace_action(${sqlString(org.id)},${sqlString(owner)},${snapshot.rev},${json(stale.state)},'task.synthetic','{}',${json(currentAuthority)}); commit;`,'cas-waiter');
  await waitForLock('cas-waiter');
  assert.equal((await held.done).code,0); const staleResult=await cas.result;
  assert.equal(staleResult.code,0); assert.equal(JSON.parse(staleResult.output.trim()).conflict,true);
  const fresh=await state(); assert.equal(fresh.rev,snapshot.rev+1);
  const reapplied=runAction(fresh,org,members,owner,action,Date.now()); assert.equal(reapplied.ok,true);
  const committed=await query(`begin; set local role service_role; select public.commit_workspace_action(${sqlString(org.id)},${sqlString(owner)},${fresh.rev},${json(reapplied.state)},'task.synthetic','{}',${json(currentAuthority)}); commit;`);
  assert.equal(JSON.parse(committed).rev,fresh.rev+1);
  const final=await state(); assert.equal(final.leads.length,snapshot.leads.length+1); assert.equal(final.tasks.length,snapshot.tasks.length+2);
  check('Dispatch revision conflict, reload and reapply preserves intake',{edgeHttpTested:false,staleUpdateRows:0});

  // An earlier time-based projection cannot overwrite a newer committed one,
  // even when both were evaluated at the identical workspace revision.
  const authority=JSON.parse(await query(`select jsonb_agg(jsonb_build_array(user_id::text,role::text,work_role) order by user_id) from public.memberships where org_id=${sqlString(org.id)};`));
  const evalRev=(await state()).rev,evalTime=Date.now()-1000;
  const attention={id:'synthetic-sla',orgId:org.id,rule:'lead-response',severity:'critical',subject:{kind:'lead',id:'synthetic'},accountableId:owner,assignmentRequired:false,conditionVersion:1,what:'Synthetic SLA breach',why:'Synthetic',nextAction:'Review inquiry',suggestedAction:null};
  const newer=await hold(`set local role service_role; select public.sync_operational_attention(${sqlString(org.id)},${sqlString(owner)},${evalRev},${json([attention])},true,${evalTime},${json(authority)});`,'newer-evaluation');
  const older=start(`begin; set local role service_role; select public.sync_operational_attention(${sqlString(org.id)},${sqlString(owner)},${evalRev},${json([{...attention,severity:'high'}])},true,${evalTime-1},${json(authority)}); commit;`,'older-evaluation');
  await waitForLock('older-evaluation'); assert.equal((await newer.done).code,0);
  const olderResult=await older.result;assert.notEqual(olderResult.code,0);assert.match(olderResult.errors,/40001/);
  assert.equal(await query(`select record->>'severity' from public.operational_attention where org_id=${sqlString(org.id)} and rule_key='synthetic-sla';`),'critical');
  check('Concurrent out-of-order evaluation cannot regress SLA severity',{observedDatabaseLock:true});

  // Role changes do not increment workspace rev. Lock+compare authority must
  // reject a previously evaluated action after a concurrent demotion commits.
  const roleChange=await hold(`update public.memberships set role='member',work_role='field' where org_id=${sqlString(org.id)} and user_id=${sqlString(owner)};`,'authority-change');
  const revoked=start(`begin; set local role service_role; select public.commit_workspace_action(${sqlString(org.id)},${sqlString(owner)},${evalRev},${json(await state())},'task.synthetic','{}',${json(authority)}); commit;`,'revoked-commit');
  await waitForLock('revoked-commit'); assert.equal((await roleChange.done).code,0);
  const revokedResult=await revoked.result;assert.notEqual(revokedResult.code,0);assert.match(revokedResult.errors,/40001/);
  assert.equal((await state()).rev,evalRev);
  await query(`update public.memberships set role='owner',work_role='manager' where org_id=${sqlString(org.id)} and user_id=${sqlString(owner)};`);
  check('Concurrent demotion invalidates evaluated task authority without changing task revision',{observedDatabaseLock:true});

  // Fail closed for anonymous, foreign-tenant and platform-only reads/writes.
  for(const actor of [foreign,platform]) {
    const visible=await query(`begin; ${claims(actor)} select count(*) from public.intake_events where org_id=${sqlString(org.id)}; commit;`);
    assert.equal(visible.split('\n').at(-1),'0');
    const denied=await start(receiveSql(envelope(`forbidden-${actor}`),actor)).result;
    assert.notEqual(denied.code,0); assert.match(denied.errors,/42501/);
  }
  check('Foreign tenant and platform-only sessions cannot read or submit Construction inquiries');
} catch(error) {
  report.error=error.message;
  // Never print raw connection strings or credentials; SQLSTATE only when available.
  console.error(`FAIL ${error.message}`);
  process.exitCode=1;
} finally {
  if(seeded) { try { await cleanup(); } catch { report.cleanup=false; console.error(`Cleanup incomplete; preserve run ID ${runId} for operator review.`); process.exitCode=1; } }
  report.passed=!report.error && report.cleanup;
  const reportPath=new URL('../../docs/intake-db-test-result.json',import.meta.url);
  await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`);
  console.log(`Database evidence recorded; passed=${report.passed}, cleanup=${report.cleanup}.`);
}
