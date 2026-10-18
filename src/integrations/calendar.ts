import type { CalendarFeed } from '../core/executive.ts';
export interface CalendarReference { version:1;orgId:string;sourceId:string;feed:CalendarFeed }
/** Normalize explicitly supplied scoped calendar facts. Not OAuth, account
 * discovery, ICS fetching, scheduling, or permission verification. The caller
 * must obtain authorization before supplying non-synthetic provider data. */
export function normalizeCalendarReferences(input:unknown,scope:{orgId:string;sourceId:string;synthetic:boolean}):{ok:true;reference:CalendarReference}|{ok:false;error:string} {
  if(!scope.orgId||!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(scope.sourceId)||typeof scope.synthetic!=='boolean')return {ok:false,error:'Supply an explicit organization, source and synthetic status.'};
  if(!input||typeof input!=='object'||!('appointments'in input)||!Array.isArray(input.appointments)||input.appointments.length>100)return {ok:false,error:'Supply at most 100 appointment references.'};
  if('orgId'in input && input.orgId!==scope.orgId)return {ok:false,error:'Calendar organization does not match its authorized scope.'};
  const appointments:CalendarFeed['appointments']=[];const seen=new Set<string>();
  for(const item of input.appointments) {
    if(!item||typeof item!=='object')return {ok:false,error:'Invalid appointment reference.'};
    const {id,title,start,end}=item;
    if(typeof id!=='string'||!id.trim()||id.length>200||seen.has(id)||typeof title!=='string'||!title.trim()||title.length>160
      ||/[\u0000-\u001f\u007f]/.test(id+title)||typeof start!=='number'||!Number.isFinite(start)||!Number.isFinite(new Date(start).getTime())
      ||(end!==undefined&&(typeof end!=='number'||!Number.isFinite(end)||!Number.isFinite(new Date(end).getTime())||end<=start)))return {ok:false,error:'Appointment IDs, titles and time ranges must be valid and unique.'};
    seen.add(id);appointments.push({id,title:title.trim(),start,...(end===undefined?{}:{end})});
  }
  appointments.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
  return {ok:true,reference:{version:1,orgId:scope.orgId,sourceId:scope.sourceId,feed:{source:scope.sourceId,synthetic:scope.synthetic,appointments}}};
}
