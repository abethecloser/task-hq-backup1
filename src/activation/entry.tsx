import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {supabase} from '../auth/client';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/600.css';
import './activation.css';
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
type Identity={employee_id:string;name:string;company:string};
type Step='code'|'identity'|'verify'|'password'|'done';
const UNAVAILABLE_LINK='This setup link has expired, was already used, or was replaced by a newer one. Ask your manager to send you a new link.';
// Identity v1: the link says who the person is; a six-digit code sent to their email proves the
// address is theirs (Supabase Auth). Only then does the server redeem the link for that account.
function EmployeeActivation(){
 const[step,setStep]=useState<Step>(linkCode?'identity':'code'),[code,setCode]=useState(linkCode),[identity,setIdentity]=useState<Identity|null>(null),[confirmed,setConfirmed]=useState(false),
  [email,setEmail]=useState(''),[otp,setOtp]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(!!linkCode),[error,setError]=useState(''),[sentAt,setSentAt]=useState(0),[now,setNow]=useState(Date.now());
 useEffect(()=>{if(!sentAt)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[sentAt]);
 const wait=Math.max(0,60-Math.floor((now-sentAt)/1000));
 const unavailable=(m:string)=>/^Code unavailable/.test(m)?UNAVAILABLE_LINK:m;
 // Opened from a link: look the code up straight away, so the person lands on their identity.
 useEffect(()=>{if(!linkCode)return;call({action:'preview',code:linkCode}).then(result=>setIdentity(result.data)).catch(err=>{setStep('code');setError(unavailable((err as Error).message));}).finally(()=>setBusy(false));},[]);
 async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(err){setError(unavailable((err as Error).message));}finally{setBusy(false);}}
 async function sendCode(){
  // A setup link may be opened on a phone or tablet someone else is signed in on: start clean.
  await client!.auth.signOut({scope:'local'});
  const {error}=await client!.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:true,data:{full_name:identity!.name}}});
  if(error)throw new Error(/rate|security purposes/i.test(error.message)?'Please wait a minute before asking for another code.':'We couldn’t send a code to that email. Check the address and try again.');
  setSentAt(Date.now());setNow(Date.now());setOtp('');setStep('verify');
 }
 async function verify(){
  const {error}=await client!.auth.verifyOtp({email:email.trim(),token:otp.trim(),type:'email'});
  if(error)throw new Error('That code didn’t work. Check the latest email, or ask for a new code.');
  try{const result=await call({action:'activate',code,employee:identity!.employee_id,confirmed});setCode('');setStep(result.has_password?'done':'password');}
  catch(err){
   // Verified the email but the link didn't redeem: don't leave a half-signed-in session behind.
   await client!.auth.signOut({scope:'local'});const m=(err as Error).message;
   if(/email address your manager/.test(m)){setStep('identity');throw new Error('Use the email address your manager has on file for you. Ask them if you’re not sure which one.');}
   throw err;
  }
 }
 async function savePassword(){const {error}=await client!.auth.updateUser({password});setPassword('');if(error)throw new Error('Your account is active, but the password wasn’t saved. Try again, or sign in later with an email code.');setStep('done');}
 const title=step==='done'?'You’re ready to begin.':step==='password'?'Choose a password':step==='verify'?'Check your email':'Set up your account';
 return <main className="activation"><span className="activation-brand">Quest Task HQ</span><h1>{title}</h1>
  {step==='done'&&<><p>Your account is active. Starting a shift is a separate step.</p><a className="activation-button" href={home}>Continue to Task HQ</a><p>Check in explicitly when you’re ready to start your shift.</p></>}
  {step==='code'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await call({action:'preview',code});setIdentity(result.data);setStep('identity');});}}>
   <p>Open the setup link your manager sent you, or enter the code from it.</p>
   <label>Setup code<input required autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} spellCheck={false}/></label>
   {error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Please wait…':'Continue'}</button></form>}
  {step==='identity'&&(identity?<form onSubmit={e=>{e.preventDefault();void run(sendCode);}}>
   <p className="activation-identity"><strong>{identity.name}</strong><span>{identity.company}</span></p>
   <label className="activation-check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>This is me.</label>
   <label>Your email<input type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <p className="activation-hint">We’ll email you a six-digit code to confirm the address is yours. This link grants only the access your manager approved.</p>
   {error&&<p role="alert">{error}</p>}<button disabled={busy||!confirmed}>{busy?'Please wait…':'Email me a code'}</button></form>:<p>{busy?'Opening your setup link…':error}</p>)}
  {step==='verify'&&<form onSubmit={e=>{e.preventDefault();void run(verify);}}>
   <p>We sent a six-digit code to <strong>{email.trim()}</strong>. It may take a minute to arrive.</p>
   <label>Six-digit code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} autoFocus value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))}/></label>
   {error&&<p role="alert">{error}</p>}<button disabled={busy||otp.length<6}>{busy?'Please wait…':'Confirm and activate'}</button>
   <button type="button" className="activation-secondary" disabled={busy||wait>0} onClick={()=>void run(sendCode)}>{wait>0?`Send a new code in ${wait}s`:'Send a new code'}</button>
   <button type="button" className="activation-secondary" disabled={busy} onClick={()=>{setStep('identity');setOtp('');setError('');}}>Use a different email</button></form>}
  {step==='password'&&<form onSubmit={e=>{e.preventDefault();void run(savePassword);}}>
   <p>Your account is active. Choose a password for signing in next time.</p>
   <input type="email" autoComplete="username" value={email.trim()} readOnly hidden/>
   <label>Create password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <p className="activation-hint">Use at least 12 characters.</p>
   {error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Please wait…':'Save password'}</button></form>}
 </main>;
}
// Invites are created in Task-HQ: Team → People & access → Invite. This old address points there.
function AdminEntry(){return <main className="activation"><span className="activation-brand">Quest Task HQ · Administration</span><h1>Invites moved</h1><p>Create setup links and QR codes in Task HQ under People &amp; access → Invite.</p><a className="activation-button" href={`${home.replace(/\/$/,'')}/#/people`}>Open People &amp; access</a></main>;}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('admin')?<AdminEntry/>:<EmployeeActivation/>);
