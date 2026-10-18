// Production entry point. Business rules and authorization remain testable in handler.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { handleDispatch } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(req=>handleDispatch(req,{
  async getUser(authorization) {
    const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const {data:{user}}=await client.auth.getUser(); return user;
  },
  getAdmin:()=>createClient(url,service,{auth:{persistSession:false}}),
}));
