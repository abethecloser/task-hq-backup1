import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleDispatch} from './handler.ts';
import {emptyState} from './logic.ts';
const org={id:'00000000-0000-4000-8000-000000000001',slug:'synthetic',name:'Synthetic test',preset:'general'};
const actor='00000000-0000-4000-8000-000000000002';
const members=[{user_id:actor,role:'owner' as const,work_role:'manager',name:'Synthetic owner'}];
const now=Date.parse('2026-10-17T18:00:00Z');
const request=(op:string,extra={})=>new Request('https://example.test/dispatch',{method:'POST',headers:{Authorization:'Bearer synthetic-test-token'},body:JSON.stringify({op,orgId:org.id,...extra})});
function dependencies(role='owner',workRole='manager') {
  const state=emptyState(org,members,now);
  const calls:unknown[]=[];
  const replies:Record<string,unknown[]>={memberships:[{data:{role,work_role:workRole},error:null},{data:[{...members[0],role,work_role:workRole}],error:null}],organizations:[{data:org,error:null}],profiles:[{data:[{id:actor,full_name:'Synthetic owner'}],error:null}],workspace_state:[{data:{state,rev:1},error:null}]};
  const admin={from(table:string){calls.push(['from',table]);const result=replies[table]?.shift()??{data:null,error:null};const query={insert(value:unknown){calls.push(['insert',table,value]);return Promise.resolve({error:null});},select(){return query;},eq(){return query;},in(){return query;},gte(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return Promise.resolve(result);},single(){return Promise.resolve(result);},then(resolve:(x:unknown)=>void){return Promise.resolve(result).then(resolve);}};return query;},rpc:async(name:string,args:unknown)=>{calls.push(['rpc',name,args]);return {data:{ok:true,orgId:org.id,sourceRevision:1,opened:0,changed:0,resolved:0,complete:true},error:null};}};
  return {state,calls,replies,deps:{getUser:async()=>({id:actor,email:'synthetic@example.test'}),getAdmin:()=>admin,now:()=>now}};
}
test('HTTP boundary rejects anonymous and cross-tenant requests before reading task state',async()=>{
  const f=dependencies();
  const noAuth=await handleDispatch(request('operations'),{...f.deps,getUser:async()=>null});
  assert.equal(noAuth.status,401);assert.equal(f.calls.length,0);
  f.replies.memberships[0]={data:null,error:null};
  const foreign=await handleDispatch(request('operations'),f.deps);
  assert.equal(foreign.status,403);assert.deepEqual(f.calls,[['from','memberships']]);
});
test('HTTP operations feed is scoped, read-only and uses actual current organization authority',async()=>{
  const f=dependencies();const response=await handleDispatch(request('operations',{limit:2}),f.deps);
  assert.equal(response.status,200);const reply=await response.json();
  assert.equal(reply.snapshot.orgId,org.id);assert.equal(reply.snapshot.actor.id,actor);assert.equal(reply.snapshot.version,1);
  assert.equal(f.calls.some(c=>(c as string[])[0]==='rpc'),false);
});
test('member and reviewer sessions cannot run automation',async()=>{
  for(const [role,work] of [['member','sales'],['reviewer','reviewer'],['owner','reviewer']]) {
    const f=dependencies(role,work);const response=await handleDispatch(request('automation'),f.deps);
    assert.equal(response.status,403);assert.equal(f.calls.some(c=>(c as string[])[0]==='rpc'),false);
  }
});
test('manager automation passes only server-derived records and handles revision conflict',async()=>{
  const f=dependencies();f.deps.getAdmin().rpc=async(name,args)=>{f.calls.push(['rpc',name,args]);return {data:null,error:{code:'40001',message:'changed'}};};
  const response=await handleDispatch(request('automation',{records:[{orgId:'forged'}]}),f.deps);
  assert.equal(response.status,409);const rpc=f.calls.find(c=>(c as string[])[0]==='rpc') as [string,string,Record<string,unknown>];
  assert.equal(rpc[1],'sync_operational_attention');assert.equal(rpc[2].p_actor,actor);assert.equal(rpc[2].p_org,org.id);assert.deepEqual(rpc[2].p_records,[]);
});
test('operations reads never initialize or write an absent workspace',async()=>{
  const f=dependencies();f.replies.workspace_state[0]={data:null,error:null};
  assert.equal((await handleDispatch(request('operations'),f.deps)).status,409);
  assert.equal(f.calls.some(c=>(c as string[])[0]==='rpc'),false);
});
test('executive command preview reuses Claude core with authenticated principal and never commits an action',async()=>{
  const f=dependencies();const response=await handleDispatch(request('command-preview',{text:'Summarize my day',principal:'forged-user'}),f.deps);
  assert.equal(response.status,200);const reply=await response.json();assert.equal(reply.orgId,org.id);assert.equal(reply.preview.kind,'query');
  assert.ok(reply.preview.sources);assert.equal(f.calls.some(c=>(c as string[])[0]==='rpc'),false);
});
test('tick conflict does not return expired state that failed to commit',async()=>{
  const f=dependencies();f.state.grants.push({id:'expired',requester:actor,section:'company-work',reason:'Synthetic expiry',taskId:'synthetic-task',status:'approved',requestedAt:now-20000,decidedBy:actor,decidedAt:now-10000,durationSec:5,expiresAt:now-5000});
  f.deps.getAdmin().rpc=async()=>({data:{ok:false,conflict:true},error:null});
  const response=await handleDispatch(request('tick'),f.deps);assert.equal(response.status,409);
  assert.equal('state'in await response.json(),false);
});

test('durable intake events are bounded, scoped and omit contact envelopes',async()=>{
 const f=dependencies();f.replies.intake_events=[{data:[{id:'receipt',org_id:org.id,source_id:'synthetic.manual',external_id:'original',channel:'manual',source_url:'https://example.test/',lead_id:'lead',task_id:'task',accepted_at:'2026-10-17T17:00:00Z',event_kind:'intake.accepted',envelope:{contact:{email:'private-fixture@example.test'}}}],error:null}];
 const response=await handleDispatch(request('intake-events'),f.deps);assert.equal(response.status,200);const r=await response.json();
 assert.equal(r.events[0].orgId,org.id);assert.equal(r.events[0].channel,'manual');assert.equal('envelope'in r.events[0],false);assert.equal(f.calls.some(c=>(c as string[])[1]==='workspace_state'),false);
});

test('candidate HTTP claim uses server membership and cannot steal a previously claimed inquiry', async () => {
  const f = dependencies('member', 'sales');
  const lead = { id: 'synthetic-claim', name: 'Synthetic inquiry', source: 'fixture', phone: '', address: '', need: 'Estimate', arrivedAt: now, assignee: '', assignedAt: null, firstResponseAt: null, attempts: [], stage: 'new' as const, blocker: '', followUpTaskId: '', handoffTaskId: '', escalatedTo: '', simulated: true, updatedAt: now };
  f.state.leads.push(lead);
  let committed: unknown;
  f.deps.getAdmin().rpc = async (name, args) => {
    if (name === 'commit_workspace_action') { committed = args; return { data: { ok: true, rev: 2 }, error: null }; }
    return { data: { ok: true, rev: 2 }, error: null };
  };
  const response = await handleDispatch(request('dispatch', { expectedRev: 1, actor: 'forged', action: { type: 'lead/claim', id: lead.id } }), f.deps);
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(reply.state.leads[0].assignee, actor);
  assert.ok(committed);
  const claimed = dependencies('member', 'sales');
  claimed.state.leads.push({ ...lead, assignee: 'other-member' });
  const refusal = await handleDispatch(request('dispatch', { expectedRev: 1, action: { type: 'lead/claim', id: lead.id } }), claimed.deps);
  assert.equal(refusal.status, 422);
  assert.equal(claimed.calls.some(c => (c as string[])[1] === 'commit_workspace_action'), false);
});

test('search is read-only, rechecks current membership and ignores forged stored people', async () => {
  const f = dependencies();
  f.state.tasks.push({ id: 'search-task', title: 'Synthetic #MapleAve inquiry', description: '', owner: '', nextOwner: '', decisionOwner: '', approver: '', waitingOn: '', watchers: [], status: 'ready', priority: 'normal', due: '', nextAction: '', dependsOn: [], blocker: null, leadId: '', ultra: false, createdBy: actor, createdAt: now, updatedAt: now, lastActivityAt: now, completedAt: null });
  f.state.taxonomy = { types: [], tags: ['mapleave'] };
  f.state.people.push({ id: 'forged-person', name: 'Hidden Forged Person', role: 'manager', title: 'Forged' });
  const response = await handleDispatch(request('search', { query: { text: '#MAPLEAVE' } }), f.deps);
  assert.equal(response.status, 200);
  const reply = await response.json(); assert.equal(reply.results.length, 1); assert.equal(reply.results[0].target.id, 'search-task');
  assert.equal(JSON.stringify(reply).includes('Hidden Forged Person'), false);
  assert.equal(f.calls.some(c => (c as string[])[0] === 'rpc' || (c as string[])[0] === 'insert'), false);
  const denied = dependencies(); denied.replies.memberships[0] = { data: null, error: null };
  assert.equal((await handleDispatch(request('search', { query: { text: '#mapleave' } }), denied.deps)).status, 403);
  assert.equal(denied.calls.some(c => (c as string[])[1] === 'workspace_state'), false);
});
test('search never bootstraps an absent workspace or queries another tenant', async () => {
  const f = dependencies(); f.replies.workspace_state[0] = { data: null, error: null };
  const r = await handleDispatch(request('search', { query: { text: 'fixture' } }), f.deps);
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).results, []);
  assert.equal(f.calls.some(c => (c as string[])[0] === 'rpc'), false);
});
