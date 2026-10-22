import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb,PRODUCTION_BASELINE,read,addUser,addOrg,addMember,rpcAs,uuid} from '../../tests/db/pg.ts';
// Identity v1 on top of the activation schema production has (employee_activation_v1, verified by body hash).
async function setup(){
 const db=await createDb([...PRODUCTION_BASELINE,'20261018030000_team_staging.sql']);
 await db.pg.exec(`alter table auth.users add column raw_app_meta_data jsonb default '{}';alter table auth.users add column encrypted_password text;create table public.team_activation_codes(id uuid primary key default gen_random_uuid(),employee_name text not null,employee_ref text,code_hash text not null unique,created_at timestamptz default now(),expires_at timestamptz not null default now()+interval '7 days',redeemed_at timestamptz,redeemed_by uuid references auth.users(id));alter table public.team_activation_codes enable row level security;`);
 await db.pg.exec(read('supabase/migrations/20261019115203_employee_activation_v1.sql'));
 await db.pg.exec(read('supabase/migrations/20261020120000_identity_v1.sql'));
 const org=await addOrg(db,'identity-test','Identity Test'),owner=await addUser(db,'owner@test.invalid'),admin=await addUser(db,'admin@test.invalid');
 await addMember(db,org,owner,'owner','manager');await addMember(db,org,admin,'admin','manager');
 const contact=async(email:string|null=null,role='member')=>{const id=uuid();await db.pg.query(`insert into public.staged_contacts(id,org_id,staging_key,full_name,email,affiliation_confirmed,provisional_role) values($1,$2,$3,'New Hire',$4,true,$5)`,[id,org,`k-${id}`,email,role]);return id;};
 const issue=(employee:string,hash:string,actor=owner)=>rpcAs(db,actor,'employee_activation_admin',{p_org:org,p_action:'generate',p_employee:employee,p_hash:hash});
 /** An Auth account as GoTrue leaves it after verifyOtp: confirmed only once the code was entered. */
 const account=async(email:string,{confirmed=true,password=false}={})=>{const id=uuid();await db.pg.query(`insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,$3,$4)`,[id,email,confirmed?new Date():null,password?'$2a$10$hash':null]);return id;};
 // As the service-role endpoint calls it: claims present but naming no user.
 const redeem=(hash:string,user:string)=>db.pg.transaction(async tx=>{await tx.exec("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");return (await tx.query<{v:any}>(`select public.employee_activation_redeem($1,$2) v`,[hash,user])).rows[0]!.v;});
 const count=async(sql:string,args:unknown[]=[])=>(await db.pg.query<{n:number}>(`select count(*)::int n from ${sql}`,args)).rows[0]!.n;
 return {db,org,owner,admin,contact,issue,account,redeem,count};
}
const H=(c:string)=>c.repeat(64);

test('identity v1: a setup link lasts seven days and redeems once, only for a verified email', async()=>{
 const s=await setup();try{
  const employee=await s.contact();
  assert.equal((await s.issue(employee,H('a'))).error,null);
  const days=(await s.db.pg.query<{d:number}>(`select extract(epoch from expires_at-created_at)/86400 d from public.team_activation_codes where code_hash=$1`,[H('a')])).rows[0]!.d;
  assert.ok(Math.abs(Number(days)-7)<0.01,`expires after ${days} days`);
  const unverified=await s.account('hire@test.invalid',{confirmed:false});
  assert.deepEqual(await s.redeem(H('a'),unverified),{result:'unverified'});
  assert.equal(await s.count('public.memberships where user_id=$1',[unverified]),0);
  const user=await s.account('hire@test.invalid');
  assert.deepEqual(await s.redeem(H('a'),user),{result:'activated',org:s.org,has_password:false});
  const row=(await s.db.pg.query<any>(`select m.role,m.work_role,m.added_by,l.employee_id,c.redeemed_by,c.claim_email,sc.email from public.memberships m join public.employee_auth_links l using(org_id,user_id) join public.team_activation_codes c on c.id=l.activation_id join public.staged_contacts sc on sc.id=l.employee_id where m.user_id=$1`,[user])).rows[0];
  assert.deepEqual([row.role,row.work_role,row.added_by,row.employee_id,row.redeemed_by,row.claim_email,row.email],['member','field',s.owner,employee,user,'hire@test.invalid','hire@test.invalid']);
  assert.equal((await s.redeem(H('a'),user)).result,'activated','a lost reply can be retried by the same person');
  const other=await s.account('other@test.invalid');
  assert.deepEqual(await s.redeem(H('a'),other),{result:'unavailable'},'single use');
  assert.equal(await s.count('public.memberships where user_id=$1',[other]),0);
  assert.ok((await s.issue(employee,H('b'))).error,'no new link once the person is active');
 }finally{await s.db.close();}
});

test('identity v1: the email on file must be the one proven; revoked, replaced and expired links stop working', async()=>{
 const s=await setup();try{
  const employee=await s.contact('named@test.invalid');
  await s.issue(employee,H('a'));
  const wrong=await s.account('someone.else@test.invalid');
  assert.deepEqual(await s.redeem(H('a'),wrong),{result:'email-mismatch'});
  assert.equal(await s.count('public.team_activation_codes where code_hash=$1 and redeemed_at is null',[H('a')]),1,'a mismatch consumes nothing');
  await s.issue(employee,H('b'));
  const named=await s.account('named@test.invalid');
  assert.deepEqual(await s.redeem(H('a'),named),{result:'unavailable'},'replaced by a newer link');
  assert.equal((await rpcAs(s.db,s.owner,'employee_activation_admin',{p_org:s.org,p_action:'revoke',p_employee:employee})).error,null);
  assert.deepEqual(await s.redeem(H('b'),named),{result:'unavailable'},'revoked');
  await s.issue(employee,H('c'));
  await s.db.pg.exec(`update public.team_activation_codes set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where code_hash=repeat('c',64)`);
  assert.deepEqual(await s.redeem(H('c'),named),{result:'unavailable'},'expired');
  await s.issue(employee,H('d'));
  assert.equal((await s.redeem(H('d'),named)).result,'activated');
 }finally{await s.db.close();}
});

test('identity v1: existing members keep their role; existing accounts elsewhere are linked, never duplicated', async()=>{
 const s=await setup();try{
  const employee=await s.contact(null,'member');
  await s.issue(employee,H('a'));
  assert.deepEqual(await s.redeem(H('a'),s.admin),{result:'already-member'});
  assert.equal((await s.db.pg.query<any>(`select role from public.memberships where org_id=$1 and user_id=$2`,[s.org,s.admin])).rows[0].role,'admin','membership unchanged');
  const elsewhere=await s.account('veteran@test.invalid',{password:true});
  const before=await s.count('auth.users');
  assert.deepEqual(await s.redeem(H('a'),elsewhere),{result:'activated',org:s.org,has_password:true});
  assert.equal(await s.count('auth.users'),before);
 }finally{await s.db.close();}
});

test('identity v1: authority is re-checked at redemption, and only the server can redeem', async()=>{
 const s=await setup();try{
  const employee=await s.contact();
  await s.issue(employee,H('a'),s.admin);
  await s.db.pg.query(`update public.memberships set role='member' where org_id=$1 and user_id=$2`,[s.org,s.admin]);
  const user=await s.account('hire@test.invalid');
  assert.deepEqual(await s.redeem(H('a'),user),{result:'unavailable'},'issuer lost admin');
  await s.issue(employee,H('b'));
  await s.db.pg.query(`update public.staged_contacts set provisional_role='admin',updated_at=now() where id=$1`,[employee]);
  assert.deepEqual(await s.redeem(H('b'),user),{result:'unavailable'},'role changed after the link was made');
  for(const role of ['authenticated','anon'])
   await assert.rejects(s.db.pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query(`select public.employee_activation_redeem($1,$2)`,[H('b'),user]);}),/permission denied/);
  assert.equal(await s.count('public.memberships where user_id=$1',[user]),0);
 }finally{await s.db.close();}
});
