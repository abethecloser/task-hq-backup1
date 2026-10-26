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

test('deployed contract rejects unsupported actions and fields before sending any request', async t => {
 const f=fixture();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({ok:true,state,rev:1}));});
 await f.backend.load();
 const actions = [
  {type:'task/create',task:{title:'Test',dueTime:'09:00'}},
  {type:'task/create',task:{title:'Test',tags:[]}},
  {type:'task/update',id:'t',changes:{type:undefined}},
  {type:'taxonomy/update',taxonomy:{types:[],tags:[]}},
  {type:'taxonomy/register-tags',tags:['test']},
  {type:'task/reopen',id:'t',note:'Test'},
  {type:'lead/claim',id:'l'}, {type:'lead/tags',id:'l',tags:[]},
  {type:'roles/label',label:'Test'},
 ] as unknown as import('../core/contract.ts').Action[];
 for(const action of actions){const result=await f.backend.dispatch(action,'actor');assert.equal(result.ok,false);if(!result.ok)assert.match(result.error,/unavailable/);assert.equal(result.state.rev,1);}
 assert.equal(calls,1,'refused writes never reach the older server');
});

test('a typed @mention never blocks later writes: reference drafts are not sent to the older server',async t=>{
 const f=fixture();const bodies:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:{body:string})=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,state,rev:bodies.length}));});
 await f.backend.load();
 const drafts=[{text:'@Synthetic owner please check',spans:[{kind:'person',id:'actor',workspaceId:'synthetic',start:0,end:16,label:'@Synthetic owner'}]}];
 for(const action of [{type:'task/comment',id:'t',note:'@Synthetic owner please check',referenceDrafts:drafts},{type:'task/advance',id:'t',referenceDrafts:drafts}] as unknown as import('../core/contract.ts').Action[]){
  const result=await f.backend.dispatch(action,'actor');assert.equal(result.ok,true);
  const sent=bodies.at(-1)!.action as Record<string,unknown>;assert.equal('referenceDrafts' in sent,false);assert.equal(sent.type,action.type);
 }
 assert.equal((bodies[1]!.action as {note:string}).note,'@Synthetic owner please check','comment text is sent verbatim');
});

test('an HTTP failure cannot be reported as a saved task even with a success-shaped body',async t=>{
 const f=fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:true,state,rev:++calls}),{status:calls===1?200:500}));
 await f.backend.load();const result=await f.backend.dispatch({type:'task/comment',id:'t',note:'Test'},'actor');
 assert.equal(result.ok,false);assert.equal(result.state.rev,1);
});

test('a v5 server opens the gated features; a later reply without a contract closes them again',async t=>{
 const f=fixture();const bodies:Record<string,unknown>[]=[];let contract:number|undefined=5;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:{body:string})=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,state,rev:bodies.length,...(contract?{contract}:{})}));});
 assert.equal(f.backend.supports?.taskTaxonomy,false,'closed until the server says otherwise');
 await f.backend.load();
 assert.deepEqual(f.backend.supports,{taskTaxonomy:true,taskReopen:true,leadOwnership:true,workLabels:true,structuredReferences:true,taskArchive:false});
 const drafts=[{text:'@Synthetic owner',spans:[{kind:'person',id:'actor',workspaceId:'synthetic',start:0,end:16,label:'@Synthetic owner'}]}];
 for(const action of [{type:'task/reopen',id:'t',note:'Leak returned'},{type:'task/update',id:'t',changes:{tags:['permits'],dueTime:'09:00'}},{type:'task/comment',id:'t',note:'@Synthetic owner',referenceDrafts:drafts}] as unknown as import('../core/contract.ts').Action[]){
  const result=await f.backend.dispatch(action,'actor');assert.equal(result.ok,true,action.type);assert.deepEqual(bodies.at(-1)!.action,action,'sent unchanged');
 }
 contract=undefined;await f.backend.load();
 assert.equal(f.backend.supports?.taskReopen,false);
 const refused=await f.backend.dispatch({type:'task/reopen',id:'t',note:'x'},'actor');assert.equal(refused.ok,false);
});

test('a gateway error without a contract does not close features a v5 server opened',async t=>{
 const f=fixture();let status=200;
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(status===200?{ok:true,state,rev:1,contract:5}:{ok:false,error:'Invalid JWT'}),{status}));
 await f.backend.load();status=401;
 const failed=await f.backend.dispatch({type:'task/comment',id:'t',note:'x'},'actor');assert.equal(failed.ok,false);
 assert.equal(f.backend.supports?.taskReopen,true);
});

test('archiving opens only on a v6 server and is refused before sending otherwise',async t=>{
 const f=fixture();let contract=5;const bodies:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:{body:string})=>{bodies.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,state,rev:bodies.length,contract}));});
 await f.backend.load();assert.equal(f.backend.supports?.taskArchive,false);
 const refused=await f.backend.dispatch({type:'task/archive',id:'t'},'actor');assert.equal(refused.ok,false);assert.equal(bodies.length,1,'nothing sent');
 contract=6;await f.backend.load();assert.equal(f.backend.supports?.taskArchive,true);
 const sent=await f.backend.dispatch({type:'task/archive',id:'t'},'actor');assert.equal(sent.ok,true);assert.deepEqual(bodies.at(-1)!.action,{type:'task/archive',id:'t'});
});
