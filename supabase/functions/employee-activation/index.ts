// Deployed with verify_jwt=false: setup previews happen before the person has an account.
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {handleActivation} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(req=>handleActivation(req,{
 async rpc(name,args){const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;},
 async admin(authorization,org,action,employee,hash){
  if(!/^Bearer /i.test(authorization))throw new Error('Authentication required');
  const user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user:identity},error:authError}=await user.auth.getUser();if(authError||!identity)throw new Error('Authentication required');
  const {data,error}=await user.rpc('employee_activation_admin',{p_org:org,p_action:action,p_employee:employee??null,p_hash:hash??null});if(error)throw error;return data;
 },
 async verifiedUser(authorization){
  const token=/^Bearer (.+)$/i.exec(authorization)?.[1];if(!token)return null;
  const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)return null;
  // Auth has just validated this token; its claims say how the session was created.
  // POST /verify with an email code records amr "otp" for new and existing users alike
  // (supabase/auth verify.go → models.OTP); tapping the email's link records magiclink / email/signup.
  let amr:{method?:string;timestamp?:number}[]=[];
  try{amr=JSON.parse(atob(token.split('.')[1]!.replace(/-/g,'+').replace(/_/g,'/'))).amr??[];}catch{amr=[];}
  const otp=amr.filter(item=>item.method==='otp'&&typeof item.timestamp==='number').map(item=>item.timestamp!);
  return {id:user.id,emailConfirmed:!!user.email_confirmed_at,emailCodeAt:otp.length?Math.max(...otp):null};
 },
}));
