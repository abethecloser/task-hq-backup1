import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../../supabase/functions/dispatch/logic.ts';
import {runAction} from '../../supabase/functions/dispatch/logic.ts';
import {automationPlan,projectOperations} from './project.ts';
const org={id:'synthetic-org',slug:'synthetic',name:'Synthetic',preset:'general'};
const members=[{user_id:'owner',role:'owner' as const,work_role:'manager',name:'Synthetic Owner'}];
const now=Date.parse('2026-10-17T18:00:00Z');
function fixture(){const empty=emptyState(org,members,now);const r=runAction(empty,org,members,'owner',{type:'task/create',task:{title:'Synthetic overdue follow-up',owner:'owner',due:'2026-10-16',nextAction:'Review synthetic inquiry'}},now);assert.equal(r.ok,true);return r.state;}
test('existing workflow rules project organization-scoped executive, decision and follow-up data without mutation',()=>{
  const state=fixture(),before=JSON.stringify(state);const feed=projectOperations(state,org.id,'owner',now,true);
  assert.equal(feed.executive.openTasks,1);assert.ok(feed.attention.some(r=>r.rule==='overdue'&&r.accountableId==='owner'));
  assert.ok(feed.tasks.every(r=>r.orgId===org.id));assert.equal(JSON.stringify(state),before);
  assert.deepEqual(automationPlan(feed),automationPlan(projectOperations(state,org.id,'owner',now,true)));
});
test('foreign organization and missing actor fail closed',()=>{
  assert.throws(()=>projectOperations(fixture(),'foreign','owner',now),/membership/);
  assert.throws(()=>projectOperations(fixture(),org.id,'outsider',now),/membership/);
});
test('bounded output reports incomplete coverage and stable keys rather than silently dropping work',()=>{
  const state=fixture();state.tasks.push({...state.tasks[0],id:'second',owner:'',nextAction:''});
  const feed=projectOperations(state,org.id,'owner',now,true,1);
  assert.equal(feed.tasks.length,1);assert.equal(feed.coverage.tasksComplete,false);assert.equal(feed.coverage.attentionComplete,false);
  assert.equal(automationPlan(feed).complete,false);assert.ok(automationPlan(feed).records.every(r=>r.suggestedAction===null));
});
test('removed owners stay unknown; no default to an account or fabricated contact response',()=>{
  const state=fixture();state.tasks[0].owner='former-member';
  const feed=projectOperations(state,org.id,'owner',now,true);
  assert.equal(feed.tasks[0].owner,null);const overdue=feed.attention.find(r=>r.rule==='overdue');
  assert.equal(overdue?.accountableId,'owner');assert.equal(overdue?.assignmentRequired,true);
  assert.equal(state.tasks[0].owner,'former-member'); // Manager handles assignment; no task is reassigned.
});
test('reviewer never receives a state-changing action offer',()=>{
  const state=fixture();state.people.push({id:'reviewer',name:'Synthetic Reviewer',role:'reviewer',title:'Reviewer'});
  assert.ok(projectOperations(state,org.id,'reviewer',now).attention.every(r=>r.suggestedAction===null));
});
test('Claude executive outputs are served through shared core with disconnected-source status intact',()=>{
 const feed=projectOperations(fixture(),org.id,'owner',now,true);
 assert.equal(feed.intelligence.source,'shared-core');assert.equal(feed.intelligence.brief.principal,'owner');
 assert.ok(feed.intelligence.followUps.some(item=>item.kind==='missed-deadline'));
 assert.equal(feed.intelligence.dailySignal.sources.find(s=>s.id==='calls')?.status,'not-connected');
});
test('unowned work requests assignment even when a manager is accountable for the request',()=>{
 const state=fixture();state.tasks[0].owner='removed-account';state.tasks[0].due='2026-10-20';
 const before=JSON.stringify(state),feed=projectOperations(state,org.id,'owner',now,true);
 const request=feed.attention.find(r=>r.rule==='unassigned');assert.ok(request);assert.equal(request.assignmentRequired,true);assert.equal(request.accountableId,'owner');
 assert.equal(JSON.stringify(state),before);assert.equal(state.tasks[0].owner,'removed-account');
});
