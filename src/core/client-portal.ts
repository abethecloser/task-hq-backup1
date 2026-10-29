// Client workspace: what one client may see of one project, and how they reach the team.
// Everything here is a projection of existing records — tasks the team has tagged for the
// client, and the project's shared client channel — never a copy. The projection is the
// contract: only these fields leave the team's records. Internal comments, blocker notes,
// descriptions, other projects, other channels and people's task authority never do.
//
// The demo enforces it in this browser. Live Task HQ cannot yet: see docs/client-workspace.md
// for the server work (client grants, a server-side projection, per-row messaging and files).
import type { Person, QuestState, Task, TaskStatus } from './contract.ts';
import type { MessageAttachment, MessagingState, PostResult, QuestKind } from './inbox.ts';
import { postMessage } from './inbox.ts';
import { isOpen } from './selectors.ts';

/** Tasks tagged with this are shared with the project's client. Untagged work stays internal. */
export const CLIENT_SHARE_TAG = 'client';
/** Shared tasks tagged with this are waiting on the client (an approval, a decision, information). */
export const CLIENT_INPUT_TAG = 'client-input';

/** One client's access to one project. A client may hold several, one per project. */
export interface ClientAccess {
  /** The client's identity in messaging (never a Task HQ team member, so it carries no task authority). */
  person: string;
  name: string;
  projectId: string;
  /** Messaging workspace and the project's client channel. */
  workspaceId: string;
  channelId: string;
}

/** Synthetic demo client for the Northside re-roof. */
export const DEMO_CLIENT: ClientAccess = { person: 'client-dana', name: 'Dana Whitfield', projectId: 'northside', workspaceId: 'demo-roofing', channelId: 'ch-client-northside' };
/** Team members in the demo client channel (the project's coordinator and manager). */
export const DEMO_CLIENT_TEAM = ['maya', 'jordan'];

export type Authorized = { ok: true; access: ClientAccess } | { ok: false; error: string };

/** Entering a project requires a grant for exactly that person and project. */
export function authorize(grants: ClientAccess[], person: string, projectId: string): Authorized {
  const access = grants.find(item => item.person === person && item.projectId === projectId);
  return access ? { ok: true, access } : { ok: false, error: 'You don’t have access to this project.' };
}

export type UpdateKind = 'planned' | 'started' | 'review' | 'completed' | 'reopened' | 'message' | 'you';
export interface ClientUpdate { id: string; kind: UpdateKind; at: number; title: string; detail: string; by: string; taskId?: string; messageId?: string; files: number }
export interface ClientTask { id: string; title: string; status: TaskStatus; due: string; dueTime?: string; completedAt: number | null }
export interface ClientInput { id: string; title: string; detail: string; at: number; taskId?: string; messageId?: string }
export interface ClientFile { attachment: MessageAttachment; by: string; at: number; messageId: string }
export interface ClientMessage { id: string; by: string; mine: boolean; at: number; text: string; quest?: QuestKind; attachments: MessageAttachment[] }
export interface ClientWorkspace {
  project: { id: string; name: string };
  progress: { done: number; total: number; percent: number };
  updates: ClientUpdate[];
  next: ClientTask[];
  input: ClientInput[];
  files: ClientFile[];
  conversation: ClientMessage[];
  tasks: ClientTask[];
}

const sharedTasks = (state: QuestState, access: ClientAccess) =>
  state.tasks.filter(task => task.projectId === access.projectId && !task.archivedAt && (task.tags ?? []).includes(CLIENT_SHARE_TAG));
const clientTask = (task: Task): ClientTask => ({ id: task.id, title: task.title, status: task.status, due: task.due, ...(task.dueTime ? { dueTime: task.dueTime } : {}), completedAt: task.completedAt });

export function clientWorkspace(state: QuestState, messaging: MessagingState | null, access: ClientAccess): ClientWorkspace {
  const project = state.projects.find(item => item.id === access.projectId);
  const tasks = sharedTasks(state, access);
  const ids = new Set(tasks.map(task => task.id));
  const byName = (id: string) => (state.people.find(item => item.id === id) ?? messaging?.people.find(item => item.id === id))?.name.split(' ')[0] ?? 'Your team';

  // Progress updates come from the event log by action, never from its text (which can hold internal notes).
  const updates = new Map<string, ClientUpdate>();
  const add = (update: ClientUpdate) => { if (!updates.has(update.id)) updates.set(update.id, update); };
  for (const event of state.events) {
    if (!event.taskId || !ids.has(event.taskId) || event.undone) continue;
    const task = tasks.find(item => item.id === event.taskId)!;
    const kind: UpdateKind | null = event.actionType === 'task/create' ? 'planned'
      : event.actionType === 'task/reopen' ? 'reopened'
      : event.actionType === 'task/advance' ? (/ completed “/.test(event.text) ? 'completed' : / started “/.test(event.text) ? 'started' : 'review')
      : null;
    if (kind) add({ id: `${task.id}:${kind}:${event.id}`, kind, at: event.at, title: task.title, detail: UPDATE_DETAIL[kind], by: byName(event.actor), taskId: task.id, files: 0 });
  }
  // Shared work recorded before any event (seeded or imported) still shows its milestones.
  for (const task of tasks) {
    if (task.completedAt && ![...updates.values()].some(u => u.taskId === task.id && u.kind === 'completed'))
      add({ id: `${task.id}:completed`, kind: 'completed', at: task.completedAt, title: task.title, detail: UPDATE_DETAIL.completed, by: byName(task.completedBy ?? task.owner), taskId: task.id, files: 0 });
    if (task.status === 'working' && ![...updates.values()].some(u => u.taskId === task.id && u.kind === 'started'))
      add({ id: `${task.id}:started`, kind: 'started', at: task.lastActivityAt, title: task.title, detail: UPDATE_DETAIL.started, by: byName(task.owner), taskId: task.id, files: 0 });
  }

  const channel = messaging?.channels.find(item => item.id === access.channelId && item.members.includes(access.person) && item.projectId === access.projectId);
  const messages = channel ? messaging!.messages.filter(item => item.channelId === channel.id && item.kind === 'message').sort((a, b) => a.at - b.at) : [];
  const conversation = messages.map((item): ClientMessage => ({ id: item.id, by: item.author === access.person ? 'You' : byName(item.author), mine: item.author === access.person, at: item.at, text: item.text, ...(item.quest ? { quest: item.quest } : {}), attachments: item.attachments ?? [] }));
  for (const item of conversation) add({ id: `msg:${item.id}`, kind: item.mine ? 'you' : 'message', at: item.at, title: item.mine ? (item.quest ? 'You sent a New Quest' : 'You commented') : `${item.by} posted an update`, detail: item.text, by: item.by, messageId: item.id, files: item.attachments.length });

  // Needs your input: shared tasks waiting on the client, and team messages that @mention them since they last wrote.
  const lastMine = Math.max(0, ...messages.filter(item => item.author === access.person).map(item => item.at));
  const input: ClientInput[] = [
    ...tasks.filter(task => isOpen(task) && (task.tags ?? []).includes(CLIENT_INPUT_TAG)).map(task => ({ id: `task:${task.id}`, title: task.title, detail: task.due ? 'The team needs your input before the due date.' : 'The team needs your input.', at: task.updatedAt, taskId: task.id })),
    ...messages.filter(item => item.author !== access.person && item.mentions.includes(access.person) && item.at > lastMine).map(item => ({ id: `msg:${item.id}`, title: `${byName(item.author)} asked you`, detail: item.text, at: item.at, messageId: item.id })),
  ];

  const open = tasks.filter(isOpen).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.dueTime ?? '').localeCompare(b.dueTime ?? '') || a.title.localeCompare(b.title));
  const done = tasks.filter(task => task.status === 'done').length;
  return {
    project: { id: access.projectId, name: project?.name ?? 'Your project' },
    progress: { done, total: tasks.length, percent: tasks.length ? Math.floor((done / tasks.length) * 100) : 0 },
    updates: [...updates.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)),
    next: open.slice(0, 5).map(clientTask),
    input,
    files: messages.flatMap(item => (item.attachments ?? []).map(attachment => ({ attachment, by: item.author === access.person ? 'You' : byName(item.author), at: item.at, messageId: item.id }))).reverse(),
    conversation,
    tasks: tasks.map(clientTask),
  };
}

const UPDATE_DETAIL: Record<UpdateKind, string> = {
  planned: 'Added to the project plan.', started: 'Work is in progress.', review: 'Moved forward and being checked.',
  completed: 'Completed.', reopened: 'Reopened for more work.', message: '', you: '',
};

/** Makes sure the client channel exists in a messaging store (older demo stores predate it). Idempotent. */
export function ensureClientSpace(state: MessagingState, access: ClientAccess, team: string[], now: number): MessagingState {
  const members = [access.person, ...team];
  const person: Person = { id: access.person, name: access.name, role: 'reviewer', title: 'Client' };
  let next = state;
  if (!next.people.some(item => item.id === access.person)) next = { ...next, people: [...next.people, person] };
  const inWorkspace = next.membership[access.workspaceId] ?? [];
  if (!inWorkspace.includes(access.person)) next = { ...next, membership: { ...next.membership, [access.workspaceId]: [...inWorkspace, access.person] } };
  if (!next.channels.some(item => item.id === access.channelId)) {
    next = { ...next, channels: [...next.channels, { id: access.channelId, workspaceId: access.workspaceId, name: 'northside-client', purpose: 'Shared with Dana Whitfield · Northside re-roof', members, projectId: access.projectId }] };
    const hours = (n: number) => now - n * 3_600_000;
    next = { ...next, messages: [...next.messages,
      { id: `${access.channelId}-1`, channelId: access.channelId, workspaceId: access.workspaceId, author: 'maya', at: hours(26), text: 'The site plan is approved. We’ll stage materials on the driveway side.', mentions: [], taskIds: [], kind: 'message' },
      { id: `${access.channelId}-2`, channelId: access.channelId, workspaceId: access.workspaceId, author: access.person, at: hours(25), text: 'Thanks! The side gate code is 2468 if the crew needs it.', mentions: [], taskIds: [], kind: 'message' },
      { id: `${access.channelId}-3`, channelId: access.channelId, workspaceId: access.workspaceId, author: 'maya', at: hours(3), text: `@${access.name.split(' ')[0]} could you confirm the drop zone by the garage works for you?`, mentions: [access.person], taskIds: [], kind: 'message' },
    ] };
  }
  return next;
}

export interface QuestInput { kind: QuestKind; text: string; attachments?: MessageAttachment[] }

/** New Quest: a message in the project's client channel, linked to the client and project. It reaches the
 * team's inbox like any channel message; the team decides whether it becomes a task. */
export function submitQuest(state: MessagingState, access: ClientAccess, input: QuestInput, now: number, id: string): PostResult {
  const channel = state.channels.find(item => item.id === access.channelId);
  if (!channel || channel.projectId !== access.projectId) return { ok: false, error: 'This project’s conversation isn’t available.' };
  const files = input.attachments ?? [];
  if (files.length > 10) return { ok: false, error: 'Attach up to 10 files.' };
  const text = input.text.trim() || (files.length ? `Shared ${files.length === 1 ? files[0]!.name : `${files.length} files`}.` : '');
  const result = postMessage(state, access.person, access.channelId, text, now, id, { externalTaxonomy: true });
  if (!result.ok) return result;
  const message = { ...result.message, quest: input.kind, ...(files.length ? { attachments: files } : {}) };
  return { ok: true, message, state: { ...result.state, messages: result.state.messages.map(item => (item.id === id ? message : item)) } };
}
