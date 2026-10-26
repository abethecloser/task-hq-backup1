// Deployed with verify_jwt=false: setup previews happen before the person has an account.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleActivation} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(req=>handleActivation(req,{
 async rpc(name,args){const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;},
 async admin(authorization,org,action,employee,hash,replaceLink){
  if(!/^Bearer\s+\S+$/i.test(authorization))throw new Error('Authentication required');
  const user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user:identity},error:authError}=await user.auth.getUser();if(authError||!identity)throw new Error('Authentication required');
  const rpcName=action==='issue'?'employee_activation_issue':action.startsWith('delivery-')?'employee_activation_delivery':'employee_activation_admin';
  const args=action==='issue'
   ?{p_org:org,p_employee:employee,p_hash:hash,p_replace:replaceLink===true}
   :action==='delivery-prepare'
    ?{p_action:'prepare',p_org:org,p_employee:employee,p_hash:hash}
    :action==='delivery-list'
     ?{p_action:'list',p_org:org}
     :{p_org:org,p_action:action,p_employee:employee??null,p_hash:hash??null};
  const {data,error}=await user.rpc(rpcName,args);if(error)throw error;return data;
 },
 async verifiedUser(authorization){
  const token=/^Bearer\s+(\S+)$/i.exec(authorization)?.[1];if(!token)return null;
  const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)return null;
  // Auth has just validated this token; its claims say how the session was created.
  // POST /verify with an email code records amr "otp" for new and existing users alike
  // (supabase/auth verify.go → models.OTP); tapping the email's link records magiclink / email/signup.
  let amr:{method?:string;timestamp?:number}[]=[];
  try{amr=JSON.parse(atob(token.split('.')[1]!.replace(/-/g,'+').replace(/_/g,'/'))).amr??[];}catch{amr=[];}
  const otp=amr.filter(item=>item.method==='otp'&&typeof item.timestamp==='number').map(item=>item.timestamp!);
  return {id:user.id,emailConfirmed:!!user.email_confirmed_at,emailCodeAt:otp.length?Math.max(...otp):null};
 },
 async sendInvitationEmail(to,name,organization,link){
  const apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM_EMAIL');
  if(!apiKey||!from)throw new Error('delivery-not-configured');
  const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const safeName=escape(name),safeOrganization=escape(organization),safeLink=escape(link);
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
   body:JSON.stringify({from,to,subject:'Quest Roofing Task-HQ invitation',
    text:`Hi ${name},\n\nYou have been invited to set up your Quest Roofing Task-HQ account for ${organization}.\n\nComplete setup: ${link}\n\nThis single-use link expires in seven days. You will verify your email with a six-digit code before activation.`,
    html:`<p>Hi ${safeName},</p><p>You have been invited to set up your Quest Roofing Task-HQ account for ${safeOrganization}.</p><p><a href="${safeLink}">Complete setup</a></p><p>This single-use link expires in seven days. You will verify your email with a six-digit code before activation.</p>`})
  });
  if(!response.ok)throw new Error('delivery-provider-rejected');
 },
}));
