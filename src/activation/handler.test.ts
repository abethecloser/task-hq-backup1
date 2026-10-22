import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleActivation,hashCode,normalizeCode,newCode,EMAIL_CODE_WINDOW_SECONDS,type ActivationDependencies,type VerifiedUser} from '../../supabase/functions/employee-activation/handler.ts';
const employee='00000000-0000-4000-8000-000000000001',org='00000000-0000-4000-8000-000000000002',user='00000000-0000-4000-8000-000000000003';
const NOW=1_792_540_000;
const request=(body:unknown,authorization='')=>new Request('https://test.invalid',{method:'POST',headers:{authorization},body:JSON.stringify(body)});
function fake({who={id:user,emailConfirmed:true,emailCodeAt:NOW-60} as VerifiedUser|null,redeem='activated'}:{who?:VerifiedUser|null;redeem?:string}={}){
 const calls:{name:string;args:any}[]=[];
 const deps:ActivationDependencies={
  async rpc(name,args){calls.push({name,args});if(name==='employee_activation_limit')return true;
   if(name==='employee_activation_lookup')return {employee_id:employee,name:'Test Employee',company:'Test Company',claim:null};
   if(name==='employee_activation_redeem')return {result:redeem,has_password:false};throw Error(name);},
  async admin(auth,o,action,e,hash){if(auth!=='Bearer admin')throw Error();calls.push({name:action,args:{o,e,hash}});return {expires_at:'next week'};},
  async verifiedUser(auth){calls.push({name:'verifiedUser',args:auth});return auth==='Bearer employee'?who:null;},
  now:()=>NOW*1000,
 };return {deps,calls,redeemed:()=>calls.filter(c=>c.name==='employee_activation_redeem')};}
const activate=(extra:Record<string,unknown>={},auth='Bearer employee')=>request({action:'activate',code:newCode(),employee,confirmed:true,...extra},auth);

test('activation endpoint generates 192-bit codes and passes only hashes to the authorized RPC',async()=>{
 const f=fake();assert.equal((await handleActivation(request({action:'generate',org,employee}),f.deps)).status,400);
 const res=await handleActivation(request({action:'generate',org,employee},'Bearer admin'),f.deps),body=await res.json();assert.equal(res.status,200);assert.match(normalizeCode(body.code),/^[a-f0-9]{48}$/);assert.equal(f.calls.at(-1)!.args.hash,await hashCode(normalizeCode(body.code)));assert.notEqual(newCode(),newCode());
});

test('the retired flow cannot create an account for a typed email',async()=>{
 const f=fake();const res=await handleActivation(request({action:'redeem',code:newCode(),employee,confirmed:true,email:'x@test.invalid',password:'long-test-password'}),f.deps);
 assert.equal(res.status,410);assert.equal(f.calls.length,0,'nothing is looked up or created');
});

test('preview shows only who the link is for',async()=>{
 const f=fake();const res=await handleActivation(request({action:'preview',code:newCode()}),f.deps);
 assert.deepEqual(await res.json(),{data:{employee_id:employee,name:'Test Employee',company:'Test Company'}});
});

test('activation needs a confirmed identity and a session from a fresh email code',async()=>{
 for(const [extra,auth,who] of [
  [{confirmed:false},'Bearer employee',undefined],
  [{employee:org},'Bearer employee',undefined],
  [{},'',undefined],
  [{},'Bearer employee',{id:user,emailConfirmed:false,emailCodeAt:NOW}],
  [{},'Bearer employee',{id:user,emailConfirmed:true,emailCodeAt:null}],
  [{},'Bearer employee',{id:user,emailConfirmed:true,emailCodeAt:NOW-EMAIL_CODE_WINDOW_SECONDS-1}],
 ] as [Record<string,unknown>,string,VerifiedUser|undefined][]){
  const f=fake(who?{who}:{});const res=await handleActivation(activate(extra,auth),f.deps);
  assert.ok(res.status===400||res.status===401,`${JSON.stringify(extra)} ${auth} → ${res.status}`);assert.equal(f.redeemed().length,0);
 }
 const f=fake();const code=newCode();const res=await handleActivation(activate({code}),f.deps);
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{activated:true,has_password:false});
 assert.deepEqual(f.redeemed()[0]!.args,{p_hash:await hashCode(normalizeCode(code)),p_user:user},'the verified account, never a client-supplied id or email');
});

test('server refusals become plain answers without leaking state',async()=>{
 for(const [redeem,status] of [['email-mismatch',403],['already-member',409],['unavailable',400],['unverified',401],['anything-else',400]] as const){
  const res=await handleActivation(activate(),fake({redeem}).deps);assert.equal(res.status,status,redeem);
  assert.doesNotMatch(await res.text(),/@|uuid|0000/);
 }
});

test('activation endpoint rate limits persist before lookups and fails closed on errors',async()=>{
 const f=fake();f.deps.rpc=async()=>false;assert.equal((await handleActivation(request({action:'preview',code:newCode()}),f.deps)).status,429);
 const g=fake();g.deps.verifiedUser=async()=>{throw Error('secret internal error');};const res=await handleActivation(activate(),g.deps);assert.equal(res.status,400);assert.ok(!(await res.text()).includes('secret'));
});
