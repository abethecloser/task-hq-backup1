import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Shift, ShiftAction, ShiftBackend, ShiftCommand, ShiftContext, ShiftSnapshot } from './types.ts';
import { STATE_LABELS, isOpenShift, validateMedia } from './types.ts';
import { shiftInsights } from './model.ts';
import { deviceGet, deviceKey, devicePut, deviceRemove, deviceTransaction } from './device.ts';
import { pendingKey, retryShift, sendShift, resumeUpload, uploadKey } from './operations.ts';
import type { PendingUpload } from './operations.ts';
import { localDictation, recordVoice } from './recording.ts';
import type { VoiceRecording } from './recording.ts';
import { Select } from '../ui/Select.tsx';
import './shift.css';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
const duration = (ms: number | null) => ms === null ? 'Time unavailable' : `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`;
export interface ShiftStatus { open: Shift | null; lateEodDue: string | null; snapshot: ShiftSnapshot }
export interface ShiftModuleProps { backend: ShiftBackend; context: ShiftContext; name?: string; actions?: ReactNode; onStatus?: (status: ShiftStatus) => void }
/** Isolated module: receives existing authenticated/backend context. Mounting only READS. */
export function ShiftModule({ backend, context, name = 'Your shift', actions, onStatus }: ShiftModuleProps) {
  return <ShiftBoundary key={JSON.stringify([backend.kind, backend.org, backend.actor])} backend={backend} context={context} name={name} actions={actions} onStatus={onStatus} />;
}
function ShiftBoundary({ backend, context, name, actions, onStatus }: ShiftModuleProps) {
  const status = useRef(onStatus); status.current = onStatus;
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null), [error, setError] = useState(''), [team, setTeam] = useState(false);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState<ShiftCommand | null>(null), [clock, setClock] = useState(Date.now());
  const [notice, setNotice] = useState(''); const offset = useRef(0), alive = useRef(true), working = useRef(false), requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const before = Date.now(), sequence = ++requestSequence.current;
    try {
      const result = await backend.load(team); if (!alive.current || sequence !== requestSequence.current) return;
      offset.current = Date.parse(result.server_now) - (before + Date.now()) / 2;
      setSnapshot(result); setError(''); setPending(await deviceGet<ShiftCommand>(pendingKey(backend)));
      status.current?.({ open: result.shifts.find(item => item.employee === backend.actor && isOpenShift(item)) ?? null, lateEodDue: result.late_eod_due ?? null, snapshot: result });
    } catch (reason) { if (alive.current) setError(message(reason)); }
  }, [backend, team]);
  useEffect(() => {
    alive.current = true; void refresh();
    const interval = setInterval(() => { setClock(Date.now()); }, 1000), poll = setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    const reload = () => void refresh(); window.addEventListener('online', reload); window.addEventListener('focus', reload);
    return () => { alive.current = false; clearInterval(interval); clearInterval(poll); window.removeEventListener('online', reload); window.removeEventListener('focus', reload); };
  }, [refresh]);
  async function run(action: ShiftAction, shift: string | null, data: Record<string, unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice('');
    try { await sendShift(backend, action, shift, data); setNotice('Saved and confirmed.'); await refresh(); return true; }
    catch (reason) { setError(message(reason)); setPending(await deviceGet<ShiftCommand>(pendingKey(backend))); return false; }
    finally { working.current = false; setBusy(false); }
  }
  const own = snapshot?.shifts.filter(item => item.employee === backend.actor) ?? [];
  const shift = own.find(isOpenShift) ?? null;
  const lateDue = snapshot?.late_eod_due ? own.find(item => item.id === snapshot.late_eod_due) ?? null : null;
  const now = clock + offset.current;
  return <section className="shift-module" aria-label="Shift and activity tracking">
    <header className="shift-heading"><div><p className="eyebrow">Shift & activity · {backend.kind === 'demo' ? 'Synthetic demo · saved on this device' : 'Authenticated workspace'}</p><h1>{name}</h1></div>{actions ?? <a className="btn" href="/">Task HQ</a>}</header>
    <p className="shift-boundary-note">Signing in or opening Task HQ does not clock you in. Shift actions are explicit.</p>
    {error && <div className="shift-alert" role="alert"><p>{error}</p><button className="btn" type="button" onClick={() => void refresh()}>Refresh status</button></div>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div className="shift-alert"><strong>Action awaiting confirmation: {pending.action.replaceAll('_', ' ')}</strong><p>The original request is saved. Retrying uses the same ID. Check-in time is the server receipt time; request a correction if needed.</p>
      <button className="btn btn-primary" disabled={busy} onClick={async () => { if (working.current) return; working.current = true; setBusy(true); try { await retryShift(backend); await refresh(); } catch (reason) { setError(message(reason)); } finally { working.current = false; setBusy(false); } }}>Retry saved action</button>
      <button className="btn" disabled={busy} onClick={async () => { await deviceRemove(pendingKey(backend)); setPending(null); setNotice('Retry cleared. Drafts are retained. This does not undo any server action; refresh before proceeding.'); await refresh(); }}>Keep drafts; clear retry</button>
    </div>}
    {!snapshot ? <p>Loading confirmed shift status… No shift has been started.</p> : <>
      {lateDue && <LateEod shift={lateDue} busy={busy || !!pending} run={run} />}
      {!lateDue && <ShiftSession key={shift?.id ?? 'new-shift'} backend={backend} context={context} shift={shift} now={now} busy={busy || !!pending} run={run} refresh={refresh} />}
      <section className="shift-history"><h2>Recorded shifts</h2>
        {snapshot.can_manage && <label className="shift-check"><input type="checkbox" checked={team} onChange={event => setTeam(event.target.checked)} />Include team records for manager review</label>}
        {(snapshot.shifts.filter(item => !isOpenShift(item) || item.employee !== backend.actor)).map(item => <details className="shift-card" key={item.id}>
          <summary>{item.employee === backend.actor ? 'Your shift' : item.employee_name || item.employee} · {stamp(item.started_at)} · {STATE_LABELS[item.state]}{item.review_required ? ' · Review required' : ''}</summary>
          <p>Start: {stamp(item.started_at)}<br />End: {item.state === 'auto_closed' && !item.ended_at ? `Unknown · closed automatically ${stamp(item.closed_at ?? null)}` : stamp(item.ended_at)}<br />Recorded interval: {duration(shiftInsights(item, context, now).elapsed)}{item.review_required ? ' · Unreviewed exception or correction request' : ''}</p>
          <RecordList shift={item} backend={backend} />
          <Correction actor={backend.actor} shift={item} manager={snapshot.can_manage} canRequest={item.employee === backend.actor} busy={busy || !!pending} run={run} />
        </details>)}
        {!snapshot.shifts.length && <p>No recorded shifts. You are Not Checked In.</p>}
      </section>
    </>}
  </section>;
}
interface Draft { focus: string; task_id: string; project_id: string; capture: string; eod: string; eod_media_id: string }
function ShiftSession({ backend, context, shift, now, busy, run, refresh }: {
  backend: ShiftBackend; context: ShiftContext; shift: Shift | null; now: number; busy: boolean;
  run: (action: ShiftAction, shift: string | null, data: Record<string, unknown>) => Promise<boolean | undefined>; refresh: () => Promise<void>;
}) {
  const defaults: Draft = { focus: '', task_id: shift?.task_id ?? '', project_id: shift?.project_id ?? '', capture: '', eod: shift?.eod_draft ?? '', eod_media_id: '' };
  const key = deviceKey(backend.org, backend.actor, `draft:${shift?.id ?? 'check-in'}`);
  const [draft, setDraft] = useState<Draft>(defaults), [loaded, setLoaded] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const [upload, setUpload] = useState<PendingUpload | null>(null), [uploading, setUploading] = useState(false), [reviewed, setReviewed] = useState(false), [recording, setRecording] = useState(false);
  const draftRef = useRef(defaults), saves = useRef(Promise.resolve()), recorder = useRef<VoiceRecording | null>(null), mounted = useRef(true);
  const [dictating, setDictating] = useState(false); const dictation = useRef<ReturnType<typeof localDictation>>(null);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([deviceGet<Draft>(key), deviceGet<PendingUpload>(uploadKey(backend))]).then(([value, media]) => { if (!mounted.current) return; if (value) { draftRef.current = { ...defaults, ...value }; setDraft(draftRef.current); } setUpload(media); setLoaded(true); setSaved(!!value); }).catch(reason => { setError(message(reason)); });
    return () => { mounted.current = false; recorder.current?.stop(); dictation.current?.stop(); };
  }, [key, backend]);
  function edit(change: Partial<Draft>) {
    const value = { ...draftRef.current, ...change }; draftRef.current = value; setDraft(value); setSaved(false);
    saves.current = saves.current.catch(() => {}).then(() => devicePut(key, value)).then(() => { if (mounted.current && draftRef.current === value) setSaved(true); }).catch(reason => { setError(message(reason)); throw reason; });
    void saves.current.catch(() => {});
  }
  const mine = context.tasks.filter(task => task.owner === backend.actor || (task.status === 'review' && task.approver === backend.actor)).filter(task => task.status !== 'done');
  const insights = shift ? shiftInsights(shift, context, now) : null;
  const binding = <div className="shift-grid">
    <label>Assigned work<Select value={draft.task_id} onChange={event => { const task = mine.find(item => item.id === event.target.value); edit({ task_id: event.target.value, project_id: task?.projectId ?? draft.project_id }); }}><option value="">Choose work (optional)</option>{mine.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</Select></label>
    <label>Job / site<Select value={draft.project_id} onChange={event => edit({ project_id: event.target.value, task_id: '' })}><option value="">No job selected</option>{context.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></label>
  </div>;
  async function file(blob: Blob, purpose: 'capture' | 'eod', partial = false, id = crypto.randomUUID()) {
    validateMedia(blob);
    if (!shift) throw new Error('Check in before capturing shift activity.');
    const next: PendingUpload = { id, shift_id: shift.id, blob, text: purpose === 'capture' ? draftRef.current.capture : draftRef.current.eod, task_id: shift.task_id, project_id: shift.project_id, purpose, observed_at: new Date().toISOString(), partial };
    if (mounted.current) { setUpload({...next,durable:false}); setReviewed(false); }
    try {
      await deviceTransaction<void>('readwrite',(store,done,fail)=>{const check=store.get(uploadKey(backend));check.onsuccess=()=>{const existing=check.result as PendingUpload|undefined;if(existing&&existing.id!==next.id){fail(new Error('Another attachment is saved. Upload or download it before replacing it.'));return;}if(existing)next.observed_at=existing.observed_at;store.put({...next,durable:true},uploadKey(backend));done();};});
      if(mounted.current)setUpload({...next,durable:true});
    } catch(reason) { throw new Error(`Attachment is in memory only. Keep this page open and download or upload it now. ${message(reason)}`); }
    return next;
  }
  async function startVoice(purpose: 'capture' | 'eod') {
    if (upload) { setError('Upload or export the saved attachment before starting another recording.'); return; }
    const id = crypto.randomUUID(); setRecording(true);
    try {
      const voice = await recordVoice(async (blob, partial) => { await file(blob, purpose, partial, id); }); recorder.current = voice;
      await voice.done;
    } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { recorder.current = null; if (mounted.current) setRecording(false); }
  }
  const controls = (purpose: 'capture' | 'eod') => <div className="shift-actions">
    {!recording ? <button type="button" className="btn" disabled={!!upload || busy || !loaded} onClick={() => void startVoice(purpose)}>Record voice</button> : <button type="button" className="btn btn-primary" onClick={() => recorder.current?.stop()}>Stop recording</button>}
    {purpose === 'capture' && <><label className={`btn shift-file ${upload ? 'is-disabled' : ''}`}>Photo<input aria-label="Attach a photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic" capture="environment" disabled={!!upload || recording || busy} onChange={event => { const selected = event.target.files?.[0]; if (selected) void file(selected,purpose).catch(reason => setError(message(reason))); event.target.value=''; }} /></label>
    <label className={`btn shift-file ${upload ? 'is-disabled' : ''}`}>Video<input aria-label="Attach a video" type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" disabled={!!upload || recording || busy} onChange={event => { const selected=event.target.files?.[0]; if(selected) void file(selected,purpose).catch(reason=>setError(message(reason))); event.target.value=''; }} /></label></>}
    <label className="btn shift-file">Attach audio<input aria-label={`Attach ${purpose} audio`} type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav" disabled={!!upload || recording || busy} onChange={event=>{const selected=event.target.files?.[0];if(selected)void file(selected,purpose).catch(reason=>setError(message(reason)));event.target.value='';}} /></label>
  </div>;
  return <section className="shift-card" aria-label="Current shift">
    <div className="shift-status"><h2>{shift ? STATE_LABELS[shift.state] : 'Not Checked In'}</h2>{insights && <span className="shift-elapsed">{duration(insights.elapsed)} elapsed</span>}</div>
    {error && <p className="shift-alert" role="alert">{error}</p>}
    {!loaded && <p>Loading saved drafts…</p>}
    {shift?.review_required && <p className="shift-alert">This recorded interval requires manager review. No correction has been silently applied.</p>}
    {insights?.missed && <p className="shift-alert">This shift has been open for more than 16 hours. No end time was assumed. Check out or request a time correction below.</p>}
    {!shift ? <><label>What will you focus on?<textarea value={draft.focus} maxLength={1000} onChange={event=>edit({focus:event.target.value})} disabled={!loaded} placeholder="A short note is enough." /></label>{binding}
      <button type="button" className="btn btn-primary shift-primary" disabled={busy || !loaded || !context.canCheckIn || (!draft.focus.trim()&&!draft.task_id&&!draft.project_id)} onClick={async()=>{await saves.current.catch(()=>{});await run('check_in',null,{focus:draft.focus,task_id:draft.task_id,project_id:draft.project_id});}}>Clock in</button>
      {!context.canCheckIn && <p>Check-in is unavailable for this role. Existing shifts and correction access remain available.</p>}
    </> : <>
      <p>Started {stamp(shift.started_at)} · {context.projects.find(item=>item.id===shift.project_id)?.name || 'No active job'}{shift.focus ? ` · ${shift.focus}` : ''}</p>
      <p className="shift-summary">{insights!.captures} submitted captures · {insights!.updates} recorded task updates · {insights!.completed} assigned tasks completed in this interval · {insights!.blocked} currently blocked</p>
      {shift.state==='active' && <><details><summary>Change active work context</summary>{binding}<button className="btn" disabled={busy} onClick={()=>void run('context',shift.id,{task_id:draft.task_id,project_id:draft.project_id})}>Set active job</button></details>
        <h3>Capture activity</h3><label>Note<textarea value={draft.capture} maxLength={5000} onChange={event=>edit({capture:event.target.value})} placeholder="Progress, blocker, site update…" /></label>{controls('capture')}
        <button className="btn" disabled={busy||!draft.capture.trim()||recording} onClick={async()=>{if(await run('capture',shift.id,{text:draft.capture,task_id:shift.task_id,project_id:shift.project_id}))edit({capture:''});}}>Save note</button>
        <button className="btn btn-primary shift-primary" disabled={busy||recording} onClick={()=>void run('request_checkout',shift.id,{})}>Finish shift / write EOD</button>
      </>}
      {shift.state==='checkout_pending' && <><h3>End-of-day report</h3><p>Your shift remains open until checkout is confirmed. Record a voice EOD or add a short note.</p>
        {!insights!.eod ? <><label>EOD note<textarea value={draft.eod} maxLength={5000} onChange={event=>edit({eod:event.target.value})} /></label>{controls('eod')}
          <button className="btn" disabled={busy||recording} onClick={()=>void run('draft_eod',shift.id,{text:draft.eod})}>Save draft to workspace</button>
          <label>Uploaded voice EOD<Select value={draft.eod_media_id} onChange={event=>edit({eod_media_id:event.target.value})}><option value="">No voice attachment</option>{shift.media.filter(item=>item.status==='ready'&&item.mime.startsWith('audio/')).map(item=><option key={item.id} value={item.id}>Voice · {stamp(item.created_at)}</option>)}</Select></label>
          <button className="btn" disabled={dictating||recording||busy} onClick={()=>{const speech=localDictation(text=>{edit({eod:[draftRef.current.eod,text].filter(Boolean).join(' ')});setDictating(false);},text=>{setError(text);setDictating(false);}); if(!speech){setError('On-device transcription is not available in this browser. Record audio, attach a voice file, or type your EOD.');return;}dictation.current=speech;setDictating(true);try{speech.start();}catch(reason){setError(message(reason));setDictating(false);}}}>Transcribe on device, if supported</button>
          {dictating&&<button className="btn" onClick={()=>{dictation.current?.stop();setDictating(false);}}>Stop dictation</button>}
          <button className="btn btn-primary shift-primary" disabled={busy||recording||(!draft.eod.trim()&&!draft.eod_media_id)} onClick={async()=>{await saves.current.catch(()=>{});if(await run('submit_eod',shift.id,{text:draft.eod,media_id:draft.eod_media_id}))edit({eod:'',eod_media_id:''});}}>Submit EOD</button>
        </> : <><p role="status">EOD successfully submitted.</p><button className="btn btn-primary shift-primary" disabled={busy||recording} onClick={()=>void run('checkout',shift.id,{})}>Confirm checkout</button></>}
      </>}
      <Correction actor={backend.actor} shift={shift} canRequest manager={false} busy={busy} run={run} />
      <RecordList shift={shift} backend={backend} />
    </>}
    {upload && <section className="shift-upload"><h3>{upload.durable===false?'Unsaved attachment · keep this page open':'Saved attachment'} · {upload.purpose==='eod'?'Voice EOD':'Activity'}</h3><p>{Math.ceil(upload.blob.size/1024)} KB · {upload.partial?'Recovered / incomplete recording. Review before uploading.':'Ready to upload'}{shift?.id!==upload.shift_id?' · From a previous shift':''}</p>
      <LocalMedia blob={upload.blob} />
      {upload.partial&&<label className="shift-check"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)} />I reviewed this partial recording.</label>}
      <button className="btn btn-primary" disabled={uploading||busy||recording||(upload.partial&&!reviewed)} onClick={async()=>{setUploading(true);try{const id=await resumeUpload(backend,upload);if(upload.purpose==='eod'&&upload.shift_id===shift?.id)edit({eod_media_id:id});if(upload.purpose==='capture')edit({capture:''});await deviceRemove(uploadKey(backend));setUpload(null);await refresh();}catch(reason){setError(`Upload retained for retry: ${message(reason)}`);}finally{setUploading(false);}}}>{uploading?'Uploading…':'Upload / retry attachment'}</button>
      <p>The local file stays until the server confirms its saved bytes. Interrupted uploads can be retried. Late attachments never change shift hours.</p>
    </section>}
    <p className="shift-draft-status" role="status">{saved?'Draft saved on this device.':loaded?'Draft changes are being saved.':''}</p>
  </section>;
}
function LocalMedia({blob}:{blob:Blob}) {
 const [url,setUrl]=useState('');useEffect(()=>{const next=URL.createObjectURL(blob);setUrl(next);return()=>URL.revokeObjectURL(next);},[blob]);
 return <><a className="btn" href={url} download="shift-capture">Download saved attachment</a>{blob.type.startsWith('audio/')?<audio controls src={url}/>:blob.type.startsWith('video/')?<video controls src={url}/>:<img src={url} alt="Saved shift capture"/>}</>;
}
function RecordList({shift,backend}:{shift:Shift;backend:ShiftBackend}) {
 const [selected,setSelected]=useState<{url:string;mime:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>()=>{if(selected?.url.startsWith('blob:'))URL.revokeObjectURL(selected.url);},[selected]);
 return <details className="shift-records"><summary>Activity and EOD records ({shift.records.length})</summary>
  <ul>{shift.records.map(record=><li key={record.id}><strong>{record.kind.replaceAll('_',' ')}</strong> · {stamp(record.created_at)}<p>{record.text}</p>{['correction','adjustment','exception_checkout'].includes(record.kind)&&<pre>{JSON.stringify(record.data,null,2)}</pre>}</li>)}</ul>
  {shift.media.map(item=><button key={item.id} className="btn" disabled={item.status!=='ready'} onClick={async()=>{try{setSelected({url:await backend.mediaUrl(item),mime:item.mime});}catch(reason){setError(message(reason));}}}>{item.mime.split('/')[0]} · {item.status==='ready'?'View private attachment':'Upload pending'}</button>)}
  {error&&<p role="alert">{error}</p>}{selected&&(selected.mime.startsWith('audio/')?<audio controls src={selected.url}/>:selected.mime.startsWith('video/')?<video controls src={selected.url}/>:<img src={selected.url} alt="Private shift capture"/>)}
 </details>;
}
function Correction({actor,shift,manager,canRequest,busy,run}:{actor:string;shift:Shift;manager:boolean;canRequest:boolean;busy:boolean;run:(action:ShiftAction,shift:string|null,data:Record<string,unknown>)=>Promise<unknown>}) {
 const key=`correction:${shift.id}`, [reason,setReason]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[error,setError]=useState('');
 useEffect(()=>{void deviceGet<{reason:string;start:string;end:string}>(deviceKey(shift.org_id,actor,key)).then(value=>{if(value){setReason(value.reason);setStart(value.start);setEnd(value.end);}});},[key,shift.org_id,actor]);
 const save=(value:{reason:string;start:string;end:string})=>{void devicePut(deviceKey(shift.org_id,actor,key),value).catch(reason=>setError(message(reason)));};
 return <details className="shift-correction"><summary>{manager?'Manager review / timestamp adjustment':'Checkout problem or time correction'}</summary>
  <p>Reported times are requests, not verified hours. Manager adjustments retain the original timestamps in the audit trail.</p>
  <label>Reason<textarea value={reason} maxLength={5000} onChange={event=>{setReason(event.target.value);save({reason:event.target.value,start,end});}}/></label>
  <div className="shift-grid"><label>Reported start (optional)<input type="datetime-local" value={start} onChange={event=>{setStart(event.target.value);save({reason,start:event.target.value,end});}}/></label><label>Reported end (optional)<input type="datetime-local" value={end} onChange={event=>{setEnd(event.target.value);save({reason,start,end:event.target.value});}}/></label></div>
  {error&&<p role="alert">{error}</p>}
  {canRequest&&<button className="btn" disabled={busy||!reason.trim()} onClick={()=>void run('correction',shift.id,{text:reason,reported_start:start,reported_end:end})}>Request correction</button>}
  {canRequest&&isOpenShift(shift)&&<button className="btn" disabled={busy||!reason.trim()} onClick={()=>void run('exception_checkout',shift.id,{text:reason,reported_start:start,reported_end:end})}>Record exception checkout · manager review required</button>}
  {manager&&<button className="btn btn-primary" disabled={busy||!reason.trim()||!start||!end} onClick={()=>void run('adjust',shift.id,{text:reason,started_at:new Date(start).toISOString(),ended_at:new Date(end).toISOString()})}>Approve recorded time adjustment</button>}
 </details>;
}

/** A shift the system closed (no checkout within the limit): the employee explains it before a new check-in.
 * The end time stays unknown; this records what happened, it never sets hours. */
function LateEod({ shift, busy, run }: { shift: Shift; busy: boolean; run: (action: ShiftAction, shift: string | null, data: Record<string, unknown>) => Promise<boolean | undefined> }) {
  const [reason, setReason] = useState(''), [summary, setSummary] = useState('');
  return <section className="shift-card" aria-label="Late end-of-day report">
    <div className="shift-status"><h2>Your last shift wasn’t checked out</h2></div>
    <p>Started {stamp(shift.started_at)}. It was closed automatically {stamp(shift.closed_at ?? null)} with no end time recorded. Add a short late EOD to start today’s shift. A manager reviews the time.</p>
    <label>Why was checkout missed?<textarea value={reason} maxLength={5000} onChange={event => setReason(event.target.value)} placeholder="e.g. Phone died at the site" /></label>
    <label>What did you get done?<textarea value={summary} maxLength={5000} onChange={event => setSummary(event.target.value)} placeholder="A short summary of the work" /></label>
    <button type="button" className="btn btn-primary shift-primary" disabled={busy || !reason.trim() || !summary.trim()} onClick={() => void run('late_eod', shift.id, { text: reason, summary })}>Submit late EOD</button>
  </section>;
}
