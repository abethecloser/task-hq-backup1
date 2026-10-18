import { projectExecutive } from './executive-interface.ts';
// Backend orchestration over Claude's existing rules, not a second business-rule engine.
import type { QuestState } from '../core/contract.ts';
import { apply } from '../core/engine.ts';
import { insights } from '../core/rules.ts';
import type { AttentionRecord, AutomationPlan, OperationalSnapshot } from './contract.ts';
const MAX_BATCH = 200;
const bounds = (limit: number) => Number.isInteger(limit) ? Math.max(1,Math.min(MAX_BATCH,limit)) : 100;
export function projectOperations(state: QuestState, orgId: string, actor: string, now: number, canRunAutomation = false, requestedLimit = 100): OperationalSnapshot {
  if (state.workspace.tenantId !== orgId || !state.people.some(p=>p.id===actor)) throw new Error('Organization membership required.');
  if (!Number.isFinite(now)) throw new Error('A valid server time is required.');
  if (state.tasks.length+state.leads.length+state.grants.length>2000) throw new Error('Workspace exceeds the bounded operational evaluation limit.');
  const limit=bounds(requestedLimit);
  const people=new Set(state.people.filter(p=>p.role!=='reviewer').map(p=>p.id));
  // Stored ownership can outlive membership. Project current operational
  // authority without rewriting the historical workspace or inventing an owner.
  const operational={...state,tasks:state.tasks.map(t=>people.has(t.owner)?t:{...t,owner:''}),leads:state.leads.map(l=>people.has(l.assignee)?l:{...l,assignee:''})};
  const all: AttentionRecord[]=insights(operational,now).map(insight=>({
    id:insight.id,orgId,rule:insight.kind,severity:insight.severity,
    subject:insight.grantId?{kind:'grant',id:insight.grantId}:insight.leadId?{kind:'lead',id:insight.leadId}:{kind:'task',id:insight.taskId!},
    accountableId:people.has(insight.who)?insight.who:null,assignmentRequired:!people.has(insight.who)||insight.kind==='unassigned'||insight.kind==='lead-unassigned'||!!(insight.taskId&&!people.has(state.tasks.find(t=>t.id===insight.taskId)?.owner??''))||!!(insight.leadId&&!people.has(state.leads.find(l=>l.id===insight.leadId)?.assignee??'')),
    conditionVersion:insight.taskId?state.tasks.find(t=>t.id===insight.taskId)?.updatedAt??0:insight.leadId?state.leads.find(l=>l.id===insight.leadId)?.updatedAt??0:state.grants.find(g=>g.id===insight.grantId)?.decidedAt??0,
    what:insight.what,why:insight.why,nextAction:insight.next,
    suggestedAction:insight.action && apply(state,insight.action.do,{actor,now,newId:()=> 'permission-preview'}).ok?insight.action.do:null,
  }));
  // Stable order within each severity makes bounded snapshots and replay predictable.
  const order={critical:0,high:1,normal:2};
  all.sort((a,b)=>order[a.severity]-order[b.severity] || a.id.localeCompare(b.id));
  const decisions=all.filter(x=>x.rule==='approval'||x.rule==='ultra-request');
  const tasks=state.tasks.filter(t=>t.status!=='done').sort((a,b)=>a.id.localeCompare(b.id));
  const leads=state.leads.filter(l=>l.stage!=='won'&&l.stage!=='lost').sort((a,b)=>a.id.localeCompare(b.id));
  const activity=[...state.events].sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
  return {
    version:1,orgId,revision:state.rev,generatedAt:now,runtimeTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,intelligence:projectExecutive(operational,actor,now,limit),actor:{id:actor,canRunAutomation},
    executive:{openTasks:tasks.length,openLeads:leads.length,attentionTotal:all.length,decisionsTotal:decisions.length},
    attention:all.slice(0,limit),decisions:decisions.slice(0,limit),
    tasks:tasks.slice(0,limit).map(t=>({id:t.id,orgId,title:t.title,owner:people.has(t.owner)?t.owner:null,status:t.status,nextAction:t.nextAction,due:t.due,leadId:t.leadId||null})),
    leads:leads.slice(0,limit).map(l=>({id:l.id,orgId,name:l.name,owner:people.has(l.assignee)?l.assignee:null,stage:l.stage,arrivedAt:l.arrivedAt,firstResponseAt:l.firstResponseAt,followUpTaskId:l.followUpTaskId||null,source:l.source,simulated:l.simulated})),
    activity:activity.slice(0,limit).map(e=>({id:e.id,orgId,at:e.at,actor:e.actor,kind:e.kind,text:e.text,taskId:e.taskId||null,leadId:e.leadId||null})),
    coverage:{attentionComplete:all.length<=limit,tasksComplete:tasks.length<=limit,leadsComplete:leads.length<=limit,activityComplete:activity.length<=limit,activityRetention:'workspace-history',oldestAvailableAt:activity.at(-1)?.at??null},
  };
}
/** Viewer-dependent action offers never enter the durable record. SQL compares
 * meaningful rule fields instead of changing SLA countdown prose. */
export function automationPlan(snapshot: OperationalSnapshot): AutomationPlan {
  return {version:1,orgId:snapshot.orgId,sourceRevision:snapshot.revision,total:snapshot.executive.attentionTotal,complete:snapshot.coverage.attentionComplete,
    records:snapshot.attention.map(r=>({...r,suggestedAction:null}))};
}
