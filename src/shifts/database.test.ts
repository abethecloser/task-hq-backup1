import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, PRODUCTION_BASELINE, addUser, addOrg, addMember, rpcAs, read } from '../../tests/db/pg.ts';
import type { Shift, ShiftSnapshot } from './types.ts';
const migration = '20261019113920_shift_activity_v1.sql';
async function fixture() {
 const db = await createDb(PRODUCTION_BASELINE, { broadGrants: true });
 await db.pg.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text unique,metadata jsonb,owner_id text); alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,anon; grant select,insert,update,delete on storage.objects to authenticated,anon;`);
 await db.pg.exec(read(`supabase/migrations/${migration}`));
 const employee = await addUser(db,'field@example.test'), other = await addUser(db,'other@example.test'), manager = await addUser(db,'manager@example.test'), reviewer = await addUser(db,'review@example.test');
 const org = await addOrg(db,'shift-fixture','Shift fixture'), foreign = await addOrg(db,'other-fixture','Other fixture');
 await addMember(db,org,employee,'member','field'); await addMember(db,org,manager,'supervisor','manager'); await addMember(db,org,reviewer,'reviewer','reviewer'); await addMember(db,foreign,other,'owner','manager');
 let seq = 1000;
 const id = () => `10000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;
 const call = async (actor: string, action: string, shift: string|null, data: Record<string,unknown> = {}, request=id()) => rpcAs(db,actor,'shift_command',{p_org:org,p_request:request,p_action:action,p_shift:shift,p_data:data});
 return {db,employee,other,manager,reviewer,org,foreign,id,call};
}
test('real SQL: explicit check-in, persistent reload, idempotency and guarded EOD checkout use server timestamps', async () => {
 const f = await fixture(); try {
 const empty = await rpcAs(f.db,f.employee,'shift_list',{p_org:f.org}); assert.deepEqual((empty.data as ShiftSnapshot).shifts,[]);
 const request=f.id(), before=Date.now(); const start=await f.call(f.employee,'check_in',null,{focus:'Inspect the site',started_at:'2000-01-01T00:00:00Z'},request); assert.equal(start.error,null,start.error?.message);
 const shift=start.data as Shift; assert.ok(Date.parse(shift.started_at)>=before-1000); assert.equal(shift.employee,f.employee);
 assert.equal((await f.call(f.employee,'check_in',null,{focus:'Inspect the site',started_at:'2000-01-01T00:00:00Z'},request)).error,null);
 assert.ok((await f.call(f.employee,'check_in',null,{focus:'Another shift'})).error);
 const loaded=await rpcAs(f.db,f.employee,'shift_list',{p_org:f.org}); assert.equal((loaded.data as ShiftSnapshot).shifts[0]!.id,shift.id);
 assert.ok((await f.call(f.employee,'checkout',shift.id)).error);
 assert.equal((await f.call(f.employee,'request_checkout',shift.id)).error,null);
 assert.ok((await f.call(f.employee,'submit_eod',shift.id,{text:''})).error);
 assert.equal((await f.call(f.employee,'draft_eod',shift.id,{text:'Durable draft'})).error,null);
 assert.equal(((await rpcAs(f.db,f.employee,'shift_list',{p_org:f.org})).data as ShiftSnapshot).shifts[0]!.eod_draft,'Durable draft');
 const eodId=f.id(); const eod=await f.call(f.employee,'submit_eod',shift.id,{text:'Site secured'},eodId); assert.equal(eod.error,null,eod.error?.message);
 assert.equal((await f.call(f.employee,'submit_eod',shift.id,{text:'Site secured'},eodId)).error,null);
 assert.ok((await f.call(f.employee,'submit_eod',shift.id,{text:'A second EOD'})).error);
 const end=await f.call(f.employee,'checkout',shift.id); assert.equal(end.error,null,end.error?.message); const done=end.data as Shift;
 assert.equal(done.state,'checked_out'); assert.ok(Date.parse(done.ended_at!)>=Date.parse(done.started_at)); assert.equal(done.records.filter(r=>r.kind==='eod').length,1);
 } finally {await f.db.close();}
});
test('real SQL: tenant, employee, reviewer, direct write and manager adjustment boundaries', async()=>{
 const f=await fixture(); try {
 assert.ok((await f.call(f.reviewer,'check_in',null,{focus:'Not allowed'})).error);
 const shift=(await f.call(f.employee,'check_in',null,{focus:'Work'})).data as Shift;
 assert.ok((await f.call(f.other,'capture',shift.id,{text:'Foreign access'})).error);
 assert.ok((await f.call(f.manager,'checkout',shift.id)).error);
 assert.deepEqual(((await rpcAs(f.db,f.other,'shift_list',{p_org:f.org})).data as ShiftSnapshot).shifts,[]);
 assert.ok((await rpcAs(f.db,f.other,'shift_list',{p_org:f.org,p_team:true})).error);
 await assert.rejects(f.db.pg.transaction(async tx=>{await tx.exec('set local role authenticated'); await tx.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:f.employee})]); await tx.query(`update public.shift_sessions set ended_at=clock_timestamp(),state='checked_out' where id=$1`,[shift.id]);}));
 const exception=await f.call(f.employee,'exception_checkout',shift.id,{text:'Missed EOD upload; requesting review.'}); assert.equal(exception.error,null); assert.equal((exception.data as Shift).review_required,true);
 const data={text:'Verified with employee',started_at:shift.started_at,ended_at:new Date().toISOString()};
 assert.ok((await f.call(f.employee,'adjust',shift.id,data)).error);
 const correctionId=f.id(); const adjusted=await f.call(f.manager,'adjust',shift.id,data,correctionId); assert.equal(adjusted.error,null,adjusted.error?.message);
 assert.equal((adjusted.data as Shift).review_required,false); assert.ok((adjusted.data as Shift).records.some(r=>r.kind==='adjustment' && r.author===f.manager));
 assert.equal((await f.call(f.manager,'adjust',shift.id,data,correctionId)).error,null);
 assert.ok((await f.call(f.manager,'adjust',shift.id,{...data,ended_at:'2099-01-01T00:00:00Z'})).error);
 } finally{await f.db.close();}
});
test('real SQL: reserved private media, verified upload completion, no overwrite or cross-user reads',async()=>{
 const f=await fixture(); try {
 const shift=(await f.call(f.employee,'check_in',null,{focus:'Work'})).data as Shift, mediaId=f.id();
 assert.equal((await f.call(f.employee,'reserve_media',shift.id,{media_id:mediaId,mime:'audio/webm',bytes:12})).error,null);
 assert.ok((await f.call(f.employee,'finish_media',shift.id,{media_id:mediaId})).error);
 const path=`${f.org}/${f.employee}/${shift.id}/${mediaId}`;
 const storage=async(actor:string,sql:string,params:unknown[]=[])=>f.db.pg.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:actor})]); return tx.query(sql,params);});
 await assert.rejects(storage(f.other,`insert into storage.objects(bucket_id,name,metadata) values('quest-shift-media',$1,$2)`,[path,{size:12,mimetype:'audio/webm'}]));
 await storage(f.employee,`insert into storage.objects(bucket_id,name,metadata) values('quest-shift-media',$1,$2)`,[path,{size:12,mimetype:'audio/webm'}]);
 assert.equal((await f.call(f.employee,'finish_media',shift.id,{media_id:mediaId})).error,null);
 assert.equal((await storage(f.other,`select * from storage.objects where name=$1`,[path])).rows.length,0);
 assert.equal((await storage(f.manager,`select * from storage.objects where name=$1`,[path])).rows.length,1);
 const overwritten=await storage(f.employee,`update storage.objects set metadata='{}' where name=$1 returning *`,[path]); assert.equal(overwritten.rows.length,0);
 const ended=await f.call(f.employee,'request_checkout',shift.id); assert.equal(ended.error,null);
 const eod=await f.call(f.employee,'submit_eod',shift.id,{media_id:mediaId}); assert.equal(eod.error,null,eod.error?.message);
 }finally{await f.db.close();}
});
test('real SQL: a removed member can still finish an existing checkout and request corrections',async()=>{
 const f=await fixture();try{
 const shift=(await f.call(f.employee,'check_in',null,{focus:'Work'})).data as Shift;
 await f.db.pg.query(`delete from public.memberships where org_id=$1 and user_id=$2`,[f.org,f.employee]);
 assert.ok((await f.call(f.employee,'check_in',null,{focus:'New shift'})).error);
 assert.equal((await f.call(f.employee,'request_checkout',shift.id)).error,null);
 assert.equal((await f.call(f.employee,'submit_eod',shift.id,{text:'Finished before access changed.'})).error,null);
 assert.equal((await f.call(f.employee,'checkout',shift.id)).error,null);
 assert.equal((await f.call(f.employee,'correction',shift.id,{text:'Please review the end time.'})).error,null);
 }finally{await f.db.close();}
});
