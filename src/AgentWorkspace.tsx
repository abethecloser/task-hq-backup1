import { Select } from './ui/Select.tsx';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';

// Interactive workflow prototype. Nothing here calls a model, a network or any Quest system:
// outcomes are generated from fixed templates and the "work" is a timed simulation.

type AgentId = 'coordinator' | 'planner' | 'researcher' | 'verifier';
type JobState = 'running' | 'review' | 'approved' | 'redirected';

interface AgentDef {
  id: AgentId;
  name: string;
  responsibility: string;
  capabilities: string[];
  example: string;
  steps: string[];
  x: number; // percent of the stage
  y: number;
}

interface Job {
  id: string;
  title: string;
  agent: AgentId;
  step: number;
  state: JobState;
  outcome: string;
  trail: string[];
}

const agents: AgentDef[] = [
  { id: 'coordinator', name: 'Coordinator', x: 50, y: 18,
    responsibility: 'Turns a request into a clear owner, order of work and next checkpoint.',
    capabilities: ['Route work to a role', 'Sequence dependent steps', 'Flag who must decide'],
    example: 'Organize the Northside crew handoff',
    steps: ['Reading the request', 'Choosing owners', 'Sequencing the work'] },
  { id: 'planner', name: 'Planner', x: 16, y: 62,
    responsibility: 'Breaks a goal into small steps with a realistic order and finish line.',
    capabilities: ['Draft step-by-step plans', 'Estimate effort', 'Define what “done” means'],
    example: 'Plan tomorrow’s material staging',
    steps: ['Framing the goal', 'Drafting steps', 'Checking the order'] },
  { id: 'researcher', name: 'Researcher', x: 84, y: 62,
    responsibility: 'Gathers the facts a decision needs and says how sure it is.',
    capabilities: ['Collect relevant facts', 'Compare options', 'Note what is unknown'],
    example: 'Find options for the permit inspection window',
    steps: ['Collecting facts', 'Comparing options', 'Writing the summary'] },
  { id: 'verifier', name: 'Verifier', x: 50, y: 86,
    responsibility: 'Checks finished work against its acceptance criteria before people rely on it.',
    capabilities: ['Build acceptance checks', 'Spot gaps and risks', 'Recommend ship or fix'],
    example: 'Check the site plan before it goes to the crew',
    steps: ['Listing checks', 'Testing against the goal', 'Recording findings'] },
];

const trayTasks = ['Prepare the Monday crew briefing', 'Resolve the staging-area access question', 'Confirm the revised inspection schedule'];

const links: [AgentId, AgentId][] = [['coordinator', 'planner'], ['coordinator', 'researcher'], ['planner', 'verifier'], ['researcher', 'verifier']];

function agentOf(id: AgentId) { return agents.find(agent => agent.id === id)!; }

// Fixed templates, deliberately not model output.
function proposeOutcome(agent: AgentId, title: string) {
  switch (agent) {
    case 'coordinator':
      return `Proposed routing for “${title}”: Planner drafts the steps, Researcher confirms the open facts, Verifier checks the result. Suggested checkpoint: end of day.`;
    case 'planner':
      return `Proposed plan for “${title}”: 1) Confirm the goal and owner. 2) Gather what is missing. 3) Do the work in order. 4) Review together and close.`;
    case 'researcher':
      return `Proposed findings for “${title}”: three options identified, one clearly lower risk, two facts still unconfirmed. Confidence: moderate.`;
    case 'verifier':
      return `Proposed review of “${title}”: four acceptance checks listed, three pass on paper, one gap flagged (no named owner). Recommendation: fix the gap, then proceed.`;
  }
}

export default function AgentWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('coordinator');
  const [armed, setArmed] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<AgentId | null>(null);
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState('');
  const [redirectTo, setRedirectTo] = useState<Record<string, AgentId>>({});
  const [redirectNote, setRedirectNote] = useState<Record<string, string>>({});
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    const id = setInterval(() => {
      if (!jobsRef.current.some(job => job.state === 'running')) return;
      setJobs(current => current.map(job => {
        if (job.state !== 'running') return job;
        const step = job.step + 1;
        const total = agentOf(job.agent).steps.length;
        return step >= total
          ? { ...job, step: total, state: 'review', outcome: proposeOutcome(job.agent, job.title), trail: [...job.trail, `${agentOf(job.agent).name} finished and proposed an outcome (simulated).`] }
          : { ...job, step };
      }));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const liveJob = (agent: AgentId) => jobs.find(job => job.agent === agent && (job.state === 'running' || job.state === 'review'));

  function assign(agent: AgentId, title: string, carry: string[] = []) {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (liveJob(agent)) { setMessage(`${agentOf(agent).name} is already holding a task. Review or finish it first.`); return; }
    const job: Job = { id: crypto.randomUUID(), title: trimmed, agent, step: 0, state: 'running', outcome: '',
      trail: [...carry, `Assigned to ${agentOf(agent).name}.`] };
    setJobs(current => [job, ...current]);
    setSelectedAgent(agent);
    setArmed(null);
    setMessage(`“${trimmed}” sent to ${agentOf(agent).name}. Watch the ring fill.`);
  }

  function decide(job: Job, approve: boolean) {
    if (approve) {
      setJobs(current => current.map(item => item.id === job.id ? { ...item, state: 'approved', trail: [...item.trail, 'You approved the outcome.'] } : item));
      setMessage(`Approved: “${job.title}”. Nothing external was changed; this is a prototype.`);
      return;
    }
    const target = redirectTo[job.id] ?? agents.find(agent => agent.id !== job.agent && !liveJob(agent.id))?.id;
    const note = (redirectNote[job.id] ?? '').trim();
    if (!target || target === job.agent) { setMessage('Choose a different, available agent to redirect to.'); return; }
    if (liveJob(target)) { setMessage(`${agentOf(target).name} is busy. Pick another agent.`); return; }
    setJobs(current => current.map(item => item.id === job.id ? { ...item, state: 'redirected', trail: [...item.trail, `You redirected it to ${agentOf(target).name}${note ? `: “${note}”` : ''}.`] } : item));
    assign(target, job.title, [...job.trail, `You redirected it to ${agentOf(target).name}${note ? `: “${note}”` : ''}.`]);
  }

  function onDrop(event: DragEvent, agent: AgentId) {
    event.preventDefault();
    setDropTarget(null);
    assign(agent, event.dataTransfer.getData('text/plain'));
  }

  function addCustom(event: FormEvent) {
    event.preventDefault();
    if (!custom.trim()) return;
    setArmed(custom.trim());
    setCustom('');
    setMessage('Task picked up. Drop it on an agent, or click an agent.');
  }

  function clickAgent(agent: AgentId) {
    if (armed) assign(agent, armed);
    else setSelectedAgent(agent);
  }

  const inReview = jobs.filter(job => job.state === 'review');
  const selected = agentOf(selectedAgent);
  const selectedJob = liveJob(selectedAgent);
  const history = jobs.filter(job => job.state === 'approved' || job.state === 'redirected');

  function stateOf(agent: AgentDef) {
    const job = liveJob(agent.id);
    if (!job) return { label: 'Idle', tone: 'idle', progress: 0 };
    if (job.state === 'review') return { label: 'Awaiting your review', tone: 'review', progress: 1 };
    return { label: agent.steps[Math.min(job.step, agent.steps.length - 1)]!, tone: 'working', progress: job.step / agent.steps.length };
  }

  return (
    <div className="agent-workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PILOT · AGENT-FIRST WORKFLOW</p>
          <h1>Agent Workspace</h1>
          <p className="subtitle">Hand work to a role, watch it move, then decide what happens next.</p>
        </div>
      </div>

      <div className="alert warning-alert" role="note">Interactive prototype. These agents are not autonomous and are not connected to any model, service or Task-HQ data. Progress and outcomes are simulated from fixed templates.</div>
      {message && <div className="alert notice-alert" role="status"><span>✓</span>{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}

      <div className="aw-layout">
        <div>
          <div className="aw-tray" aria-label="Synthetic tasks">
            <span className="aw-tray-label">SYNTHETIC TASKS · drag onto an agent, or click one then an agent</span>
            <div className="aw-tokens">
              {trayTasks.map(title => (
                <button key={title} draggable className={`aw-token ${armed === title ? 'armed' : ''}`}
                  onDragStart={event => { event.dataTransfer.setData('text/plain', title); setArmed(null); }}
                  onClick={() => setArmed(armed === title ? null : title)}>⠿ {title}</button>
              ))}
              {armed && !trayTasks.includes(armed) && <button className="aw-token armed" onClick={() => setArmed(null)}>⠿ {armed}</button>}
            </div>
            <form className="aw-custom" onSubmit={addCustom}>
              <input value={custom} maxLength={80} onChange={event => setCustom(event.target.value)} placeholder="Or write your own synthetic task…" aria-label="Custom synthetic task" />
              <button type="submit" disabled={!custom.trim()}>Pick up</button>
            </form>
          </div>

          <div className="aw-stage" role="group" aria-label="Agent stage">
            <svg className="aw-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {links.map(([from, to]) => {
                const a = agentOf(from), b = agentOf(to);
                const active = !!liveJob(from) || !!liveJob(to);
                return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? 'aw-link on' : 'aw-link'} />;
              })}
            </svg>
            {agents.map(agent => {
              const info = stateOf(agent);
              const circumference = 2 * Math.PI * 52;
              return (
                <button key={agent.id}
                  className={`aw-node ${info.tone} ${selectedAgent === agent.id ? 'selected' : ''} ${dropTarget === agent.id ? 'drop' : ''} ${armed ? 'armed-target' : ''}`}
                  style={{ left: `${agent.x}%`, top: `${agent.y}%` }}
                  onClick={() => clickAgent(agent.id)}
                  onDragOver={event => { event.preventDefault(); setDropTarget(agent.id); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={event => onDrop(event, agent.id)}
                  aria-label={`${agent.name}: ${info.label}`}>
                  <svg viewBox="0 0 120 120" className="aw-ring" aria-hidden="true">
                    <circle cx="60" cy="60" r="52" className="aw-ring-track" />
                    <circle cx="60" cy="60" r="52" className="aw-ring-fill" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - info.progress)} />
                  </svg>
                  <span className="aw-node-core"><strong>{agent.name}</strong><small>{info.label}</small></span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="aw-side">
          <div className="aw-card">
            <span className="drawer-kicker">{selected.name.toUpperCase()}</span>
            <p className="aw-resp">{selected.responsibility}</p>
            <ul className="aw-caps">{selected.capabilities.map(item => <li key={item}>{item}</li>)}</ul>
            <div className="aw-state"><span className={`aw-dot ${stateOf(selected).tone}`} />{stateOf(selected).label}</div>
            {selectedJob && selectedJob.state === 'running' && (
              <ol className="aw-steps">{selected.steps.map((step, index) => <li key={step} className={index < selectedJob.step ? 'done' : index === selectedJob.step ? 'now' : ''}>{step}</li>)}</ol>
            )}
            <button className="forward-button" disabled={!!liveJob(selected.id)} onClick={() => assign(selected.id, selected.example)}>Assign example: {selected.example}</button>
          </div>

          {inReview.map(job => (
            <div className="aw-card aw-review" key={job.id}>
              <span className="drawer-kicker">{agentOf(job.agent).name.toUpperCase()} · PROPOSED OUTCOME (SIMULATED)</span>
              <strong>{job.title}</strong>
              <p>{job.outcome}</p>
              <div className="aw-actions">
                <button className="forward-button" onClick={() => decide(job, true)}>Approve ✓</button>
              </div>
              <div className="aw-redirect">
                <Select aria-label="Redirect to" value={redirectTo[job.id] ?? ''} onChange={event => setRedirectTo(current => ({ ...current, [job.id]: event.target.value as AgentId }))}>
                  <option value="">Redirect to…</option>
                  {agents.filter(agent => agent.id !== job.agent).map(agent => <option key={agent.id} value={agent.id} disabled={!!liveJob(agent.id)}>{agent.name}{liveJob(agent.id) ? ' (busy)' : ''}</option>)}
                </Select>
                <input value={redirectNote[job.id] ?? ''} maxLength={120} placeholder="What should change?" onChange={event => setRedirectNote(current => ({ ...current, [job.id]: event.target.value }))} />
                <button className="cancel-button" disabled={!redirectTo[job.id]} onClick={() => decide(job, false)}>Redirect →</button>
              </div>
            </div>
          ))}

          {history.length > 0 && (
            <div className="aw-card">
              <span className="drawer-kicker">DECISIONS</span>
              <ul className="aw-history">{history.map(job => (
                <li key={job.id}><strong>{job.title}</strong> <span className={`status-pill ${job.state === 'approved' ? 'status-completed' : 'status-need-help'}`}>{job.state === 'approved' ? 'Approved' : 'Redirected'}</span>
                  <small>{job.trail.join(' → ')}</small></li>
              ))}</ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
