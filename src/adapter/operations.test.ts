import {projectOperations} from '../automation/project.ts';
import {emptyState} from '../../supabase/functions/dispatch/logic.ts';
import{test}from'node:test';import assert from'node:assert/strict';import{createOperationsClient}from'./operations.ts';
const state=emptyState({id:'test-org',slug:'synthetic',name:'Synthetic',preset:'general'},[{user_id:'actor',name:'Synthetic',role:'owner',work_role:'manager'}],0);
const snapshot=projectOperations(state,'test-org','actor',0);
const session={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-test-session'}}})}};
test('integration client pins every operation to its organization and propagates current session without direct DB access',async()=>{
 const calls:Record<string,unknown>[]=[];const fetcher=async(url:unknown,request?:RequestInit)=>{calls.push({url,...JSON.parse(request!.body as string)});return new Response(JSON.stringify({ok:true,snapshot}),{status:200});};
 const client=createOperationsClient(session,'https://example.test','public-key','test-org',fetcher as typeof fetch);
 assert.equal((await client.snapshot(25)).ok,true);assert.equal(calls[0].orgId,'test-org');assert.equal(calls[0].op,'operations');assert.equal(calls[0].limit,25);
});
test('cross-tenant responses and unauthenticated sessions are never exposed as successful records',async()=>{
 const client=createOperationsClient(session,'https://example.test','public-key','test-org',async()=>new Response(JSON.stringify({ok:true,snapshot:{version:1,orgId:'foreign'}})));
 assert.equal((await client.snapshot()).ok,false);
 let calls=0;const anonymous=createOperationsClient({auth:{getSession:async()=>({data:{session:null}})}},'https://example.test','public-key','test-org',async()=>{calls++;throw Error();});
 assert.equal((await anonymous.snapshot()).ok,false);assert.equal(calls,0);
});
test('automation revision conflicts surface without blind state-changing retry',async()=>{
 let calls=0;const client=createOperationsClient(session,'https://example.test','public-key','test-org',async()=>{calls++;return new Response(JSON.stringify({ok:false,error:'Reload required',conflict:true}),{status:409});});
 const result=await client.runAutomation();assert.equal(result.ok,false);if(!result.ok)assert.equal(result.conflict,true);assert.equal(calls,1);
});

test('partial and cross-tenant record collections cannot masquerade as a complete operational snapshot',async()=>{
 for(const reply of [{version:1,orgId:'test-org'}, {...snapshot,tasks:[{id:'foreign',orgId:'foreign'}]}]){
 const client=createOperationsClient(session,'https://example.test','public-key','test-org',async()=>new Response(JSON.stringify({ok:true,snapshot:reply})));
 assert.equal((await client.snapshot()).ok,false);
 }
});
