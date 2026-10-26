import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedState, blankTask } from './seed.ts';
import { apply } from './engine.ts';
import { completionDetails } from './completed.ts';
import { completedQuery, isCompletedQuery, queryTasks } from './registry.ts';
const now = Date.parse('2026-10-21T18:00:00Z');

test('Completed reuses Done records, newest first, with My Work and Company scope', () => {
 const state = seedState(now); state.tasks = [];
 for (const [id,owner,at] of [['old','alex',now-5000],['new','maya',now-1000],['mine','alex',now-2000]] as const) {
  const task=blankTask(id,{title:id,owner},'jordan',now-10000);
  Object.assign(task,{status:'done',completedAt:at,completedBy:owner});state.tasks.push(task);
 }
 const archived={...state.tasks[0]!,id:'archived',archivedAt:now,archivedBy:'alex'}; state.tasks.push(archived);
 assert.equal(isCompletedQuery(completedQuery('mine')),true);
 const company=queryTasks(state,'alex',now,completedQuery('company'));
 assert.deepEqual(company.map(t=>t.id),['new','mine','old']);
 assert.equal(company[0],state.tasks[1], 'the same record, never a copied completion');
 assert.deepEqual(queryTasks(state,'alex',now,completedQuery('mine')).map(t=>t.id),['mine','old']);
 assert.deepEqual(queryTasks(state,'alex',now,{...completedQuery('company'),status:'archived'}).map(t=>t.id),['archived']);
});

test('persisted completion provenance survives missing history; legacy history is a factual fallback', () => {
 const state=seedState(now);const task=state.tasks.find(t=>t.status==='done')!;
 Object.assign(task,{completedBy:'maya',completedAt:now-1000});state.events=[];
 assert.deepEqual(completionDetails(state,task),{actor:'maya',at:now-1000});
 task.completedBy='';task.completedAt=null;
 assert.deepEqual(completionDetails(state,task),{actor:'',at:null});
 state.events=[{id:'finish',taskId:task.id,actor:'jordan',at:now-500,undo:{tasks:{[task.id]:{...task,status:'working'}},leads:{}}}] as typeof state.events;
 assert.deepEqual(completionDetails(state,task),{actor:'jordan',at:now-500});
 state.events[0]!.undone=true;
 assert.deepEqual(completionDetails(state,task),{actor:'',at:null});
});

test('completion, reopen and archive use existing authorized transitions and never duplicate tasks', () => {
 let state=seedState(now);state.focus=null;state.tasks=[{...blankTask('work',{title:'Check access',owner:'alex'},'jordan',now),status:'working'}];
 const move=(actor:string,action:Parameters<typeof apply>[1])=>{const result=apply(state,action,{actor,now});if(result.ok)state=result.state;return result;};
 assert.equal(move('alex',{type:'task/advance',id:'work'}).ok,true);
 assert.equal(queryTasks(state,'alex',now,completedQuery('mine')).length,1);
 assert.equal(completionDetails(state,state.tasks[0]!).actor,'alex');
 assert.equal(move('sam',{type:'task/reopen',id:'work',note:'Check another gate'}).ok,false);
 assert.equal(move('sam',{type:'task/archive',id:'work'}).ok,false);
 assert.equal(move('alex',{type:'task/archive',id:'work'}).ok,true);
 assert.equal(queryTasks(state,'alex',now,completedQuery('mine')).length,0);
 assert.equal(move('alex',{type:'task/unarchive',id:'work'}).ok,true);
 assert.equal(move('alex',{type:'task/reopen',id:'work',note:'Check another gate'}).ok,true);
 assert.equal(queryTasks(state,'alex',now,completedQuery('mine')).length,0);
 assert.equal(state.tasks.length,1);
});
