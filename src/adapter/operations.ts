import type { OperationsReply, AutomationReceipt, OperationalSnapshot, CommandPreviewReply, IntakeEventsReply } from '../automation/contract.ts';
export interface OperationsSession { auth: {getSession(): Promise<{data:{session:{access_token:string}|null}}> } }
export type OperationsResult = {ok:true;snapshot:OperationalSnapshot}|{ok:false;error:string;conflict?:boolean};
/** Authenticated integration client for Claude/Copilot. No database credentials,
 * cached tenant data, inferred membership, voice execution, or outgoing messages. */
export function createOperationsClient(client:OperationsSession,url:string,publishableKey:string,orgId:string,fetcher:typeof fetch=fetch) {
  async function call(op:'operations'|'automation'|'command-preview'|'intake-events',limit?:number,command?:{since?:string;text?:string;subject?:{taskId?:string;leadId?:string}}) {
    try {
      const {data}=await client.auth.getSession();
      if(!data.session) return {ok:false as const,error:'Sign in again.'};
      const response=await fetcher(`${url.replace(/\/$/,'')}/functions/v1/dispatch`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`,apikey:publishableKey},
        body:JSON.stringify({op,orgId,...(limit===undefined?{}:{limit}),...command}),signal:AbortSignal.timeout(15000),
      });
      const reply=await response.json() as OperationsReply|AutomationReceipt|CommandPreviewReply|IntakeEventsReply;
      if(!response.ok||!reply.ok) return {ok:false as const,error:!reply.ok?reply.error:'Operational request failed.',conflict:'conflict' in reply&&reply.conflict===true};
      if(op==='operations' && (!('snapshot'in reply)||!reply.snapshot||reply.snapshot.orgId!==orgId||reply.snapshot.version!==1||!Number.isInteger(reply.snapshot.revision)||!Number.isFinite(reply.snapshot.generatedAt)||!reply.snapshot.intelligence||!['attention','decisions','tasks','leads','activity'].every(key=>{const records=reply.snapshot[key as 'tasks'];return Array.isArray(records)&&records.every(record=>record.orgId===orgId);}))) return {ok:false as const,error:'Unexpected operational response.'};
      if(op==='automation' && (!('sourceRevision'in reply)||reply.orgId!==orgId||!Number.isInteger(reply.sourceRevision)||!['opened','changed','resolved'].every(key=>Number.isInteger(reply[key as 'opened'])&&reply[key as 'opened']>=0))) return {ok:false as const,error:'Unexpected automation response.'};
      if(op==='command-preview' && (!('preview'in reply)||reply.orgId!==orgId)) return {ok:false as const,error:'Unexpected command preview response.'};
      if(op==='intake-events' && (!('events'in reply)||reply.orgId!==orgId||!Array.isArray(reply.events)||reply.events.some(event=>event.orgId!==orgId))) return {ok:false as const,error:'Unexpected intake event response.'};
      return reply;
    }catch{return {ok:false as const,error:'Operational request was not confirmed. Reload before retrying.'};}
  }
  return {
    async intakeEvents(since?:string,limit=100):Promise<IntakeEventsReply> {return await call('intake-events',limit,{since}) as IntakeEventsReply;},
    async previewCommand(text:string,subject?:{taskId?:string;leadId?:string}):Promise<CommandPreviewReply> {return await call('command-preview',undefined,{text,subject}) as CommandPreviewReply;},
    async snapshot(limit=100):Promise<OperationsResult> {return await call('operations',limit) as OperationsResult;},
    async runAutomation():Promise<AutomationReceipt|{ok:false;error:string;conflict?:boolean}> {return await call('automation') as AutomationReceipt|{ok:false;error:string;conflict?:boolean};},
  };
}
