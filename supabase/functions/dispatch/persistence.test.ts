import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commitWorkspace} from './persistence.ts';
import {emptyState} from './logic.ts';
const org={id:'synthetic-org',slug:'synthetic',name:'Synthetic',preset:'general'};
const state=emptyState(org,[],0);
test('atomic commit confirms revision and state together; no state returned after conflict or audit failure',async()=>{
  const success=await commitWorkspace({rpc:async()=>({data:{ok:true,rev:2},error:null})},org.id,'actor',1,state,'task.create',{},[]);
  assert.equal(success.ok,true);if(success.ok) assert.equal(success.state.rev,2);
  const conflict=await commitWorkspace({rpc:async()=>({data:{ok:false,conflict:true},error:null})},org.id,'actor',1,state,'task.create',{},[]);
  assert.equal(conflict.ok,false);assert.equal('state'in conflict,false);if(!conflict.ok)assert.equal(conflict.status,409);
  const failure=await commitWorkspace({rpc:async()=>({data:null,error:{code:'23514',message:'audit failed'}})},org.id,'actor',1,state,'task.create',{},[]);
  assert.equal(failure.ok,false);assert.equal('state'in failure,false);
});
test('malformed success cannot fabricate a saved revision',async()=>{
  const result=await commitWorkspace({rpc:async()=>({data:{ok:true,rev:999},error:null})},org.id,'actor',1,state,'task.create',{},[]);
  assert.equal(result.ok,false);
});
test('revoked authority is a conflict requiring reevaluation, never a fabricated commit',async()=>{
 const result=await commitWorkspace({rpc:async()=>({data:null,error:{code:'40001',message:'authority changed'}})},org.id,'actor',1,state,'task.create',{},[]);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.status,409);assert.equal('state'in result,false);
});
test('authority fingerprint ignores presentation names but detects membership role changes',async()=>{
 const {authorityFor}=await import('./persistence.ts');
 const members=[{user_id:'b',role:'member' as const,work_role:'field',name:'Synthetic B'},{user_id:'a',role:'owner' as const,work_role:'manager',name:'Synthetic A'}];
 assert.deepEqual(authorityFor(members),[['a','owner','manager'],['b','member','field']]);
 assert.deepEqual(authorityFor(members.map(m=>({...m,name:'Renamed'}))),authorityFor(members));
 assert.notDeepEqual(authorityFor([{...members[0],role:'reviewer'},members[1]]),authorityFor(members));
});
