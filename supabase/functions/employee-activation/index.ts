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
 async createUser(input){const {data,error}=await admin.auth.admin.createUser(input);if(error||!data.user)throw error??new Error('Account creation failed');}
}));
