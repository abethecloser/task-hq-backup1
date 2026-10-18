// Authorized transport wrapper over Claude-owned executive functions. No new
// intelligence, ranking, parsing, recommendations or synthetic backend records.
import type { QuestState } from '../core/contract.ts';
import { executiveBrief,decisionDesk,followUps,dailySignal } from '../core/executive.ts';
import type { ExecutiveBrief,Decision,FollowUp,DailySignal } from '../core/executive.ts';
export interface ExecutiveBundle { brief:ExecutiveBrief; decisionDesk:Decision[]; followUps:FollowUp[]; dailySignal:DailySignal; complete:boolean; source:'shared-core' }
export function projectExecutive(state:QuestState,principal:string,now:number,limit:number):ExecutiveBundle {
  const brief=executiveBrief(state,now,principal);
  const decisions=decisionDesk(state,now,principal),follow=followUps(state,now,principal),signal=dailySignal(state,now);
  const complete=brief.sections.every(s=>s.items.length<=limit)&&decisions.length<=limit&&follow.length<=limit&&signal.entries.length<=limit;
  return {source:'shared-core',complete,
    brief:{...brief,sections:brief.sections.map(section=>({...section,...(section.items.length>limit?{status:'partial' as const,note:'Operational response limit reached; additional records are available in Task-HQ.'}:{}),items:section.items.slice(0,limit)}))},
    decisionDesk:decisions.slice(0,limit),followUps:follow.slice(0,limit),dailySignal:{...signal,entries:signal.entries.slice(-limit)}};
}
