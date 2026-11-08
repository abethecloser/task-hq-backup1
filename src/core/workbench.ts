// Task workbench: discover what could help with a task, propose a working setup with a reason for
// every pick, and keep reusable personal templates. Deterministic and local: discovery is rule
// based and says so. Nothing is invoked here; a capability's state is its honest integration state,
// never its catalog presence. Quest actions stay in capabilities.ts; this catalogs what a person
// can bring to a task (tools, models, frameworks, resources, participants).
import type { QuestState, Task } from './contract.ts';
import { coordinate, effectiveAuthority, participantById } from './participants.ts';
import type { Authority, Brief, ParticipantId } from './participants.ts';
import { viewFor } from './org-capabilities.ts';
import type { OrgSnapshot, OrgView } from './org-capabilities.ts';

export type CapabilityCategory = 'tool' | 'model' | 'framework' | 'resource' | 'participant';
/** AVAILABLE: known, not connected. CONNECTED: usable now. CONFIGURED: connected and set up for this person.
 * UNAVAILABLE: known and cannot be used. EXPERIMENTAL: usable, unfinished. */
export type CapabilityState = 'available' | 'connected' | 'configured' | 'unavailable' | 'experimental';
export type WorkKind = 'estimate' | 'schedule' | 'communicate' | 'research' | 'plan' | 'decide' | 'handoff' | 'general';

export interface CapabilityEntry {
  id: string;
  category: CapabilityCategory;
  name: string;
  summary: string;
  state: CapabilityState;
  /** Why it has this state, in plain words. */
  stateNote: string;
  suits: WorkKind[];
}

export const USABLE: readonly CapabilityState[] = ['connected', 'configured', 'experimental'];
export const isUsable = (entry: Pick<CapabilityEntry, 'state'>) => USABLE.includes(entry.state);

/** The single catalog. States reflect this repository today; change a state only when the integration really changes. */
export const CATALOG: readonly CapabilityEntry[] = [
  { id: 'tool.clarify', category: 'tool', name: 'Clarify', summary: 'Rewrite an unclear next action, with your approval.', state: 'connected', stateNote: 'Built into the task page.', suits: ['general', 'plan', 'handoff', 'communicate'] },
  { id: 'tool.estimating', category: 'tool', name: 'Estimating & proposals', summary: 'Takeoff, pricing and proposal tools.', state: 'experimental', stateNote: 'Page is marked preview.', suits: ['estimate'] },
  { id: 'tool.calendar', category: 'tool', name: 'Calendar', summary: 'Due dates and scheduling.', state: 'connected', stateNote: 'Built into Quest.', suits: ['schedule', 'plan'] },
  { id: 'tool.ask', category: 'tool', name: 'Ask your tasks', summary: 'Question your own task data.', state: 'connected', stateNote: 'Built into Quest; answers from your tasks only.', suits: ['research', 'decide', 'plan'] },
  { id: 'model.rules', category: 'model', name: 'Quest rules', summary: 'Deterministic parsing and diagnosis. Not an AI model.', state: 'connected', stateNote: 'Runs locally; no provider.', suits: ['general', 'plan', 'communicate'] },
  { id: 'model.llm', category: 'model', name: 'Language model', summary: 'Open-ended drafting and reasoning.', state: 'unavailable', stateNote: 'No model provider is connected. The route is undecided.', suits: ['research', 'plan', 'communicate', 'decide'] },
  { id: 'participant.qbio', category: 'participant', name: 'QBIO', summary: 'Connective intelligence across tools.', state: 'unavailable', stateNote: 'No QBIO contract exists in this repository yet.', suits: ['research', 'plan', 'decide', 'handoff'] },
  { id: 'resource.references', category: 'resource', name: 'Linked references', summary: 'People, tags and records linked from task text.', state: 'connected', stateNote: 'Built into task text.', suits: ['general', 'handoff', 'communicate'] },
  { id: 'resource.workbook', category: 'resource', name: 'Operations workbook', summary: 'Reference workbook.', state: 'experimental', stateNote: 'Page is marked preview.', suits: ['research', 'plan'] },
  { id: 'framework.close-out', category: 'framework', name: 'Close-out checklist', summary: 'Confirm checklist, approvals, evidence and handoff before done.', state: 'available', stateNote: 'Guidance only; not enforced.', suits: ['handoff', 'general'] },
  { id: 'framework.raci', category: 'framework', name: 'Who decides (RACI)', summary: 'Name who does it, who decides, who is told.', state: 'available', stateNote: 'Guidance only; not enforced.', suits: ['decide', 'handoff', 'plan'] },
  { id: 'framework.decision', category: 'framework', name: 'Decision record', summary: 'Options, choice, reason, owner.', state: 'available', stateNote: 'Guidance only; not enforced.', suits: ['decide', 'research'] },
  { id: 'framework.plan-do-check', category: 'framework', name: 'Plan, do, check', summary: 'Small steps with a check after each.', state: 'available', stateNote: 'Guidance only; not enforced.', suits: ['plan', 'general', 'schedule'] },
];

const RULES: [WorkKind, RegExp][] = [
  ['estimate', /\b(estimate|quote|proposal|pricing|price|takeoff|bid|invoice)\b/i],
  ['schedule', /\b(schedule|reschedule|book|appointment|calendar|deadline|install date)\b/i],
  ['handoff', /\b(hand ?off|review|approve|approval|sign.?off|pass to|send back)\b/i],
  ['decide', /\b(decide|decision|choose|which|whether|option|approve or)\b/i],
  ['research', /\b(research|find out|look into|investigate|compare|options for|learn)\b/i],
  ['communicate', /\b(call|email|text|message|reply|follow.?up|dispute|contact|notify|tell)\b/i],
  ['plan', /\b(plan|roadmap|organi[sz]e|break down|steps|prepare|set up|launch)\b/i],
];

/** What kind of work this looks like, from its own words. First matching rule wins; otherwise general. */
export function workKind(task: Pick<Task, 'title' | 'nextAction' | 'description'> & { type?: string }): WorkKind {
  const text = `${task.title} ${task.nextAction} ${task.type ?? ''} ${task.description ?? ''}`;
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'general';
}

export interface PickedCapability { capabilityId: string; why: string }
export interface Missing { capabilityId: string; why: string }
export interface WorkbenchProposal {
  taskId: string;
  kind: WorkKind;
  /** How it was derived. Always rules until a model is really connected. */
  basis: 'rules';
  picks: PickedCapability[];
  /** Relevant capabilities that exist in the catalog but cannot be used today. */
  missing: Missing[];
}

export function propose(task: Task, catalog: readonly CapabilityEntry[] = CATALOG): WorkbenchProposal {
  const kind = workKind(task);
  const fits = catalog.filter(entry => entry.suits.includes(kind));
  const picks = fits.filter(isUsable).map(entry => ({ capabilityId: entry.id, why: `${entry.name} suits ${kind} work: ${entry.summary}` }));
  const missing = fits.filter(entry => !isUsable(entry) && entry.state !== 'available').map(entry => ({ capabilityId: entry.id, why: `${entry.name} would help but is ${entry.state}: ${entry.stateNote}` }));
  // A catalog entry that is only AVAILABLE (not connected) is suggested as optional guidance, not as part of the working set.
  const guidance = fits.filter(entry => entry.state === 'available').map(entry => ({ capabilityId: entry.id, why: `${entry.name} (${entry.stateNote.toLowerCase()}) ${entry.summary}` }));
  return { taskId: task.id, kind, basis: 'rules', picks: [...picks, ...guidance], missing };
}

/** A saved, reusable composition. Personal: it belongs to a person, not to an organization. */
export interface WorkbenchTemplate { id: string; name: string; kind: WorkKind; capabilityIds: string[]; /** Specialists chosen with the setup; absent on templates saved before participants existed. */ participantIds?: ParticipantId[]; owner: string; createdAt: number; uses: number }

export function saveTemplate(templates: WorkbenchTemplate[], input: { name: string; kind: WorkKind; capabilityIds: string[]; participantIds?: ParticipantId[]; owner: string; now: number }): WorkbenchTemplate[] {
  const name = input.name.trim();
  if (!name) throw new Error('A template needs a name.');
  const ids = [...new Set(input.capabilityIds)];
  if (!ids.length) throw new Error('Pick at least one capability.');
  const rest = templates.filter(t => !(t.owner === input.owner && t.name.toLowerCase() === name.toLowerCase()));
  return [...rest, { id: `wb-${input.now.toString(36)}-${rest.length}`, name, kind: input.kind, capabilityIds: ids, ...(input.participantIds?.length ? { participantIds: [...new Set(input.participantIds)] } : {}), owner: input.owner, createdAt: input.now, uses: 0 }];
}

/** Reuse a template now: keeps only what is still in the catalog and usable, and says what dropped out and why. */
export function applyTemplate(template: WorkbenchTemplate, catalog: readonly CapabilityEntry[] = CATALOG): { ids: string[]; dropped: { id: string; why: string }[] } {
  const ids: string[] = []; const dropped: { id: string; why: string }[] = [];
  for (const id of template.capabilityIds) {
    const entry = catalog.find(c => c.id === id);
    if (!entry) dropped.push({ id, why: 'No longer in the catalog.' });
    else if (entry.state === 'available' && entry.category === 'framework') ids.push(id);
    else if (!isUsable(entry)) dropped.push({ id, why: `${entry.name} is ${entry.state}: ${entry.stateNote}` });
    else ids.push(id);
  }
  return { ids, dropped };
}

/** The history line for a chosen setup, recorded on the task through the existing comment action. */
export function workbenchNote(names: string[], kind: WorkKind, specialists: { name: string; authority: Authority }[] = [], orgNote = ''): string {
  const team = specialists.length ? ` Specialists: ${specialists.map(s => `${s.name} (${s.authority})`).join(', ')}. No model is connected; they read the task with fixed checks.` : '';
  return `Working setup chosen (${kind}): ${names.join(', ')}.${team}${orgNote}`;
}

export interface WorkbenchAnalysis { proposal: WorkbenchProposal; brief: Brief; /** What the context's organizational (or personal) brains offer, when a snapshot was provided. */ org?: OrgView }
/** Tool and framework discovery plus the Overseer's coordination of relevant specialists, in one pass. */
export function analyze(state: QuestState, task: Task, now: number, catalog: readonly CapabilityEntry[] = CATALOG, snapshot?: OrgSnapshot): WorkbenchAnalysis {
  const proposal = propose(task, catalog);
  return { proposal, brief: coordinate(state, task, now, proposal.kind), ...(snapshot ? { org: viewFor(snapshot, proposal.kind) } : {}) };
}

/** Authority per selected specialist, clamped to what each may hold. */
export function grantAuthority(selected: Record<string, Authority>): { id: ParticipantId; authority: Authority }[] {
  return Object.entries(selected).flatMap(([id, level]) => { const p = participantById(id); return p ? [{ id: p.id, authority: effectiveAuthority(p, level) }] : []; });
}

export interface WorkbenchFeedback { taskId: string; actor: string; at: number; worked: boolean; note: string }
export function recordFeedback(log: WorkbenchFeedback[], entry: WorkbenchFeedback): WorkbenchFeedback[] {
  return [...log.filter(f => !(f.taskId === entry.taskId && f.actor === entry.actor)), { ...entry, note: entry.note.trim().slice(0, 500) }];
}
