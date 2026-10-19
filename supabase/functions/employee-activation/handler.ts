// No credentials, raw codes or passwords are logged or persisted by this endpoint.
export interface ActivationDependencies {
 rpc(name:string,args:Record<string,unknown>):Promise<unknown>;
 admin(authorization:string,org:string,action:string,employee?:string,hash?:string):Promise<unknown>;
 createUser(input:{email:string;password:string;email_confirm:true;app_metadata:Record<string,string>;user_metadata:Record<string,string>}):Promise<void>;
}
export const hashCode=async(code:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export function newCode(){return Array.from(crypto.getRandomValues(new Uint8Array(24))).map(n=>n.toString(16).padStart(2,'0')).join('').match(/.{1,6}/g)!.join('-').toUpperCase();}
export const normalizeCode=(s:string)=>s.replace(/[-\s]/g,'').toLowerCase();
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function handleActivation(req:Request,deps:ActivationDependencies):Promise<Response>{
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
 const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
 if(req.method==='OPTIONS')return reply(200,{});
 if(req.method!=='POST')return reply(405,{error:'POST required.'});
 try{
  if(Number(req.headers.get('content-length')||0)>8192)return reply(413,{error:'Request too large.'});
  const raw=await req.text();if(raw.length>8192)return reply(413,{error:'Request too large.'});
  const b=JSON.parse(raw);
  if(['list','generate','revoke'].includes(b.action)){
   if(!uuid(b.org)|| (b.action!=='list'&&!uuid(b.employee)))return reply(400,{error:'Select an employee and workspace.'});
   const code=b.action==='generate'?newCode():undefined;
   const data=await deps.admin(req.headers.get('authorization')||'',b.org,b.action,b.employee,code?await hashCode(normalizeCode(code)):undefined);
   return reply(200,{data,...(code?{code}:{})});
  }
  if(!['preview','redeem'].includes(b.action))return reply(400,{error:'Unknown action.'});
  // Global + per-code budgets do not depend on spoofable forwarded IP headers.
  if(!await deps.rpc('employee_activation_limit',{p_bucket:'global',p_max:120,p_seconds:60}))return reply(429,{error:'Please wait a minute before trying again.'});
  const code=normalizeCode(typeof b.code==='string'?b.code:'');
  const hash=await hashCode(code);
  if(!await deps.rpc('employee_activation_limit',{p_bucket:hash,p_max:20,p_seconds:900}))return reply(429,{error:'Too many attempts. Please wait 15 minutes.'});
  if(!/^[0-9a-f]{48}$/.test(code))return reply(400,{error:'Code unavailable. Check the code or ask your administrator.'});
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(b.action==='redeem'&&(!b.confirmed||!uuid(b.employee)||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<12||b.password.length>128))return reply(400,{error:'Confirm your identity and enter an email and a password of 12–128 characters.'});
  // Verify the confirmed identity before binding a claim to an email.
  const preview=await deps.rpc('employee_activation_lookup',{p_hash:hash}) as {employee_id:string;name:string;company:string}|null;
  if(b.action==='preview')return preview?reply(200,{data:preview}):reply(400,{error:'Code unavailable. Check the code or ask your administrator.'});
  if(preview&&preview.employee_id!==b.employee)return reply(400,{error:'Employee confirmation does not match.'});
  const claim=await deps.rpc('employee_activation_lookup',{p_hash:hash,p_email:email}) as {claim?:string;activated?:boolean;employee_id:string;name:string}|null;
  if(!claim)return reply(400,{error:'Code unavailable. Check the code or ask your administrator.'});
  if(claim.activated)return reply(200,{activated:true}); // Lost response: user must still prove their password at sign-in.
  if(!preview||claim.employee_id!==b.employee||!claim.claim)return reply(400,{error:'Activation unavailable.'});
  try{await deps.createUser({email,password:b.password,email_confirm:true,app_metadata:{quest_employee_activation:claim.claim},user_metadata:{full_name:claim.name}});}
  catch{
   // Concurrent Auth request may have committed first. Never adopt another email's account.
   const after=await deps.rpc('employee_activation_lookup',{p_hash:hash,p_email:email}) as {activated?:boolean}|null;
   if(!after?.activated)return reply(409,{error:'Account creation could not complete. Retry with the same email, or ask your administrator to regenerate the code. Existing accounts must use normal sign-in.'});
  }
  const completed=await deps.rpc('employee_activation_lookup',{p_hash:hash,p_email:email}) as {activated?:boolean}|null;
  if(!completed?.activated)return reply(409,{error:'Activation linking was not confirmed. Ask your administrator for assistance.'});
  return reply(200,{activated:true});
 }catch{return reply(400,{error:'Activation request could not complete. Check your access or try again.'});}
}
