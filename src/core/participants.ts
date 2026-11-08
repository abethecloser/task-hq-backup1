// Participant registry and Overseer coordination for the task workbench.
//
// A participant is a declared functional role (responsibility, context it needs, what it reads and
// returns, how much authority it may hold), not a running process. Today every participant is served by
// deterministic checks over the task's own fields (`reading`), so each is EXPERIMENTAL and says so. No
// model or runtime is connected; selecting a participant never implies one is. Task HQ keeps ownership of
// the task record: participants only return findings, which a person reviews.
//
// Alignment with QuestBase (read, not integrated): QBIO's contract leaves task lifecycle to Task HQ, and
// SYNAPSE's registry allows only the effects prepare / review / record / request-decision. Authority here
// stops at 'propose', so no participant can produce an effect outside those. There is no NAN or QBIO
// adapter in this repository, and none is implied.
import type { QuestState, Task } from './contract.ts';
import { blockingDeps, dependents, isOverdue, isStalled, nameOf } from './selectors.ts';
import type { CapabilityState, WorkKind } from './workbench.ts';

/** Graduated authority. Each level includes the ones before it. */
export const AUTHORITY_LEVELS = ['observe', 'prepare', 'anticipate', 'propose', 'execute'] as const;
export type Authority = typeof AUTHORITY_LEVELS[number];
export const AUTHORITY_LABELS: Record<Authority, string> = {
  observe: 'Observe: read the task and report what it sees.',
  prepare: 'Prepare: draft material for a person; changes nothing.',
  anticipate: 'Anticipate: flag what is likely to need attention next.',
  propose: 'Propose for review: suggest a change a person approves or rejects.',
  execute: 'Execute: carry out an action a person explicitly authorized.',
};
export const rank = (level: Authority) => AUTHORITY_LEVELS.indexOf(level);

export type ContextKey = 'task' | 'project' | 'dependencies' | 'people' | 'calendar' | 'history';
export type ParticipantId = 'overseer' | 'planning' | 'operations' | 'scheduling' | 'execution' | 'quality' | 'resources';

export interface Participant {
  id: ParticipantId;
  name: string;
  responsibility: string;
  /** Work kinds this area usually matters for. Signals on the task can add it too. */
  areas: WorkKind[];
  /** Catalog capability ids this participant may use (tools, resources, frameworks). */
  uses: string[];
  /** Context it must be given; anything else stays out of its view. */
  context: ContextKey[];
  /** The contract, in plain words. */
  input: string;
  output: string;
  /** Highest level it may hold. No participant can execute until a runtime is connected. */
  ceiling: Authority;
  /** Level it starts at when selected. */
  defaultAuthority: Authority;
  state: CapabilityState;
  stateNote: string;
  /** What every finding must cite. */
  evidence: string;
}

const RULES_ONLY = 'Reads the task with fixed checks. No model or runtime is connected.';
const base = { state: 'experimental' as const, stateNote: RULES_ONLY, ceiling: 'propose' as const, defaultAuthority: 'propose' as const, evidence: 'Each finding names the task fields it came from.' };

/** The registry. Extend by adding a row; nothing else needs to change. */
export const PARTICIPANTS: readonly Participant[] = [
  { ...base, id: 'overseer', name: 'Task Overseer', responsibility: 'Coordinates the specialists, reconciles their findings, and surfaces what needs a person.', areas: ['general', 'estimate', 'schedule', 'communicate', 'research', 'plan', 'decide', 'handoff'], uses: ['tool.ask', 'resource.references', 'framework.raci'], context: ['task', 'project', 'dependencies', 'people', 'history'], input: 'The task and every specialist finding.', output: 'One operational picture: conflicts, gaps, and decisions for a person.' },
  { ...base, id: 'planning', name: 'Planning', responsibility: 'Sequencing, priorities and dependencies.', areas: ['plan', 'decide', 'research'], uses: ['framework.plan-do-check', 'tool.ask'], context: ['task', 'dependencies', 'project'], input: 'Task, what it depends on, what depends on it.', output: 'Ordering and blocking findings.' },
  { ...base, id: 'operations', name: 'Operations', responsibility: 'Workflow and throughput across connected work.', areas: ['plan', 'handoff', 'general'], uses: ['tool.ask'], context: ['task', 'dependencies', 'project'], input: 'Task and the work waiting on it.', output: 'Flow and bottleneck findings.' },
  { ...base, id: 'scheduling', name: 'Scheduling', responsibility: 'Timing and capacity.', areas: ['schedule', 'estimate'], uses: ['tool.calendar'], context: ['task', 'calendar', 'people'], input: 'Due date, owner, status, last activity.', output: 'Timing findings.' },
  { ...base, id: 'execution', name: 'Execution', responsibility: 'Task progression and follow-through.', areas: ['communicate', 'general', 'handoff'], uses: ['tool.clarify', 'resource.references'], context: ['task', 'history'], input: 'Status, next action, recent activity.', output: 'Progress and next-step findings.' },
  { ...base, id: 'quality', name: 'Quality', responsibility: 'Verification and completion requirements.', areas: ['handoff', 'estimate', 'decide'], uses: ['framework.close-out'], context: ['task', 'people'], input: 'Status, reviewer, what is still open.', output: 'Verification findings.' },
  { ...base, id: 'resources', name: 'Resources', responsibility: 'People, tools, materials and missing inputs.', areas: ['estimate', 'schedule', 'plan', 'research'], uses: ['resource.references', 'tool.estimating'], context: ['task', 'people'], input: 'Owner, external waits, missing fields.', output: 'Missing-input findings.' },
];

export const participantById = (id: string) => PARTICIPANTS.find(p => p.id === id);

/** The authority a participant actually holds: never above its ceiling, and never 'execute' without an explicit human authorization. */
export function effectiveAuthority(participant: Participant, requested: Authority, executeAuthorized = false): Authority {
  let level = rank(requested) > rank(participant.ceiling) ? participant.ceiling : requested;
  if (level === 'execute' && !executeAuthorized) level = 'propose';
  return level;
}

export type Severity = 'info' | 'attention' | 'decision';
export interface Finding { participant: ParticipantId; severity: Severity; text: string; evidence: string[] }

/** What one specialist sees in the task, from its own fields only. */
export function reading(id: ParticipantId, state: QuestState, task: Task, now: number): Finding[] {
  const f = (severity: Severity, text: string, evidence: string[]): Finding => ({ participant: id, severity, text, evidence });
  const out: Finding[] = [];
  const blockers = blockingDeps(state, task);
  const waiting = dependents(state, task);
  if (id === 'planning') {
    if (blockers.length) out.push(f('attention', `Waiting on ${blockers.length} unfinished task${blockers.length === 1 ? '' : 's'}: ${blockers.map(b => b.title).join(', ')}.`, ['dependsOn']));
    if (task.blocker) out.push(f('decision', 'Marked blocked and not yet resolved.', ['blocker']));
    if (!task.dependsOn.length && !waiting.length) out.push(f('info', 'No dependencies recorded in either direction.', ['dependsOn']));
  }
  if (id === 'operations') {
    if (waiting.length) out.push(f(task.status === 'blocked' || isOverdue(task, now) ? 'attention' : 'info', `${waiting.length} task${waiting.length === 1 ? ' is' : 's are'} waiting on this one: ${waiting.map(w => w.title).join(', ')}.`, ['dependsOn (of other tasks)']));
    if (isStalled(state, task, now)) out.push(f('attention', 'No activity for longer than the stall limit.', ['lastActivityAt', 'status']));
  }
  if (id === 'scheduling') {
    if (!task.due) out.push(f('attention', 'No due date.', ['due']));
    else if (isOverdue(task, now)) out.push(f('attention', `Overdue since ${task.due}.`, ['due', 'status']));
    else out.push(f('info', `Due ${task.due}${task.dueTime ? ` at ${task.dueTime}` : ''}.`, ['due']));
  }
  if (id === 'execution') {
    if (!task.nextAction.trim()) out.push(f('attention', 'No next action written.', ['nextAction']));
    else out.push(f('info', `Next action: “${task.nextAction}”.`, ['nextAction']));
    if (task.status === 'ready' && isStalled(state, task, now)) out.push(f('attention', 'Ready but not started, with no recent activity.', ['status', 'lastActivityAt']));
  }
  if (id === 'quality') {
    if (task.approver) out.push(f('info', `Finishing sends it to review by ${nameOf(state, task.approver)}.`, ['approver']));
    else out.push(f('info', 'No reviewer set; it completes without a review step.', ['approver']));
    if (task.status === 'review') out.push(f('decision', 'In review: a person must approve or send it back.', ['status', 'approver']));
  }
  if (id === 'resources') {
    if (!task.owner) out.push(f('attention', 'No owner assigned.', ['owner']));
    if (task.waitingOn.trim()) out.push(f('attention', `Waiting on outside party: ${task.waitingOn}.`, ['waitingOn']));
    if (task.owner && !task.waitingOn.trim()) out.push(f('info', `Owner: ${nameOf(state, task.owner)}.`, ['owner']));
  }
  return out;
}

export interface Recommendation { id: ParticipantId; why: string; authority: Authority; state: CapabilityState }
export interface Brief {
  taskId: string;
  kind: WorkKind;
  /** Always rules until a runtime is connected. */
  basis: 'rules';
  recommended: Recommendation[];
  findings: Finding[];
  /** Places two specialists' findings pull against each other. */
  conflicts: string[];
  /** Fields or inputs the task is missing. */
  missing: string[];
  /** What only a person can settle. */
  decisions: string[];
  /** The overall picture, one line each. */
  picture: string[];
}

function relevance(task: Task, state: QuestState, now: number, kind: WorkKind): Map<ParticipantId, string> {
  const why = new Map<ParticipantId, string>();
  const blockers = blockingDeps(state, task).length; const waiting = dependents(state, task).length;
  for (const p of PARTICIPANTS) {
    if (p.id === 'overseer') continue;
    if (p.areas.includes(kind)) why.set(p.id, `${p.name} covers ${kind} work: ${p.responsibility}`);
  }
  const add = (id: ParticipantId, reason: string) => { if (!why.has(id)) why.set(id, reason); };
  if (blockers) add('planning', `This task waits on ${blockers} unfinished task${blockers === 1 ? '' : 's'}.`);
  if (waiting) add('operations', `${waiting} other task${waiting === 1 ? ' is' : 's are'} waiting on this one.`);
  if (task.due || isOverdue(task, now)) add('scheduling', task.due ? `It has a due date (${task.due}).` : 'It is overdue.');
  if (!task.owner || task.waitingOn.trim()) add('resources', !task.owner ? 'It has no owner.' : `It waits on ${task.waitingOn}.`);
  if (task.status === 'review' || task.approver) add('quality', 'It has a review step.');
  if (!task.nextAction.trim()) add('execution', 'It has no written next action.');
  return why;
}

/** The Overseer's pass: pick the relevant specialists, gather their readings, and reconcile them into one picture. */
export function coordinate(state: QuestState, task: Task, now: number, kind: WorkKind): Brief {
  const why = relevance(task, state, now, kind);
  const specialists = PARTICIPANTS.filter(p => p.id !== 'overseer' && why.has(p.id));
  const overseer = participantById('overseer')!;
  const recommended: Recommendation[] = [
    { id: 'overseer', why: `Coordinates ${specialists.length} specialist${specialists.length === 1 ? '' : 's'} and reports one picture.`, authority: effectiveAuthority(overseer, overseer.defaultAuthority), state: overseer.state },
    ...specialists.map(p => ({ id: p.id, why: why.get(p.id)!, authority: effectiveAuthority(p, p.defaultAuthority), state: p.state })),
  ];
  const findings = specialists.flatMap(p => reading(p.id, state, task, now));
  const has = (id: ParticipantId, text: RegExp) => findings.some(x => x.participant === id && text.test(x.text));
  const conflicts: string[] = [];
  if (has('scheduling', /Overdue/) && has('planning', /Waiting on \d/)) conflicts.push('Scheduling reports it overdue while Planning reports it waits on unfinished work: the date may be unreachable until that work finishes.');
  if (has('execution', /Next action: /) && has('resources', /No owner/)) conflicts.push('Execution sees a next action but Resources sees no owner: nobody is assigned to do it.');
  if (has('scheduling', /Overdue/) && task.status === 'review') conflicts.push('Overdue and waiting in review: the delay is with the reviewer.');
  const missing: string[] = [];
  if (!task.owner) missing.push('Owner');
  if (!task.due) missing.push('Due date');
  if (!task.nextAction.trim()) missing.push('Next action');
  if (task.waitingOn.trim()) missing.push(`Input from ${task.waitingOn}`);
  const decisions = findings.filter(x => x.severity === 'decision').map(x => x.text);
  for (const c of conflicts) decisions.push(`Resolve: ${c}`);
  const attention = findings.filter(x => x.severity === 'attention').length;
  const picture = [`${kind} work; ${specialists.length} specialist${specialists.length === 1 ? '' : 's'} relevant.`, attention ? `${attention} item${attention === 1 ? '' : 's'} need attention.` : 'Nothing needs attention from these checks.', decisions.length ? `${decisions.length} thing${decisions.length === 1 ? '' : 's'} need a person to decide.` : 'No decision is waiting on a person.'];
  return { taskId: task.id, kind, basis: 'rules', recommended, findings, conflicts, missing, decisions, picture };
}
