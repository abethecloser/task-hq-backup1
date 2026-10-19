// Synthetic demo workspace. Every person, project and lead here is fictional.
import { DEFAULT_POLICY, SCHEMA_VERSION } from './contract.ts';
import type { Lead, NewTask, Person, Project, QuestState, SimulatedLeadInput, Task } from './contract.ts';
import { HOUR, MINUTE, addDays, localDate } from './time.ts';
import { QUEST_ROOFING_WORKSPACE } from './workspace.ts';

export const DEMO_PEOPLE: Person[] = [
  { id: 'jordan', name: 'Jordan Lee', role: 'manager', title: 'Operations Manager' },
  { id: 'maya', name: 'Maya Chen', role: 'coordinator', title: 'Project Coordinator' },
  { id: 'alex', name: 'Alex Morgan', role: 'field', title: 'Field Lead' },
  { id: 'sam', name: 'Sam Rivera', role: 'sales', title: 'Sales Representative' },
  { id: 'riley', name: 'Riley Brooks', role: 'estimator', title: 'Estimator' },
];

/** Product reviewer persona for the local preview. Feedback only; no email or credentials. */
export const REVIEWER_PERSONA: Person = { id: 'abraham', name: 'Abraham', role: 'reviewer', title: 'Reviewer (local preview)' };
/** Product-feedback work. The id is kept from earlier versions for stored-data compatibility. */
export const PRODUCT_PROJECT: Project = { id: 'quest-product', name: 'Task-HQ product (development)' };

export const DEMO_PROJECTS: Project[] = [
  { id: 'northside', name: 'Northside re-roof' },
  { id: 'maple', name: 'Maple Ave storm repair' },
  { id: 'office', name: 'Office & sales' },
];

export function blankTask(id: string, input: NewTask, actor: string, now: number): Task {
  return {
    id,
    title: input.title.trim(),
    description: input.description?.trim() ?? '',
    projectId: input.projectId ?? '',
    owner: input.owner ?? '',
    nextOwner: input.nextOwner ?? '',
    decisionOwner: input.decisionOwner ?? '',
    approver: input.approver ?? '',
    waitingOn: input.waitingOn?.trim() ?? '',
    watchers: input.watchers ?? [],
    status: 'ready',
    priority: input.priority ?? 'normal',
    due: input.due ?? '',
    nextAction: input.nextAction?.trim() ?? '',
    dependsOn: input.dependsOn ?? [],
    blocker: null,
    leadId: input.leadId ?? '',
    ultra: false,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    completedAt: null,
  };
}

function task(id: string, input: NewTask & Partial<Task>, now: number, ageMs: number): Task {
  const base = blankTask(id, input, 'maya', now - ageMs);
  return { ...base, ...input, id, createdAt: now - ageMs, updatedAt: now - ageMs, lastActivityAt: input.lastActivityAt ?? now - ageMs } as Task;
}

const LEAD_POOL: SimulatedLeadInput[] = [
  { name: 'Harper residence', source: 'Website form (simulated)', phone: '(555) 010-2231', address: '418 Juniper Ct', need: 'Missing shingles after Tuesday wind storm' },
  { name: 'Okafor family', source: 'Phone voicemail (simulated)', phone: '(555) 010-7782', address: '92 Lakeview Dr', need: 'Ceiling stain in upstairs bedroom, wants inspection' },
  { name: 'Brightline Dental', source: 'Referral (simulated)', phone: '(555) 010-4410', address: '1200 Commerce Pkwy', need: 'Flat roof leak over reception, commercial quote' },
  { name: 'Delgado residence', source: 'Website form (simulated)', phone: '(555) 010-9036', address: '7 Orchard Ln', need: 'Full replacement quote, 22-year-old roof' },
  { name: 'Patel residence', source: 'Yard sign call (simulated)', phone: '(555) 010-3318', address: '55 Cedar Bend', need: 'Gutter and fascia damage, insurance claim open' },
];

export function simulatedLead(index: number): SimulatedLeadInput {
  return LEAD_POOL[index % LEAD_POOL.length]!;
}

/** Next synthetic lead whose name is not already on the board. */
export function nextSimulatedLead(existing: { name: string }[]): SimulatedLeadInput {
  const names = new Set(existing.map(lead => lead.name));
  const fresh = LEAD_POOL.find(lead => !names.has(lead.name));
  if (fresh) return fresh;
  const base = LEAD_POOL[existing.length % LEAD_POOL.length]!;
  return { ...base, name: `${base.name} (${Math.floor(existing.length / LEAD_POOL.length) + 1})` };
}

export function blankLead(id: string, input: SimulatedLeadInput, now: number): Lead {
  return {
    id, ...input,
    arrivedAt: now, assignee: '', assignedAt: null, firstResponseAt: null, attempts: [],
    stage: 'new', blocker: '', followUpTaskId: '', handoffTaskId: '', escalatedTo: '',
    simulated: true, updatedAt: now,
  };
}

export function seedState(now: number): QuestState {
  const today = localDate(now);
  const tasks: Task[] = [
    // The original Move Work Forward chain from the first Quest app, kept intact.
    task('site-plan', { title: 'Approve the Northside site plan', description: 'Review the latest layout and confirm the crew can use it for tomorrow’s setup.', projectId: 'northside', owner: 'jordan', status: 'done', priority: 'high', due: today, nextAction: 'Sign off the layout PDF', completedAt: now - 3 * HOUR, nextOwner: 'maya' }, now, 26 * HOUR),
    task('staging-area', { title: 'Confirm the material staging area', description: 'Check the proposed staging location against the site plan and share a clear route.', projectId: 'northside', owner: 'maya', status: 'working', priority: 'high', due: today, dependsOn: ['site-plan'], nextAction: 'Walk the driveway with the homeowner and mark the drop zone', nextOwner: 'alex', watchers: ['jordan'] }, now, 6 * HOUR),
    task('crew-handoff', { title: 'Prepare tomorrow’s crew handoff', description: 'Bring the next shift into focus with a clear starting location and first action.', projectId: 'northside', owner: 'alex', status: 'ready', due: addDays(now, 1), dependsOn: ['staging-area'], nextAction: 'Write the 6:30am start sheet with the staging route' }, now, 5 * HOUR),
    task('permit-update', { title: 'Get the updated permit schedule', description: 'Confirm the revised inspection window so the field team can plan the next visit.', projectId: 'northside', owner: 'sam', status: 'blocked', priority: 'high', due: today, waitingOn: 'City permit office', nextAction: 'Call the permit desk once the address is corrected', blocker: { note: 'Could someone confirm the inspection office has the revised site address?', by: 'sam', at: now - 2 * HOUR, helper: 'maya' } }, now, 8 * HOUR),
    // Additional synthetic work so each attention rule has something real to show.
    task('maple-tarp', { title: 'Tarp the Maple Ave rear slope', description: 'Temporary protection until the replacement materials arrive.', projectId: 'maple', owner: 'alex', status: 'ready', priority: 'high', due: addDays(now, -1), nextAction: 'Load two 20x30 tarps and sandbags on the truck' }, now, 30 * HOUR),
    task('maple-estimate', { title: 'Send the Maple Ave repair estimate', description: 'Line-item estimate for the storm repair, ready for homeowner signature.', projectId: 'maple', owner: 'riley', status: 'review', due: today, approver: 'jordan', decisionOwner: 'jordan', nextAction: 'Jordan approves pricing, then Riley sends it', nextOwner: 'sam' }, now, 20 * HOUR),
    task('shingle-order', { title: 'Order replacement shingles for Maple Ave', projectId: 'maple', owner: '', status: 'ready', due: addDays(now, 2), dependsOn: ['maple-estimate'], description: 'Match the existing color; supplier quote is in the shared folder.' }, now, 4 * HOUR),
    task('warranty-docs', { title: 'File warranty paperwork for Elm St job', projectId: 'office', owner: 'maya', status: 'working', due: addDays(now, 3), description: 'Manufacturer warranty registration for the completed Elm St roof.', lastActivityAt: now - 52 * HOUR }, now, 60 * HOUR),
    task('safety-brief', { title: 'Run the weekly safety briefing', projectId: 'office', owner: 'alex', status: 'ready', due: addDays(now, 1), nextAction: 'Print the fall-protection checklist', description: 'Ten-minute crew briefing before the Monday start.' }, now, 2 * HOUR),
  ];
  const leads: Lead[] = [
    { ...blankLead('lead-okafor', simulatedLead(1), now - 3 * MINUTE) },
    {
      ...blankLead('lead-brightline', simulatedLead(2), now - 40 * MINUTE),
      assignee: 'sam', assignedAt: now - 38 * MINUTE, firstResponseAt: now - 36 * MINUTE, stage: 'contacted',
      attempts: [{ at: now - 36 * MINUTE, by: 'sam', channel: 'phone', outcome: 'reached', note: 'Office manager available after 2pm for a walk-through.' }],
    },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    people: [...DEMO_PEOPLE, REVIEWER_PERSONA],
    projects: [...DEMO_PROJECTS, PRODUCT_PROJECT],
    tasks,
    leads,
    focus: null,
    grants: [],
    events: [{ id: 'seed', at: now, actor: 'system', kind: 'system', text: 'Demo workspace created with synthetic people, projects and leads.' }],
    policy: { ...DEFAULT_POLICY },
    rev: 1,
    updatedAt: now,
    writer: 'seed',
    workspace: { ...QUEST_ROOFING_WORKSPACE },
    feedback: [],
    invites: [],
  };
}
