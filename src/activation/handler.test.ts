import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleActivation,hashCode,normalizeCode,newCode,type ActivationDependencies} from '../../supabase/functions/employee-activation/handler.ts';
const employee='00000000-0000-4000-8000-000000000001',org='00000000-0000-4000-8000-000000000002';
const request=(body:unknown,authorization='')=>new Request('https://test.invalid',{method:'POST',headers:{authorization},body:JSON.stringify(body)});
function fake(){const calls:{name:string;args:any}[]=[];let created:any=null;let activated=false;const deps:ActivationDependencies={
 async rpc(name,args){calls.push({name,args});if(name==='employee_activation_limit')return true;if(activated)return args.p_email?{activated:true}:null;return {employee_id:employee,name:'Test Employee',company:'Test Company',claim:args.p_email?'claim':null};},
 async admin(auth,o,action,e,hash){if(auth!=='Bearer admin')throw Error();calls.push({name:action,args:{o,e,hash}});return {expires_at:'tomorrow'};},
 async createUser(input){created=input;activated=true;}
 };return {deps,calls,get created(){return created;},get activated(){return activated;}};}
test('activation endpoint generates 192-bit codes, passes only hashes to authorized RPC, never returns passwords',async()=>{
 const f=fake();assert.equal((await handleActivation(request({action:'generate',org,employee}),f.deps)).status,400);
 const res=await handleActivation(request({action:'generate',org,employee},'Bearer admin'),f.deps),body=await res.json();assert.equal(res.status,200);assert.match(normalizeCode(body.code),/^[a-f0-9]{48}$/);assert.equal(f.calls.at(-1)!.args.hash,await hashCode(normalizeCode(body.code)));assert.notEqual(newCode(),newCode());
});
test('activation endpoint checks identity, confirmation and password before claiming, then uses confirmed server Auth',async()=>{
 const f=fake(),code=newCode();
 for(const extra of [{confirmed:false},{employee:org},{password:'short'}]){const res=await handleActivation(request({action:'redeem',code,employee,confirmed:true,email:'test@test.invalid',password:'long-test-password',...extra}),f.deps);assert.equal(res.status,400);assert.equal(f.created,null);}
 const res=await handleActivation(request({action:'redeem',code,employee,confirmed:true,email:'TEST@test.invalid',password:'long-test-password',role:'owner',org}),f.deps);
 assert.equal(res.status,200);assert.equal(f.created.email,'test@test.invalid');assert.equal(f.created.email_confirm,true);assert.deepEqual(f.created.app_metadata,{quest_employee_activation:'claim'});assert.ok(!JSON.stringify(await res.json()).includes('password'));
 const replay=await handleActivation(request({action:'redeem',code,employee,confirmed:true,email:'test@test.invalid',password:'long-test-password'}),f.deps);assert.equal(replay.status,200);
});
test('activation endpoint rate limits persist before lookups and fails closed on Auth errors',async()=>{
 const f=fake();f.deps.rpc=async()=>false;assert.equal((await handleActivation(request({action:'preview',code:newCode()}),f.deps)).status,429);
 const g=fake();g.deps.createUser=async()=>{throw Error('secret internal error');};const res=await handleActivation(request({action:'redeem',code:newCode(),employee,confirmed:true,email:'test@test.invalid',password:'long-test-password'}),g.deps);assert.equal(res.status,409);assert.ok(!(await res.text()).includes('secret'));
});
