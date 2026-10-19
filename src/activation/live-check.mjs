// Explicit, isolated live acceptance check. Does not alter existing employees or memberships.
// Run only for the approved project and controlled address; credentials remain in memory.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {newCode,normalizeCode,hashCode} from '../../supabase/functions/employee-activation/handler.ts';
const project='xthyyxnfjaxmtrqrhyxc',email=process.env.ACTIVATION_TEST_EMAIL?.trim().toLowerCase();
if(email!=='qa.prototype.33@gmail.com')throw Error('Set the explicitly approved ACTIVATION_TEST_EMAIL.');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(s=>/^[A-Z_]+=/.test(s)).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.equal(new URL(url).hostname,project+'.supabase.co');assert.ok(key&&!key.startsWith('sb_secret_'));
function sql(query){const run=spawnSync('supabase',['db','query','--linked','--project-ref',project,query,'--output','json'],{encoding:'utf8'});if(run.status!==0)throw Error(run.stderr);const out=JSON.parse(run.stdout);return out.rows;}
const existing=sql(`select id from auth.users where lower(email)='${email}'`);assert.equal(existing.length,0,'Test address already exists; do not overwrite an account.');
const snapshot=()=>sql("select md5(coalesce((select jsonb_agg(to_jsonb(c) order by id)::text from public.staged_contacts c where staging_key<>'activation-qa-20261019'),'')) contacts, md5(coalesce((select jsonb_agg(to_jsonb(m) order by org_id,user_id)::text from public.memberships m where user_id not in (select id from auth.users where lower(email)='"+email+"')),'')) memberships")[0];
const before=snapshot();
const code=newCode(),hash=await hashCode(normalizeCode(code));
const fixture=sql(`begin;
insert into public.staged_contacts(org_id,staging_key,full_name,email,title,provisional_role,provisional_work_role,affiliation_confirmed,source,notes)
select id,'activation-qa-20261019','TEST — Activation QA','${email}','Isolated activation acceptance test','member','field',true,'Authorized activation QA','Controlled test only; no employee assignments.' from public.organizations where slug='quest-roofing'
returning id;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from public.memberships where org_id=(select id from public.organizations where slug='quest-roofing') and role='owner' limit 1),'role','authenticated')::text,true);
select public.employee_activation_admin((select id from public.organizations where slug='quest-roofing'),'generate',(select id from public.staged_contacts where staging_key='activation-qa-20261019'),'${hash}') issued;
commit;`);
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function call(body){const res=await fetch(url+'/functions/v1/employee-activation',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};}
assert.equal((await call({action:'generate',org:'492f0048-85ad-4f38-aef7-9b8e7f823cff',employee:'00000000-0000-4000-8000-000000000001'})).status,400);
const preview=await call({action:'preview',code});assert.equal(preview.status,200,JSON.stringify(preview.body));const employee=preview.body.data.employee_id;assert.equal(preview.body.data.name,'TEST — Activation QA');
const password=randomBytes(24).toString('base64url')+'aA1!';
const body={action:'redeem',code,employee,confirmed:true,email,password};
const results=await Promise.all([call(body),call(body)]);assert.ok(results.some(r=>r.status===200),JSON.stringify(results.map(r=>r.body)));assert.ok(results.every(r=>[200,409].includes(r.status)));
const {data,error}=await client.auth.signInWithPassword({email,password});assert.equal(error,null,error?.message);assert.ok(data.user.email_confirmed_at);assert.ok(data.session);
const context=await client.rpc('my_context');assert.equal(context.error,null);const membership=context.data.memberships.find(m=>m.slug==='quest-roofing');assert.equal(membership.role,'member');assert.equal(membership.work_role,'field');
const workspace=await client.from('workspace_state').select('org_id,rev').eq('org_id',membership.org_id);assert.equal(workspace.error,null);assert.equal(workspace.data.length,1);
const denied=await client.rpc('employee_activation_admin',{p_org:membership.org_id,p_action:'list'});assert.ok(denied.error);
assert.equal((await call({action:'preview',code})).status,400);assert.equal((await call({...body,email:'someone-else@example.invalid'})).status,400);
const persisted=sql(`select c.id,c.employee_id,c.redeemed_by,l.user_id,m.role,(select count(*) from auth.users where lower(email)='${email}')::int auth_count from public.team_activation_codes c join public.employee_auth_links l on l.activation_id=c.id join public.memberships m on m.user_id=l.user_id and m.org_id=l.org_id where c.code_hash='${hash}'`);
assert.equal(persisted.length,1);assert.equal(persisted[0].auth_count,1);assert.equal(persisted[0].employee_id,employee);assert.equal(persisted[0].user_id,data.user.id);assert.equal(persisted[0].redeemed_by,data.user.id);
assert.deepEqual(snapshot(),before);
await client.auth.signOut();
console.log(JSON.stringify({result:'PASS',project,email,employee_id:employee,user_id:data.user.id,confirmed:true,membership_role:membership.role,workspace_read:true,concurrent_statuses:results.map(r=>r.status),code_single_use:true,employee_unchanged:true,password:'Not saved. Use password recovery for this test account.'},null,2));
