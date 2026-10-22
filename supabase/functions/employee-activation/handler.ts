// No credentials, raw codes or passwords are logged or persisted by this endpoint.
// Identity v1: a setup link is redeemed only by an account that has just proven its email
// with a six-digit code (Supabase Auth verifyOtp). This endpoint never creates accounts.
export interface VerifiedUser { id:string; emailConfirmed:boolean; /** Seconds since epoch of the email-code sign-in that issued this session, if any. */ emailCodeAt:number|null }
export interface ActivationDependencies {
 rpc(name:string,args:Record<string,unknown>):Promise<unknown>;
 admin(authorization:string,org:string,action:string,employee?:string,hash?:string,replaceLink?:boolean):Promise<unknown>;
 /** The signed-in caller, validated by Supabase Auth; null without a valid session. */
 verifiedUser(authorization:string):Promise<VerifiedUser|null>;
 sendInvitationEmail?(to:string,name:string,organization:string,link:string):Promise<void>;
 now?:()=>number;
}
/** A session counts as proof only if it came from an email code in the last 15 minutes. */
export const EMAIL_CODE_WINDOW_SECONDS=900;
const UNAVAILABLE='Code unavailable. Check the code or ask your administrator.';
const REDEEM_REPLIES:Record<string,[number,string]>={
 unverified:[401,'Verify your email with the six-digit code first.'],
 'email-mismatch':[403,'Use the email address your manager has on file for you.'],
 'already-member':[409,'You’re already a member of this workspace. Sign in to continue.'],
 unavailable:[400,UNAVAILABLE],
};
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
  if(b.action==='delivery-status'){
   if(!uuid(b.org))return reply(400,{error:'Select a workspace.'});
   const data=await deps.admin(req.headers.get('authorization')||'',b.org,'delivery-list');
   return reply(200,{data});
  }
  if(['list','generate','revoke'].includes(b.action)){
   if(!uuid(b.org)|| (b.action!=='list'&&!uuid(b.employee)))return reply(400,{error:'Select an employee and workspace.'});
   const code=b.action==='generate'?newCode():undefined;
   const data=await deps.admin(req.headers.get('authorization')||'',b.org,b.action,b.employee,code?await hashCode(normalizeCode(code)):undefined);
   return reply(200,{data,...(code?{code}:{})});
  }
  if(['invite','resend'].includes(b.action)){
   if(!uuid(b.org)||!uuid(b.employee))return reply(400,{error:'Select an employee and workspace.'});
   const authorization=req.headers.get('authorization')||'';
   const code=b.action==='invite'?newCode():normalizeCode(typeof b.code==='string'?b.code:'');
   if(!/^[0-9a-f]{48}$/.test(normalizeCode(code)))return reply(400,{error:'The setup link is unavailable. Select the employee and try again.'});
   if(b.action==='invite'){
    await deps.admin(authorization,b.org,'issue',b.employee,await hashCode(normalizeCode(code)),b.replace===true);
   }
   const result=await sendInvitation(req,deps,authorization,b.org,b.employee,code);
   return reply(200,{data:result.data,delivery:result.delivery,...(b.action==='invite'?{code}:{})});
  }
  // The previous flow created a confirmed account for whatever email was typed. Retired.
  if(b.action==='redeem')return reply(410,{error:'This setup page was updated. Open the link from your manager again to continue.'});
  if(!['preview','activate'].includes(b.action))return reply(400,{error:'Unknown action.'});
  // Global + per-code budgets do not depend on spoofable forwarded IP headers.
  if(!await deps.rpc('employee_activation_limit',{p_bucket:'global',p_max:120,p_seconds:60}))return reply(429,{error:'Please wait a minute before trying again.'});
  const code=normalizeCode(typeof b.code==='string'?b.code:'');
  const hash=await hashCode(code);
  if(!await deps.rpc('employee_activation_limit',{p_bucket:hash,p_max:20,p_seconds:900}))return reply(429,{error:'Too many attempts. Please wait 15 minutes.'});
  if(!/^[0-9a-f]{48}$/.test(code))return reply(400,{error:UNAVAILABLE});
  const preview=await deps.rpc('employee_activation_lookup',{p_hash:hash}) as {employee_id:string;name:string;company:string}|null;
  if(b.action==='preview')return preview?reply(200,{data:{employee_id:preview.employee_id,name:preview.name,company:preview.company}}):reply(400,{error:UNAVAILABLE});
  if(!b.confirmed||!uuid(b.employee))return reply(400,{error:'Confirm that this is your employee identity.'});
  // Null once redeemed; the redeem function then answers only the person who redeemed it.
  if(preview&&preview.employee_id!==b.employee)return reply(400,{error:'Employee confirmation does not match.'});
  const who=await deps.verifiedUser(req.headers.get('authorization')||'');
  const now=Math.floor((deps.now?.()??Date.now())/1000);
  if(!who||!who.emailConfirmed)return reply(401,{error:REDEEM_REPLIES.unverified![1]});
  if(who.emailCodeAt===null||now-who.emailCodeAt>EMAIL_CODE_WINDOW_SECONDS)return reply(401,{error:'Enter a fresh six-digit code from your email to continue.'});
  const result=await deps.rpc('employee_activation_redeem',{p_hash:hash,p_user:who.id}) as {result:string;has_password?:boolean}|null;
  if(result?.result==='activated')return reply(200,{activated:true,has_password:!!result.has_password});
  const [status,error]=REDEEM_REPLIES[result?.result??'unavailable']??REDEEM_REPLIES.unavailable!;
  return reply(status,{error});
 }catch{return reply(400,{error:'Activation request could not complete. Check your access or try again.'});}
}

async function sendInvitation(
 req:Request,
 deps:ActivationDependencies,
 authorization:string,
 org:string,
 employee:string,
 code:string,
):Promise<{data:unknown;delivery:{status:'sent'|'failed'|'pending';message:string}}>{
 const hash=await hashCode(normalizeCode(code));
 const data=await deps.admin(authorization,org,'delivery-prepare',employee,hash) as {id:string;email:string;name:string;organization:string;expires_at:string};
 if(!data||!data.id||!data.email||!data.name||!data.organization)throw new Error('Invitation delivery details are unavailable.');
 const link=`https://task.questroofing.com/activate/index.html#code=${encodeURIComponent(code)}`;
 let status:'sent'|'failed'|'pending'='sent';
 let message='Invitation email sent.';
 try{
  if(!deps.sendInvitationEmail)throw new Error('Email delivery is not configured.');
  await deps.sendInvitationEmail(data.email,data.name,data.organization,link);
 }catch(error){
  status='failed';
  message=error instanceof Error&&error.message==='delivery-not-configured'
   ? 'Email delivery is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the employee-activation Edge Function.'
   : error instanceof Error&&error.message==='delivery-provider-rejected'
    ? 'Resend rejected the message. Check the verified sender and employee email, then retry.'
    : 'Email delivery failed. You can retry this invitation without replacing its setup link.';
 }
 try{
  await deps.rpc('employee_activation_delivery',{p_action:'record',p_activation:data.id,p_status:status});
 }catch{
  status='pending';
  message='Email delivery status could not be confirmed. Check the delivery status before retrying.';
 }
 return {data,delivery:{status,message}};
}
