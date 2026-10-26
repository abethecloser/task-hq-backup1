import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDb,PRODUCTION_BASELINE,read,addUser,addOrg,addMember,rpcAs,uuid} from '../../tests/db/pg.ts';
async function setup(){
 const db=await createDb([...PRODUCTION_BASELINE,'20261018030000_team_staging.sql']);
 await db.pg.exec(`alter table auth.users add column raw_app_meta_data jsonb default '{}';create table public.team_activation_codes(id uuid primary key default gen_random_uuid(),employee_name text not null,employee_ref text,code_hash text not null unique,created_at timestamptz default now(),expires_at timestamptz not null default now()+interval '7 days',redeemed_at timestamptz,redeemed_by uuid references auth.users(id));alter table public.team_activation_codes enable row level security;`);
 await db.pg.exec(`insert into public.team_activation_codes(employee_name,code_hash) values('Preserved legacy employee',repeat('f',64));`);
 await db.pg.exec(read('supabase/migrations/20261019115203_employee_activation_v1.sql'));
 await db.pg.exec(read('supabase/migrations/20261022010000_activation_delivery.sql'));
 const org=await addOrg(db,'activation-test','Activation Test'),owner=await addUser(db,'owner@test.invalid'),admin=await addUser(db,'admin@test.invalid'),outsider=await addUser(db,'outsider@test.invalid');
 await addMember(db,org,owner,'owner','manager');await addMember(db,org,admin,'admin','manager');
 const employee=uuid();await db.pg.query(`insert into public.staged_contacts(id,org_id,staging_key,full_name,affiliation_confirmed,provisional_role) values($1,$2,'test-employee','Test Employee',true,'member')`,[employee,org]);
 const issue=(actor=owner,hash='a'.repeat(64))=>rpcAs(db,actor,'employee_activation_admin',{p_org:org,p_action:'generate',p_employee:employee,p_hash:hash});
 const lookup=async(hash='a'.repeat(64),email:string|null=null)=>(await db.pg.query<{v:any}>(`select public.employee_activation_lookup($1,$2) v`,[hash,email])).rows[0].v;
 const insert=async(claim:string,email='test@test.invalid',id=uuid())=>{await db.pg.transaction(async tx=>{await tx.exec("select set_config('request.jwt.claims','{}',true)");await tx.query(`insert into auth.users(id,email) values($1,$2)`,[id,email]);await tx.query(`update auth.users set raw_app_meta_data=$2 where id=$1`,[id,JSON.stringify({quest_employee_activation:claim})]);await tx.query(`update auth.users set email_confirmed_at=now() where id=$1`,[id]);});return id;};
 return {db,org,owner,admin,outsider,employee,issue,lookup,insert};
}
test('activation SQL: exact employee, atomic confirmed Auth linking, role snapshot, single use and idempotent recovery',async()=>{
 const s=await setup();try{
 assert.equal((await s.issue()).error,null);
 const preview=await s.lookup();assert.equal(preview.employee_id,s.employee);assert.equal(preview.name,'Test Employee');assert.equal(preview.claim,null);
 const claim=await s.lookup(undefined,'test@test.invalid');assert.ok(claim.claim);
 assert.equal(await s.lookup(undefined,'changed@test.invalid'),null);
 const user=await s.insert(claim.claim);
 const links=await s.db.pg.query<any>(`select l.*,m.role,m.work_role,a.redeemed_by from public.employee_auth_links l join public.memberships m using(org_id,user_id) join public.team_activation_codes a on a.id=l.activation_id`);
 assert.equal(links.rows[0].employee_id,s.employee);assert.equal(links.rows[0].user_id,user);assert.equal(links.rows[0].role,'member');assert.equal(links.rows[0].redeemed_by,user);
 assert.equal(await s.lookup(),null);assert.equal((await s.lookup(undefined,'test@test.invalid')).activated,true);
 await assert.rejects(s.insert(claim.claim));assert.ok((await s.issue()).error);
 assert.equal((await s.db.pg.query<any>('select count(*)::int n from public.employee_auth_links')).rows[0].n,1);
 }finally{await s.db.close();}
});
test('activation SQL: revoke/regenerate, expiration, permission changes, and failed Auth insert roll back',async()=>{
 const s=await setup();try{
 assert.equal(await s.lookup('f'.repeat(64)),null);assert.equal((await s.db.pg.query<any>("select employee_ref from public.team_activation_codes where code_hash=repeat('f',64)")).rows[0].employee_ref,null);assert.ok((await s.issue(s.outsider)).error);await s.issue();const old=await s.lookup(undefined,'test@test.invalid');
 await s.issue(s.owner,'b'.repeat(64));assert.equal(await s.lookup(),null);await assert.rejects(s.insert(old.claim));
 const claim=await s.lookup('b'.repeat(64),'test@test.invalid');
 await s.db.pg.query(`update public.staged_contacts set provisional_role='admin',updated_at=now() where id=$1`,[s.employee]);
 await assert.rejects(s.insert(claim.claim));
 assert.equal((await s.db.pg.query<any>(`select count(*)::int n from auth.users where email='test@test.invalid'`)).rows[0].n,0);
 assert.ok((await s.issue(s.admin,'c'.repeat(64))).error);
 await s.issue(s.owner,'c'.repeat(64));const revoked=await s.lookup('c'.repeat(64),'test@test.invalid');
 assert.equal((await rpcAs(s.db,s.owner,'employee_activation_admin',{p_org:s.org,p_action:'revoke',p_employee:s.employee})).error,null);await assert.rejects(s.insert(revoked.claim));
 await s.issue(s.owner,'d'.repeat(64));await s.db.pg.exec(`update public.team_activation_codes set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where code_hash=repeat('d',64)`);assert.equal(await s.lookup('d'.repeat(64)),null);
 }finally{await s.db.close();}
});
test('activation SQL: direct access denied, persistent rate limits, no fake user-metadata activation',async()=>{
 const s=await setup();try{
 await assert.rejects(s.db.pg.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec('select * from public.team_activation_codes');}));
 assert.ok((await rpcAs(s.db,s.owner,'employee_activation_lookup',{p_hash:'a'.repeat(64)})).error);
 for(let i=0;i<4;i++){const r=await s.db.pg.query<any>(`select public.employee_activation_limit('test',3,900) v`);assert.equal(r.rows[0].v,i<3);}
 await s.issue();const normal=await addUser(s.db,'normal@test.invalid');assert.equal((await s.db.pg.query<any>('select count(*)::int n from public.memberships where user_id=$1',[normal])).rows[0].n,0);
 }finally{await s.db.close();}
});
test('onboarding: status follows the records, expired setup link recovers by reissue, existing accounts are linked not duplicated',async()=>{
 const s=await setup();try{
 await s.db.pg.exec(read('supabase/migrations/20261019180000_people_access_status.sql'));
 await s.db.pg.exec(read('supabase/migrations/20261019210000_people_access_accounts.sql'));
 const status=async(id=s.employee)=>((await rpcAs(s.db,s.owner,'org_people_access',{p_org:s.org})).data as any[]).find(p=>p.id===id);
 await s.db.pg.query(`update public.staged_contacts set email='new.hire@test.invalid',updated_at=now() where id=$1`,[s.employee]);
 assert.deepEqual([(await status()).status,(await status()).has_account],['ready',false]);
 assert.ok((await rpcAs(s.db,s.outsider,'org_people_access',{p_org:s.org})).error,'non-admins never see onboarding status');
 // Setup pending → expired → reissued: the old link stops working, the new one works once.
 await s.issue(s.owner,'a'.repeat(64));assert.equal((await status()).status,'link-sent');
 await s.db.pg.exec(`update public.team_activation_codes set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where code_hash=repeat('a',64)`);
 assert.equal(await s.lookup('a'.repeat(64)),null);assert.equal((await status()).status,'link-expired');
 assert.equal((await s.issue(s.owner,'b'.repeat(64))).error,null);assert.equal((await status()).status,'link-sent');
 assert.equal(await s.lookup('a'.repeat(64)),null);
 const claim=await s.lookup('b'.repeat(64),'new.hire@test.invalid');const user=await s.insert(claim.claim,'new.hire@test.invalid');
 assert.equal((await status()).status,'active');assert.equal((await status()).member.user_id,user);
 assert.equal((await s.db.pg.query<any>(`select count(*)::int n from auth.users where email='new.hire@test.invalid'`)).rows[0].n,1,'first setup creates exactly one account');
 assert.equal(await s.lookup('b'.repeat(64)),null,'a used link is single-use');assert.ok((await s.issue(s.owner,'c'.repeat(64))).error,'no new link once active');
 // An employee who already has an account: shown as such and linked by invitation, never re-provisioned.
 const existing=uuid();await s.db.pg.query(`insert into public.staged_contacts(id,org_id,staging_key,full_name,email,affiliation_confirmed,provisional_role) values($1,$2,'existing','Existing Person','outsider@test.invalid',true,'member')`,[existing,s.org]);
 assert.deepEqual([(await status(existing)).status,(await status(existing)).has_account],['ready',true]);
 const inv=await rpcAs(s.db,s.owner,'invite_staged_contact',{p_contact:existing,p_days:14});assert.equal(inv.error,null);assert.equal((await status(existing)).status,'invited');
 assert.equal((await rpcAs(s.db,s.outsider,'accept_invitation',{p_invitation:inv.data})).error,null);
 assert.equal((await status(existing)).status,'active');
 assert.equal((await s.db.pg.query<any>(`select count(*)::int n from auth.users where email='outsider@test.invalid'`)).rows[0].n,1,'linking never duplicates the account');
 }finally{await s.db.close();}
});

test('activation delivery SQL: permissions, retry reuse and explicit replacement',async()=>{
 const s=await setup();try{
  await s.db.pg.query(`update public.staged_contacts set email='delivery@test.invalid' where id=$1`,[s.employee]);
  const firstHash='b'.repeat(64),replacementHash='c'.repeat(64);
  const membershipsBefore=(await s.db.pg.query<any>(`select count(*)::int n from public.memberships where org_id=$1`,[s.org])).rows[0].n;
  const issued=await rpcAs(s.db,s.owner,'employee_activation_issue',{p_org:s.org,p_employee:s.employee,p_hash:firstHash,p_replace:false});
  assert.equal(issued.error,null);
  assert.ok((await rpcAs(s.db,s.outsider,'employee_activation_issue',{p_org:s.org,p_employee:s.employee,p_hash:replacementHash,p_replace:true})).error,'non-admins cannot issue or replace links');
  const duplicate=await rpcAs(s.db,s.owner,'employee_activation_issue',{p_org:s.org,p_employee:s.employee,p_hash:replacementHash,p_replace:false});
  assert.match(String(duplicate.error?.message),/active setup link/i);
  assert.equal((await s.db.pg.query<any>(`select count(*)::int n from public.team_activation_codes where employee_id=$1 and revoked_at is null`,[s.employee])).rows[0].n,1);

  const prepared=await rpcAs(s.db,s.owner,'employee_activation_delivery',{p_action:'prepare',p_org:s.org,p_employee:s.employee,p_hash:firstHash});
  assert.equal(prepared.error,null);assert.equal(prepared.data.email,'delivery@test.invalid');
  const retry=await rpcAs(s.db,s.owner,'employee_activation_delivery',{p_action:'prepare',p_org:s.org,p_employee:s.employee,p_hash:firstHash});
  assert.equal(retry.data.id,prepared.data.id,'retry reuses the original activation record');
  assert.equal((await s.db.pg.query<any>(`select count(*)::int n from public.team_activation_codes where employee_id=$1`,[s.employee])).rows[0].n,1);
  const listed=await rpcAs(s.db,s.owner,'employee_activation_delivery',{p_action:'list',p_org:s.org});
  assert.equal(listed.error,null,String(listed.error));
  assert.equal(listed.data[0].status,'pending');
  assert.ok((await rpcAs(s.db,s.owner,'employee_activation_delivery',{p_action:'record',p_activation:prepared.data.id,p_status:'sent'})).error,'browser-authenticated callers cannot forge delivery outcomes');
  assert.ok((await rpcAs(s.db,s.outsider,'employee_activation_delivery',{p_action:'list',p_org:s.org})).error,'non-admins cannot read delivery status');

  const replaced=await rpcAs(s.db,s.owner,'employee_activation_issue',{p_org:s.org,p_employee:s.employee,p_hash:replacementHash,p_replace:true});
  assert.equal(replaced.error,null);
  assert.notEqual(replaced.data.id,prepared.data.id);
  assert.ok((await s.db.pg.query<any>(`select revoked_at from public.team_activation_codes where id=$1`,[prepared.data.id])).rows[0].revoked_at);
  assert.equal((await s.db.pg.query<any>(`select count(*)::int n from public.team_activation_codes where employee_id=$1 and revoked_at is null and redeemed_at is null`,[s.employee])).rows[0].n,1);
  assert.equal((await s.db.pg.query<any>(`select count(*)::int n from public.memberships where org_id=$1`,[s.org])).rows[0].n,membershipsBefore,'delivery never creates a membership');
 }finally{await s.db.close();}
});
