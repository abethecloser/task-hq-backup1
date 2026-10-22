// Local-only visual harness. Uses TaskPage and the real engine with synthetic data.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskPage } from '../src/app/TaskPage.tsx';
import { apply } from '../src/core/engine.ts';
import { seedState, blankTask } from '../src/core/seed.ts';
import type { Action } from '../src/core/contract.ts';
import type { Quest } from '../src/ui/useQuest.ts';
import '../src/ui/quest.css';
import '../src/ui/nexus.css';
import '../src/ui/studio.css';
import '../src/ui/feedback.css';
import '../src/ui/home.css';
import '../src/ui/brutalist.css';

const scenarios = { mine: 'My turn', waiting: 'Waiting on another person', approval: 'Awaiting approval', completed: 'Completed' };
const params = new URLSearchParams(location.search);
const scenario = params.get('state') in scenarios ? params.get('state')! : 'mine';
function makeFixture() {
  const now = Date.now(), state = seedState(now);
  state.focus = null; state.grants = []; state.tasks = []; state.events = [];
  state.people.forEach(p => { p.authority = p.id === 'jordan' ? 'admin' : 'member'; });
  const task = blankTask('review-access', {
    title: 'Confirm roof access for the Maple Avenue crew', projectId: 'maple', owner: 'alex',
    nextOwner: scenario === 'mine' ? '' : 'riley', approver: scenario === 'approval' || scenario === 'completed' ? 'maya' : '',
    nextAction: 'Call the site manager and confirm the crew can enter at 7:00 AM.',
    description: 'Confirm the gate code, parking location, and site contact before the crew arrives. Record access details here for the estimator and field team.',
    due: new Date(now + 86400000).toLocaleDateString('en-CA'), watchers: ['jordan'],
  }, 'jordan', now - 7200000);
  state.tasks.push(task);
  function advance(actor: string, at: number) {
    const result = apply(state, {type:'task/advance', id:task.id}, {actor, now:at});
    if (!result.ok) throw Error(result.error);
    Object.assign(state, result.state);
  }
  advance('alex', now - 3600000);
  if (scenario === 'approval' || scenario === 'completed') advance('alex', now - 1800000);
  if (scenario === 'completed') advance('maya', now - 900000);
  return state;
}
function TaskPreview() {
  const [state, setState] = useState(makeFixture);
  const current = useRef(state); current.current = state;
  const actor = params.get('actor') === 'jordan' ? 'jordan' : params.get('actor') === 'maya' ? 'maya' : scenario === 'waiting' ? 'sam' : 'alex';
  const [message, setMessage] = useState('');
  const dispatch = async (action: Action) => {
    const result = apply(current.current, action, {actor, now:Date.now()});
    current.current = result.state; setState(result.state);
    setMessage(result.ok ? result.message : result.error);
    return result.ok ? {...result, eventId:result.event?.id ?? null, undoable:!!result.event?.undo} : result;
  };
  const quest = {state, actor, now:Date.now(), dispatch, backend:{kind:'browser', supports:{taskReopen:true}}} as unknown as Quest;
  return <div style={{padding:16}}><p style={{fontSize:14,margin:'0 0 16px'}}>Synthetic local data · Viewing as {state.people.find(p=>p.id===actor)?.name} ({actor === 'jordan' ? 'Admin' : 'Member'})</p><p role="status" style={{margin:0}}>{message}</p><TaskPage quest={quest} task={state.tasks[0]!} canCreate={false} onOpen={()=>setMessage('This sample contains one task.')} onClose={()=>setMessage('Use the review controls above to choose another state.')} onCreate={()=>{}} /></div>;
}
function Review() {
  const [selected, setSelected] = useState('mine');
  const [actor, setActor] = useState('default');
  const [width, setWidth] = useState(1180);
  const [reset, setReset] = useState(0);
  const controls = {minHeight:44,padding:'8px 14px',border:'1px solid #b8b8bd',borderRadius:6,fontSize:16,cursor:'pointer'};
  return <main style={{padding:20,maxWidth:1240,margin:'auto',fontFamily:'system-ui',color:'#202024'}}>
    <h1 style={{fontSize:26}}>Task Detail · Action Story review</h1>
    <p>Real Task Detail components · synthetic local tasks · actions and comments run through the existing engine in memory. Reload resets the sample.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>{Object.entries(scenarios).map(([key,label])=><button style={{...controls,background:selected===key?'#ffeadc':'white'}} aria-pressed={selected===key} key={key} onClick={()=>{setSelected(key);setActor('default');}}>{label}</button>)}</div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:16}}>
      <label>Perspective <select style={controls} value={actor} onChange={e=>setActor(e.target.value)}><option value="default">Member · task viewer</option><option value="maya">Member · Maya (approver)</option><option value="jordan">Admin · Jordan</option></select></label>
      {[1180,768,430,375].map(w=><button key={w} style={{...controls,background:width===w?'#ffeadc':'white'}} aria-pressed={width===w} onClick={()=>setWidth(w)}>{w===1180?'Desktop':w===768?'Tablet':'Mobile'} · {w}px</button>)}
      <button style={controls} onClick={()=>setReset(reset+1)}>Reset sample</button>
    </div>
    <p>{scenarios[selected as keyof typeof scenarios]} · {width}px viewport. Scroll inside the task to see details, comments, and history.</p>
    <div style={{overflowX:'auto',paddingBottom:12}}><iframe key={`${selected}-${actor}-${reset}`} title={`${scenarios[selected as keyof typeof scenarios]} — ${width}px Task Detail`} src={`?frame=1&state=${selected}&actor=${actor}`} style={{display:'block',width,height:1000,border:'1px solid #bbb',borderRadius:8,background:'#fff'}} /></div>
  </main>;
}
createRoot(document.getElementById('review-root')!).render(params.has('frame') ? <TaskPreview /> : <Review />);
