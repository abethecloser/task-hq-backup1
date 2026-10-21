import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from '../auth/client.ts';
import { useSession } from '../auth/AuthScreen.tsx';
import { demoUrl } from '../auth/mode.ts';
import type { QuestState } from '../core/contract.ts';
import { ShiftModule } from './ShiftModule.tsx';
import { liveShiftBackend } from './backend.ts';
import type { ShiftContext, ShiftSnapshot } from './types.ts';
import { Select } from '../ui/Select.tsx';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '../ui/quest.css';
import './shift.css';
interface OrgChoice {id:string;name:string;role:string;work_role:string}
function Authenticated() {
 const session=useSession(),client=supabase(),[actor,setActor]=useState(''),[orgs,setOrgs]=useState<OrgChoice[]>([]),[org,setOrg]=useState(''),[state,setState]=useState<QuestState|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!client||!session.email)return;let active=true;
  void (async()=>{
   const {data:user,error:authError}=await client.auth.getUser();if(authError||!user.user)throw new Error(authError?.message??'Sign in again.');
   const {data,error}=await client.from('memberships').select('org_id,role,work_role,organizations(id,name)').eq('user_id',user.user.id);if(error)throw error;
   const choices=(data??[]).map(row=>{const item=row as unknown as {org_id:string;role:string;work_role:string;organizations:{id:string;name:string}|null};return{id:item.org_id,name:item.organizations?.name??item.org_id,role:item.role,work_role:item.work_role};});
   const retained=await client.rpc('shift_list',{p_org:null,p_team:false});
   for(const shift of (retained.data as ShiftSnapshot|null)?.shifts??[])if(!choices.some(item=>item.id===shift.org_id))choices.push({id:shift.org_id,name:`Previous workspace · ${shift.org_id.slice(0,8)}`,role:'former',work_role:'field'});
   if(active){setActor(user.user.id);setOrgs(choices);setOrg(current=>choices.some(item=>item.id===current)?current:choices[0]?.id??'');}
  })().catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));});
  return()=>{active=false;};
 },[client,session.email]);
 useEffect(()=>{if(!client||!org)return;let active=true;setState(null);void client.from('workspace_state').select('state').eq('org_id',org).maybeSingle().then(({data})=>{if(active)setState(data?.state as QuestState??null);});return()=>{active=false;};},[client,org]);
 const choice=orgs.find(item=>item.id===org);
 const context=useMemo<ShiftContext>(()=>({org,actor,manager:!!choice&&['owner','admin','supervisor'].includes(choice.role),canCheckIn:!!choice&&!['reviewer','former'].includes(choice.role)&&choice.work_role!=='reviewer',tasks:state?.tasks??[],projects:state?.projects??[],events:state?.events??[]}),[org,actor,choice,state]);
 const backend=useMemo(()=>client&&actor&&org?liveShiftBackend(client,org,actor):null,[client,actor,org]);
 return <main className="shift-standalone"><h1>Quest Shift & Activity</h1>{!session.ready?<p>Checking your existing sign-in…</p>:!session.email?<><p>Sign in to Task HQ, then return here. Signing in does not start a shift.</p><a className="btn" href="/">Open Task HQ sign-in</a><a className="btn" href="/?demo=1#/home">Explore the Task HQ demo</a></>:<>
  <label>Workspace<Select aria-label="Shift workspace" value={org} onChange={event=>setOrg(event.target.value)}>{orgs.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
  {!orgs.length&&<p>No active memberships or retained shifts were found. Existing attendance access never depends on opening a new shift.</p>}
  {backend&&<ShiftModule backend={backend} context={context} name={choice?.name??'Your shift'}/>}
 </>}{error&&<p role="alert">{error}</p>}</main>;
}
function Entry(){
 if(new URLSearchParams(location.search).get('demo')==='1'){location.replace(demoUrl(location.href));return null;}
 return <Authenticated/>;
}
createRoot(document.getElementById('shift-root')!).render(<StrictMode><Entry/></StrictMode>);
