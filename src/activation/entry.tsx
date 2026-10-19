import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {supabase} from '../auth/client';
import {AuthScreen,useSession,type AuthView} from '../auth/AuthScreen';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/600.css';
import './activation.css';
type Employee={id:string;name:string;role:string;status:string;affiliation_confirmed:boolean;expires_at:string|null};
const client=supabase();
// A single-use activation link carries the code in the fragment (#code=…), which browsers never send
// to the server or in referrers. Read it once at load, then remove it from the address bar and history.
function codeFromLink(){const m=/(?:^#|&)code=([^&]+)/.exec(location.hash);if(!m)return '';history.replaceState(null,'',location.pathname+location.search);try{return decodeURIComponent(m[1]!);}catch{return '';}}
const linkCode=new URLSearchParams(location.search).has('admin')?'':codeFromLink();
const home=import.meta.env.VITE_TASK_HQ_HOME || '/';
async function call(body:Record<string,unknown>){
 if(!client)throw new Error('Supabase is not configured.');
 const {data,error}=await client.functions.invoke('employee-activation',{body});
 if(error) {let message='Activation is unavailable. Please try again.';try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}
 if(data.error)throw new Error(data.error);return data;
}
function EmployeeActivation(){
 const[code,setCode]=useState(linkCode),[identity,setIdentity]=useState<{employee_id:string;name:string;company:string}|null>(null),[confirmed,setConfirmed]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 // Opened from a link: look the code up straight away, so the employee lands on their identity.
 useEffect(()=>{if(!linkCode)return;setBusy(true);call({action:'preview',code:linkCode}).then(result=>setIdentity(result.data)).catch(err=>setError((err as Error).message)).finally(()=>setBusy(false));},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
  if(!identity){const result=await call({action:'preview',code});setIdentity(result.data);}
  else{await call({action:'redeem',code,employee:identity.employee_id,confirmed,email,password});
   const {error}=await client!.auth.signInWithPassword({email:email.trim(),password});setPassword('');
   if(error)throw new Error('Your account is activated. Use normal sign-in with the email and password you chose.');setDone(true);setCode('');}
 }catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <main className="activation"><span className="activation-brand">Quest Task HQ</span><h1>{done?'You’re ready to begin.':'Activate your account'}</h1>
 {done?<><p>Your account is active. Starting a shift is a separate step.</p><a className="activation-button" href={home}>Continue to Task HQ</a><p>Check in explicitly when you’re ready to start your shift.</p></>:<form onSubmit={submit}>
 {!identity?<><p>Enter the one-time code provided by your administrator.</p><label>Activation code<input required autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} spellCheck={false}/></label></>:<><p className="activation-identity"><strong>{identity.name}</strong><span>{identity.company}</span></p><label className="activation-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>This is my employee identity.</label>
 <label>Your email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Create password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label><p className="activation-hint">Use at least 12 characters. Your code grants only the workspace access your administrator approved.</p></>}
 {error&&<p role="alert">{error}</p>}<button disabled={busy||!!identity&&!confirmed}>{busy?'Please wait…':identity?'Activate and sign in':'Continue'}</button>
 {identity&&<button type="button" className="activation-secondary" disabled={busy} onClick={()=>{setIdentity(null);setConfirmed(false);setPassword('');setError('');}}>Use a different code</button>}</form>}
 </main>;
}
function Admin(){
 const[orgs,setOrgs]=useState<{id:string;name:string}[]>([]),[org,setOrg]=useState(''),[employees,setEmployees]=useState<Employee[]>([]),[employee,setEmployee]=useState(''),[code,setCode]=useState(''),[expires,setExpires]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;(async()=>{if(!client)throw new Error('Supabase is not configured.');const {data:{user}}=await client.auth.getUser();if(!user)throw new Error('Sign in to Task HQ as an administrator first.');const {data,error}=await client.from('memberships').select('org_id,role,organizations(id,name)').eq('user_id',user.id).in('role',['owner','admin']);if(error)throw error;const orgs=(data??[]).flatMap(row=>{const item=row.organizations as unknown as {id:string;name:string}|null;return item?[item]:[];});if(alive){setOrgs(orgs);setOrg(orgs[0]?.id??'');if(!orgs.length)setError('Sign in as a workspace owner or administrator first.');}})().catch(err=>alive&&setError(err.message));return()=>{alive=false;};},[]);
 useEffect(()=>{let alive=true;setCode('');setEmployee('');setEmployees([]);if(org)call({action:'list',org}).then(result=>{if(alive)setEmployees(result.data);}).catch(err=>alive&&setError(err.message));return()=>{alive=false;};},[org]);
 async function act(action:'generate'|'revoke'){setBusy(true);setError('');setCode('');try{const result=await call({action,org,employee});if(result.code){setCode(result.code);setExpires(result.data.expires_at);}const list=await call({action:'list',org});setEmployees(list.data);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 const selected=employees.find(e=>e.id===employee);
 return <main className="activation"><span className="activation-brand">Quest Task HQ · Administration</span><h1>Team activation</h1><p>Codes expire after 24 hours. Regenerating revokes the previous code. Share codes privately with the intended employee.</p>
 <label>Workspace<select value={org} onChange={e=>setOrg(e.target.value)} disabled={busy}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
 <label>Employee<select value={employee} onChange={e=>{setEmployee(e.target.value);setCode('');}} disabled={busy}><option value="">Select existing employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.status}</option>)}</select></label>
 {selected&&<><p>Status: <strong>{selected.status}</strong> · {selected.role}</p><p className="activation-hint">Employee ID: {selected.id}</p>{!selected.affiliation_confirmed&&<p>Confirm affiliation in People &amp; Roles before issuing a code.</p>}
 <button disabled={busy||selected.status==='active'||!selected.affiliation_confirmed} onClick={()=>void act('generate')}>{selected.status==='pending'?'Regenerate code':'Generate one-time code'}</button><button className="activation-secondary" disabled={busy||selected.status!=='pending'} onClick={()=>void act('revoke')}>Revoke code</button></>}
 {code&&<section aria-live="polite"><p>Copy this code now. It is shown only here.</p><output>{code}</output><p>Expires {new Date(expires).toLocaleString()}</p><p>Activation page: <a href={location.pathname}>{location.origin+location.pathname}</a></p></section>}
 {error&&<p role="alert">{error}</p>}<a href={home}>Return to Task HQ</a></main>;
}
function AdminEntry(){const session=useSession(),[view,setView]=useState<AuthView>('sign-in');if(!session.ready)return <main className="activation"><p>Checking your sign-in…</p></main>;if(!session.email||session.recovery)return <AuthScreen view={session.recovery?'reset':view} go={setView} onDemo={()=>location.assign(home)}/>;return <Admin key={session.email}/>;}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('admin')?<AdminEntry/>:<EmployeeActivation/>);
