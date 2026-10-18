// Narrow service-side RPC interface; never accepts a browser client directly.
import type { MemberRow } from './logic.ts';
import type { QuestState } from './core/contract.ts';
export interface PersistenceRpc {
  rpc(name: string, args: Record<string,unknown>): PromiseLike<{data: unknown; error: {code?:string;message:string}|null}>;
}
export function authorityFor(members: MemberRow[]): string[][] {
  return members.map(m=>[m.user_id,m.role,m.work_role]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
}
export async function commitWorkspace(client:PersistenceRpc,orgId:string,actor:string,revision:number,state:QuestState,action:string,detail:Record<string,unknown>,authority:string[][]) {
  const {data,error}=await client.rpc('commit_workspace_action',{p_org:orgId,p_actor:actor,p_expected_rev:revision,p_state:state,p_action:action,p_detail:detail,p_authority:authority});
  if(error?.code==='40001') return {ok:false as const,status:409,conflict:true,error:'Workspace authority changed. Reload and try again.'};
  if(error?.code==='42501') return {ok:false as const,status:403,error:'Workspace access changed. Reload before retrying.'};
  if(error) return {ok:false as const,status:500,error:'Save could not be confirmed. Reload before retrying.'};
  const result=data as {ok?:boolean;conflict?:boolean;rev?:number}|null;
  if(result?.conflict) return {ok:false as const,status:409,conflict:true,error:'Someone else changed this workspace. Reload and try again.'};
  if(!result?.ok || result.rev!==revision+1) return {ok:false as const,status:500,error:'Save could not be confirmed. Reload before retrying.'};
  return {ok:true as const,rev:result.rev,state:{...state,rev:result.rev}};
}
