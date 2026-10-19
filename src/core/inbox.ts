// Universal inbox: ONE inbox per person across every workspace and source they belong to.
//
// A person is one identity (in production, one auth account) that can be a member of several
// workspaces. Their inbox is a merged, read-only VIEW over the sources that address them:
// channel messages and @mentions in each workspace, and the task notifications Task-HQ
// already derives. Nothing is copied into a second store: every item points back to the one
// record it came from, and a single read set (keyed by item id) covers all of them, so the
// same thing never appears twice even if it reaches the person by two routes.
//
// Sources are pluggable (InboxSource). Today: Task-HQ workspaces (channels + task
// notifications). Later: other QuestBase relations, email, call logs, WhatsApp — each would
// supply items through the same contract, and is reported "not connected" until it does.
import type { Person, Taxonomy } from './contract.ts';
import { referenceDocument, canonicalTag, tagsIn } from './references.ts';
import type { ReferenceDocument, ReferenceFields, ReferenceScope } from './references.ts';
import type { SearchIndex } from './reference-index.ts';

export interface WorkspaceRef { id: string; name: string; taxonomy?: Taxonomy }

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  purpose: string;
  /** Person ids. Membership decides who reads and posts. */
  members: string[];
}

export interface Message {
  references?: ReferenceFields;
  id: string;
  channelId: string;
  workspaceId: string;
  author: string;
  at: number;
  text: string;
  /** People @mentioned, resolved against that workspace's members when posted. */
  mentions: string[];
  /** Tasks made from this message (status is always read from the task itself). */
  taskIds: string[];
  /** 'system' messages describe actions (a task was made); people write 'message'. */
  kind: 'message' | 'system';
}

export interface MessagingState {
  version: 1;
  workspaces: WorkspaceRef[];
  /** Everyone who appears in any workspace, by stable id (one identity across workspaces). */
  people: Person[];
  /** Workspace membership: workspace id → person ids. */
  membership: Record<string, string[]>;
  channels: Channel[];
  messages: Message[];
}

export type InboxKind = 'mention' | 'message' | 'notification';

export interface InboxItem {
  /** Stable across sources; the read set is keyed by it. */
  id: string;
  kind: InboxKind;
  workspace: WorkspaceRef;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  leadId?: string;
  at: number;
  from: string;
  title: string;
  detail: string;
  /** Severity for notifications; mentions count as high. */
  urgent: boolean;
}

/** Anything that can put items in a person's inbox. */
export interface InboxSource {
  id: string;
  label: string;
  status: 'connected' | 'not-connected';
  note: string;
  items(person: string): InboxItem[];
}

const MAX_MESSAGE = 2000;

export function workspacesOf(state: MessagingState, person: string): WorkspaceRef[] {
  return state.workspaces.filter(item => (state.membership[item.id] ?? []).includes(person));
}

export function channelsFor(state: MessagingState, person: string): Channel[] {
  return state.channels.filter(channel => channel.members.includes(person) && (state.membership[channel.workspaceId] ?? []).includes(person));
}

export type PostResult = { ok: true; state: MessagingState; message: Message } | { ok: false; error: string };

/** Posting is allowed only to members of the channel (and of its workspace). */
export function postMessage(state: MessagingState, author: string, channelId: string, text: string, now: number, id: string, options: { scope?: ReferenceScope; drafts?: ReferenceDocument[]; externalTaxonomy?: boolean } = {}): PostResult {
  const channel = state.channels.find(item => item.id === channelId);
  if (!channel) return { ok: false, error: 'That channel no longer exists.' };
  if (!channel.members.includes(author) || !(state.membership[channel.workspaceId] ?? []).includes(author)) return { ok: false, error: 'Only members of this channel can post here.' };
  const body = text.trim();
  if (!body) return { ok: false, error: 'Write a message first.' };
  if (body.length > MAX_MESSAGE) return { ok: false, error: `Keep messages under ${MAX_MESSAGE} characters.` };
  let scope = channelReferenceScope(state, author, channelId, options.scope);
  const additions = scope.canCreateTags ? tagsIn(body).filter(t => !canonicalTag(t, scope)) : [];
  scope = { ...scope, tags: [...new Set([...scope.tags, ...additions])] };
  const document = referenceDocument(body, scope, undefined, options.drafts);
  const mentions = [...new Set(document.spans.filter(s => s.kind === 'person' && s.id !== author).map(s => s.id))];
  const message: Message = { id, channelId, workspaceId: channel.workspaceId, author, at: now, text: body, references: { text: document }, mentions, taskIds: [], kind: 'message' };
  return { ok: true, state: { ...state, workspaces: state.workspaces.map(w => w.id === channel.workspaceId && !options.externalTaxonomy && additions.length ? { ...w, taxonomy: { types: w.taxonomy?.types ?? [], ...w.taxonomy, tags: [...new Set([...(w.taxonomy?.tags ?? []), ...additions])] } } : w), messages: [...state.messages, message] }, message };
}

/** Records that tasks were made from a message, with one system line in the channel. */
export function linkTasks(state: MessagingState, messageId: string, taskIds: string[], actor: string, now: number, id: string, summary: string): MessagingState {
  const source = state.messages.find(item => item.id === messageId);
  if (!source || !taskIds.length) return state;
  const messages = state.messages.map(item => (item.id === messageId ? { ...item, taskIds: [...new Set([...item.taskIds, ...taskIds])] } : item));
  return { ...state, messages: [...messages, { id, channelId: source.channelId, workspaceId: source.workspaceId, author: actor, at: now, text: summary, mentions: [], taskIds, kind: 'system' }] };
}

/** The workspace's channel messages and mentions, as inbox items for one person. */
export function channelSource(state: MessagingState, workspace: WorkspaceRef): InboxSource {
  return {
    id: `workspace:${workspace.id}:channels`,
    label: `${workspace.name} · channels`,
    status: 'connected',
    note: 'Channel messages and @mentions.',
    items(person) {
      const mine = new Set(channelsFor(state, person).filter(channel => channel.workspaceId === workspace.id).map(channel => channel.id));
      return state.messages
        .filter(message => message.workspaceId === workspace.id && mine.has(message.channelId) && message.author !== person && message.kind === 'message')
        .map(message => {
          const channel = state.channels.find(item => item.id === message.channelId)!;
          const mentioned = message.mentions.includes(person);
          return {
            id: `msg:${message.id}`, kind: mentioned ? 'mention' : 'message', workspace, channelId: channel.id, messageId: message.id,
            taskId: message.taskIds[0], at: message.at, from: message.author,
            title: mentioned ? `Mentioned you in #${channel.name}` : `#${channel.name}`, detail: message.text, urgent: mentioned,
          } satisfies InboxItem;
        });
    },
  };
}

export interface UniversalInbox {
  items: InboxItem[];
  unread: number;
  byWorkspace: { workspace: WorkspaceRef; unread: number; total: number }[];
  sources: { id: string; label: string; status: InboxSource['status']; note: string }[];
}

/**
 * Merges every source for one person. Items with the same id (the same record reached
 * twice, e.g. a notification and a message about one task) appear once; newest first.
 */
export function universalInbox(person: string, sources: InboxSource[], read: Set<string>): UniversalInbox {
  const seen = new Map<string, InboxItem>();
  for (const source of sources) {
    if (source.status !== 'connected') continue;
    for (const item of source.items(person)) {
      const existing = seen.get(item.id);
      if (!existing || (item.kind === 'mention' && existing.kind !== 'mention')) seen.set(item.id, item);
    }
  }
  const items = [...seen.values()].sort((a, b) => Number(b.urgent && !read.has(b.id)) - Number(a.urgent && !read.has(a.id)) || b.at - a.at || a.id.localeCompare(b.id));
  const workspaces = new Map<string, { workspace: WorkspaceRef; unread: number; total: number }>();
  for (const item of items) {
    const entry = workspaces.get(item.workspace.id) ?? { workspace: item.workspace, unread: 0, total: 0 };
    entry.total += 1; if (!read.has(item.id)) entry.unread += 1;
    workspaces.set(item.workspace.id, entry);
  }
  return {
    items, unread: items.filter(item => !read.has(item.id)).length, byWorkspace: [...workspaces.values()],
    sources: sources.map(({ id, label, status, note }) => ({ id, label, status, note })),
  };
}

/** Sources that don't exist yet, reported plainly instead of guessed. */
export const FUTURE_SOURCES: InboxSource[] = [
  { id: 'questbase', label: 'QuestBase relations', status: 'not-connected', note: 'Other QuestBase systems can add items through the same inbox contract.', items: () => [] },
  { id: 'whatsapp', label: 'WhatsApp groups', status: 'not-connected', note: 'Not connected. Private chats are never read.', items: () => [] },
  { id: 'email', label: 'Business email', status: 'not-connected', note: 'Needs an authorized, scoped mailbox.', items: () => [] },
];

// ── Synthetic demo: three workspaces, one set of people, four channels ─────

export function seedMessaging(now: number, people: Person[]): MessagingState {
  const ids = people.filter(person => person.role !== 'reviewer').map(person => person.id);
  const has = (id: string) => ids.includes(id);
  const pick = (...want: string[]) => want.filter(has);
  const workspaces: WorkspaceRef[] = [
    { id: 'demo-roofing', name: 'Quest Roofing' },
    { id: 'demo-construction', name: 'Quest Construction' },
    { id: 'demo-drafting', name: 'Quest Drafting & Design' },
  ];
  const membership: Record<string, string[]> = {
    'demo-roofing': ids,
    'demo-construction': pick('jordan', 'maya', 'alex', 'sam'),
    'demo-drafting': pick('jordan', 'maya', 'riley'),
  };
  const channels: Channel[] = [
    { id: 'ch-office', workspaceId: 'demo-roofing', name: 'office', purpose: 'Calls, leads and follow-ups', members: pick('jordan', 'maya', 'sam', 'riley') },
    { id: 'ch-field', workspaceId: 'demo-roofing', name: 'field-operations', purpose: 'Crews, sites and safety', members: pick('jordan', 'maya', 'alex') },
    { id: 'ch-construction', workspaceId: 'demo-construction', name: 'field-operations', purpose: 'Framing and site coordination', members: pick('jordan', 'maya', 'alex', 'sam') },
    { id: 'ch-dd-admin', workspaceId: 'demo-drafting', name: 'dd-admin', purpose: 'Plans, drafting and client approvals', members: pick('jordan', 'maya', 'riley') },
  ];
  const minutes = (n: number) => now - n * 60_000;
  const m = (id: string, channelId: string, author: string, ago: number, text: string, mentions: string[] = []): Message => {
    const channel = channels.find(item => item.id === channelId)!;
    return { id, channelId, workspaceId: channel.workspaceId, author, at: minutes(ago), text, mentions: mentions.filter(has), taskIds: [], kind: 'message' };
  };
  const messages: Message[] = [
    m('m1', 'ch-office', 'sam', 190, 'Logged 14 calls this morning. Two leads want inspections this week.'),
    m('m2', 'ch-office', 'maya', 150, '@Jordan the Maple Ave estimate is waiting on your pricing sign-off.', ['jordan']),
    m('m3', 'ch-office', 'riley', 95, 'Measurements for Elm St are in. I can have the estimate ready by Friday.'),
    m('m4', 'ch-field', 'alex', 120, 'Crew is on the Northside staging area. Driveway is tight, need the drop zone marked.'),
    m('m5', 'ch-field', 'maya', 60, '@Alex homeowner confirmed the drop zone. Ok to stage after 8am tomorrow.', ['alex']),
    m('m6', 'ch-construction', 'jordan', 240, 'Framing inspection moved to Tuesday. @Maya please update the schedule.', ['maya']),
    m('m7', 'ch-construction', 'sam', 45, 'Client asked for a revised quote on the garage addition.'),
    m('m8', 'ch-dd-admin', 'riley', 80, 'Plan set v2 is uploaded for review. @Jordan needs approval before it goes to the client.', ['jordan']),
    m('m9', 'ch-dd-admin', 'maya', 30, 'Client call moved to 3pm Thursday.'),
  ];
  return { version: 1, workspaces, people, membership, channels, messages };
}

/** Channel visibility is applied before producing any suggestion, count or snippet. */
export function channelReferenceScope(state: MessagingState, actor: string, channelId: string, base?: ReferenceScope): ReferenceScope {
  const channel = channelsFor(state, actor).find(c => c.id === channelId);
  if (!channel) return { workspaceId: '', people: [], tags: [], canCreateTags: false };
  const members = state.membership[channel.workspaceId] ?? [];
  const taxonomy = state.workspaces.find(w => w.id === channel.workspaceId)?.taxonomy;
  const visible = state.messages.filter(m => m.channelId === channel.id && m.workspaceId === channel.workspaceId);
  return { workspaceId: channel.workspaceId, people: state.people.filter(p => channel.members.includes(p.id) && members.includes(p.id)),
    tags: [...new Set([...(base?.tags ?? taxonomy?.tags ?? []), ...visible.flatMap(m => m.references?.text?.spans.filter(s => s.kind === 'tag').map(s => s.id) ?? [])])], aliases: base?.aliases ?? taxonomy?.tagAliases,
    canCreateTags: state.people.find(p => p.id === actor)?.role !== 'reviewer' };
}
export function messageIndex(state: MessagingState, actor: string, current?: { id: string; scope: ReferenceScope }): SearchIndex {
  const channels = channelsFor(state, actor), records: SearchIndex['records'] = [], scopes: ReferenceScope[] = [];
  for (const channel of channels) {
    const base = channel.workspaceId === current?.id ? current.scope : undefined;
    const channelScope = channelReferenceScope(state, actor, channel.id, base);
    const workspace = state.workspaces.find(w => w.id === channel.workspaceId);
    if (!workspace) continue;
    const workspaceId = base?.workspaceId ?? channel.workspaceId;
    const scope = { ...channelScope, workspaceId };
    // Different private channels may expose different names/tags. Keep their authorized
    // scopes separate when parsing records; the merged scope contains only visible names.
    const existing = scopes.find(s => s.workspaceId === workspaceId);
    if (existing) { existing.people = [...new Map([...existing.people, ...scope.people].map(p => [p.id, p])).values()]; existing.tags = [...new Set([...existing.tags, ...scope.tags])]; }
    else scopes.push({ ...scope });
    for (const m of state.messages.filter(m => m.workspaceId === channel.workspaceId && m.channelId === channel.id)) {
      const saved = m.references?.text;
      const old = saved && { text: saved.text, spans: saved.spans.map(s => ({ ...s, workspaceId })) };
      const fields = { text: referenceDocument(m.text, scope, old) };
      records.push({ id: `message:${m.id}`, workspaceId, workspaceName: workspace.name, kind: 'messages', title: `#${channel.name}`, fields, target: { view: 'inbox', id: m.id, channelId: channel.id, messageId: m.id }, updatedAt: m.at });
    }
  }
  return { records, scopes };
}
