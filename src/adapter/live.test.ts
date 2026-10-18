import{test}from'node:test';import assert from'node:assert/strict';import{createLiveBackend}from'./live.ts';import{emptyState}from'../../supabase/functions/dispatch/logic.ts';
const org={id:'synthetic',slug:'synthetic',name:'Synthetic',preset:'general'};
const state=emptyState(org,[{user_id:'actor',name:'Synthetic owner',role:'owner',work_role:'manager'}],0);
function fixture(){let update:(payload:unknown)=>void=()=>{};const channel={on(_event:unknown,_filter:unknown,handler:(p:unknown)=>void){update=handler;return channel;},subscribe(){return channel;}};const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-session'}}})},channel:()=>channel,removeChannel:async()=>{}};return {backend:createLiveBackend(client as never,'https://example.test','publishable',org,'actor'),emit:(s:unknown,rev:number)=>update({new:{state:s,rev}}),client};}
test('out-of-order live notifications cannot move the cached workspace revision backwards',async t=>{
 const f=fixture();t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:true,state,rev:1})));
 await f.backend.load();let latest=0;f.backend.subscribe(s=>{latest=s.rev;});
 f.emit(state,5);f.emit(state,3);assert.equal(latest,5);
 const loaded=await f.backend.load();assert.equal(loaded.rev,5);
});
test('ambiguous network failure after possible commit tells caller to reload instead of claiming no change',async t=>{
 const f=fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>{if(++calls===1)return new Response(JSON.stringify({ok:true,state,rev:1}));throw Error('response lost');});
 await f.backend.load();const result=await f.backend.dispatch({type:'task/create',task:{title:'Synthetic task'}},'actor');
 assert.equal(result.ok,false);if(!result.ok){assert.match(result.error,/Reload/);assert.doesNotMatch(result.error,/nothing was changed/i);}assert.equal(calls,2);
});
test('session refresh failures return a bounded failure rather than throwing a dispatch rejection',async()=>{
 const f=fixture();f.client.auth.getSession=async()=>{throw Error('synthetic session error');};
 await assert.rejects(f.backend.load(),/could not confirm/);
});
