import { Select } from '../ui/Select.tsx';
// Universal inbox + channels. One inbox per person across every workspace they belong
// to (src/core/inbox.ts): channel messages, @mentions and the task notifications Task-HQ
// already derives, merged once with one read state shared with the sidebar. Channels are
// demo-only (synthetic people and messages) until a messaging backend is approved.
import { ReferenceTextarea, ReferenceProvider, ReferencedText } from '../ui/ReferenceEditor.tsx';
import { referenceScope, canonicalTag, tagsIn } from '../core/references.ts';
import { channelReferenceScope } from '../core/inbox.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import { FUTURE_SOURCES, channelSource, channelsFor, linkTasks, postMessage, universalInbox, workspacesOf } from '../core/inbox.ts';
import type { InboxItem, InboxSource, MessagingState, WorkspaceRef } from '../core/inbox.ts';
import { canCreateTask } from '../core/permissions.ts';
import { firstName, taskById } from '../core/selectors.ts';
import type { MessagingStore } from '../adapter/messaging.ts';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { Composer } from './Composer.tsx';
import type { Notification } from './notifications.ts';
import { notificationSource } from './notifications.ts';

export interface InboxData {
  /** null in a live workspace: no messaging backend yet. */
  messaging: MessagingState | null;
  store: MessagingStore | null;
  /** The Task-HQ workspace currently open (its tasks can be created from messages). */
  current: WorkspaceRef;
}

/** Every source for this person, with the unread count the nav shows. */
export function inboxFor(person: string, data: InboxData, notes: Notification[], read: Set<string>) {
  const sources: InboxSource[] = [notificationSource(notes, data.current)];
  if (data.messaging) for (const workspace of workspacesOf(data.messaging, person)) sources.push(channelSource(data.messaging, workspace));
  return universalInbox(person, [...sources, ...FUTURE_SOURCES], read);
}

type Filter = 'all' | 'mentions' | 'tasks' | 'unread';

export function Inbox({ quest, data, notes, read, markRead, onOpenTask, onOpenLead }: {
  quest: Quest; data: InboxData; notes: Notification[]; read: Set<string>; markRead: (ids: string[]) => void;
  onOpenTask: (id: string) => void; onOpenLead: (id: string) => void;
}) {
  const { state, actor } = quest;
  const person = actor;
  const inbox = useMemo(() => inboxFor(person, data, notes, read), [person, data, notes, read]);
  const [filter, setFilter] = useState<Filter>('all');
  const [workspace, setWorkspace] = useState<string>('');
  const [channelId, setChannelId] = useState<string | null>(() => location.hash.split('/')[2] ? decodeURIComponent(location.hash.split('/')[2]!) : null);
  useEffect(() => { const change = () => { if (location.hash.startsWith('#/inbox/')) setChannelId(decodeURIComponent(location.hash.split('/')[2]!)); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const channels = data.messaging ? channelsFor(data.messaging, person) : [];
  const workspaces = data.messaging ? workspacesOf(data.messaging, person) : [data.current];
  const channel = channels.find(item => item.id === channelId) ?? null;

  const shown = inbox.items.filter(item => (!workspace || item.workspace.id === workspace)
    && (filter === 'all' || (filter === 'mentions' ? item.kind === 'mention' : filter === 'tasks' ? item.kind === 'notification' : !read.has(item.id))));
  const unreadIn = (id: string) => inbox.items.filter(item => item.channelId === id && !read.has(item.id)).length;

  // Opening a channel reads it.
  useEffect(() => {
    if (!channelId) return;
    const ids = inbox.items.filter(item => item.channelId === channelId && !read.has(item.id)).map(item => item.id);
    if (ids.length) markRead(ids);
  }, [channelId, inbox.items, read, markRead]);

  function open(item: InboxItem) {
    markRead([item.id]);
    if (item.channelId) { setChannelId(item.channelId); return; }
    if (item.taskId) onOpenTask(item.taskId);
    else if (item.leadId) onOpenLead(item.leadId);
  }

  return (
    <div className="view inbox-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Universal inbox · {firstName(state, person)} · {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}{data.messaging ? ' · demo channels' : ''}</p>
          <h1>Inbox</h1>
          <p className="lede">{inbox.unread ? `${inbox.unread} unread` : 'All caught up'} — one inbox for everything addressed to you, across every workspace. Each item appears once.</p>
        </div>
        {inbox.unread > 0 && <button type="button" className="btn btn-ghost" onClick={() => markRead(inbox.items.map(item => item.id))}>Mark all read</button>}
      </header>

      <div className="inbox-layout">
        <nav className="inbox-nav" aria-label="Inbox and channels">
          <button type="button" className={`inbox-nav-item ${channelId === null ? 'is-active' : ''}`} onClick={() => setChannelId(null)}>
            <b>Everything</b>{inbox.unread > 0 && <span className="unread-badge">{inbox.unread}</span>}
          </button>
          {workspaces.map(ws => (
            <section key={ws.id} className="inbox-ws">
              <h3 className="section-label">{ws.name}{ws.id === data.current.id && <em className="planned-tag">open here</em>}</h3>
              {channels.filter(item => item.workspaceId === ws.id).map(item => (
                <button key={item.id} type="button" className={`inbox-nav-item ${channelId === item.id ? 'is-active' : ''}`} onClick={() => setChannelId(item.id)}>
                  <span># {item.name}</span>{unreadIn(item.id) > 0 && <span className="unread-badge">{unreadIn(item.id)}</span>}
                </button>
              ))}
              {!data.messaging && <p className="muted">Channels aren’t set up for this workspace yet.</p>}
            </section>
          ))}
        </nav>

        <section className="inbox-main" aria-live="polite">
          {channel && data.messaging && data.store
            ? <Thread key={channel.id} quest={quest} messaging={data.messaging} store={data.store} channelId={channel.id} current={data.current} onOpenTask={onOpenTask} />
            : (
              <>
                <div className="inbox-filters" role="group" aria-label="Filter">
                  {(['all', 'mentions', 'tasks', 'unread'] as Filter[]).map(value => (
                    <button key={value} type="button" className={`lens ${filter === value ? 'is-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                      {value === 'all' ? 'All' : value === 'mentions' ? 'Mentions' : value === 'tasks' ? 'Tasks & approvals' : 'Unread'}
                    </button>
                  ))}
                  {workspaces.length > 1 && (
                    <Select value={workspace} onChange={event => setWorkspace(event.target.value)} aria-label="Workspace">
                      <option value="">All workspaces</option>
                      {inbox.byWorkspace.map(item => <option key={item.workspace.id} value={item.workspace.id}>{item.workspace.name}{item.unread ? ` (${item.unread})` : ''}</option>)}
                    </Select>
                  )}
                </div>
                {shown.length === 0 ? <p className="inbox-empty">Nothing here.</p> : (
                  <ul className="inbox-feed">
                    {shown.map(item => (
                      <li key={item.id}>
                        <button type="button" className={`inbox-item k-${item.kind} ${read.has(item.id) ? '' : 'is-unread'}`} onClick={() => open(item)}>
                          <span className="inbox-item-head">
                            <span className="inbox-ws-chip">{item.workspace.name}</span>
                            <b>{item.title}</b>
                            <time>{new Date(item.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                          </span>
                          <span className="inbox-item-body">{item.from && data.messaging && <strong>{data.messaging.people.find(p => p.id === item.from)?.name ?? ''}: </strong>}{item.detail}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          <footer className="inbox-sources">
            <span className="section-label">Sources</span>
            {inbox.sources.map(source => <span key={source.id} title={source.note}><i className={`sig-dot ${source.status === 'connected' ? 'is-live' : ''}`} aria-hidden="true" />{source.label}<small>{source.status === 'connected' ? (data.messaging && source.id.includes('channels') ? 'demo' : 'connected') : 'not connected'}</small></span>)}
          </footer>
        </section>
      </div>
    </div>
  );
}

function Thread({ quest, messaging, store, channelId, current, onOpenTask }: {
  quest: Quest; messaging: MessagingState; store: MessagingStore; channelId: string; current: WorkspaceRef; onOpenTask: (id: string) => void;
}) {
  const { state, actor, now } = quest;
  const channel = messaging.channels.find(item => item.id === channelId)!;
  const ws = messaging.workspaces.find(item => item.id === channel.workspaceId)!;
  const scope = channelReferenceScope(messaging, actor, channelId, channel.workspaceId === current.id ? referenceScope(state, actor) : undefined);
  const messages = messaging.messages.filter(item => item.channelId === channelId && item.workspaceId === channel.workspaceId).sort((a, b) => a.at - b.at);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [making, setMaking] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const here = channel.workspaceId === current.id;
  const nameOf = (id: string) => messaging.people.find(item => item.id === id)?.name ?? 'Someone';
  useEffect(() => { const id = location.hash.split('/')[3]; const target = id ? document.getElementById(`message-${decodeURIComponent(id)}`) : null; (target ?? end.current)?.scrollIntoView({ block: target ? 'center' : 'end' }); if (target) { target.classList.add('search-target'); target.setAttribute('tabindex', '-1'); target.focus(); } }, [messages.length, channelId]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const newTags = here && scope.canCreateTags ? tagsIn(text).filter(t => !canonicalTag(t, scope)) : [];
    if (newTags.length) { const registered = await quest.dispatch({ type: 'taxonomy/register-tags', tags: newTags }); if (!registered.ok) { setError(registered.error); return; } }
    const result = postMessage(messaging, actor, channelId, text, Date.now(), `m-${Date.now().toString(36)}`, { scope, drafts: quest.referenceDrafts.documents(), externalTaxonomy: here });
    if (!result.ok) { setError(result.error); return; }
    store.save(result.state); setText(''); setError('');
  }
  function linked(messageId: string, tasks: { id: string; title: string }[]) {
    const summary = `${firstName(state, actor)} made ${tasks.length === 1 ? 'a task' : `${tasks.length} tasks`}: ${tasks.map(item => `“${item.title}”`).join(', ')}.`;
    store.save(linkTasks(store.load(), messageId, tasks.map(item => item.id), actor, Date.now(), `sys-${Date.now().toString(36)}`, summary));
    setMaking(null);
  }

  return (
    <ReferenceProvider scope={scope} drafts={quest.referenceDrafts}><div className="thread">
      <header className="thread-head">
        <div><p className="eyebrow">{ws.name}</p><h2># {channel.name}</h2><p className="muted">{channel.purpose} · {channel.members.map(nameOf).map(name => name.split(' ')[0]).join(', ')}</p></div>
      </header>
      <ol className="thread-list">
        {messages.map(message => (
          <li key={message.id} id={`message-${message.id}`} className={`msg ${message.kind === 'system' ? 'is-system' : ''} ${message.mentions.includes(actor) ? 'is-mention' : ''}`}>
            {message.kind === 'system'
              ? <p className="msg-system">{message.text}</p>
              : <>
                <Avatar state={{ ...state, people: messaging.people }} id={message.author} size="md" />
                <div className="msg-body">
                  <p className="msg-meta"><b>{nameOf(message.author)}</b><time>{new Date(message.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time></p>
                  <p className="msg-text"><ReferencedText text={message.text} document={message.references?.text} /></p>
                  {message.taskIds.length > 0 && (
                    <p className="msg-tasks">{message.taskIds.map(id => {
                      const task = here ? taskById(state, id) : undefined;
                      return task
                        ? <button key={id} type="button" className="msg-task" onClick={() => onOpenTask(id)}><span className={`pill pill-${task.status}`}>{STATUS_LABELS[task.status]}</span>{task.title}</button>
                        : <span key={id} className="msg-task is-gone">Task no longer available</span>;
                    })}</p>
                  )}
                  {here && canCreateTask(state, actor, now) && making !== message.id && <button type="button" className="link msg-make" onClick={() => setMaking(message.id)}>Make a task</button>}
                  {!here && <span className="muted msg-make">Tasks for {ws.name} are made in that workspace.</span>}
                  {making === message.id && (
                    <div className="msg-composer">
                      <Composer quest={quest} variant="registry" single initialText={message.text} onCreated={tasks => linked(message.id, tasks)} />
                      <button type="button" className="link" onClick={() => setMaking(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              </>}
          </li>
        ))}
        <div ref={end} />
      </ol>
      {channel.members.includes(actor)
        ? <form className="thread-post" onSubmit={send}>
            <ReferenceTextarea rows={1} value={text} placeholder={`Message #${channel.name} — @name to mention`} aria-label={`Message #${channel.name}`} onChange={event => setText(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); (event.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="btn btn-primary btn-sm" disabled={!text.trim()}>Send</button>
            {error && <p className="form-error auth-notice is-error" role="alert">{error}</p>}
          </form>
        : <p className="muted">You can read this channel but you aren’t a member, so you can’t post.</p>}
      <p className="boundary">Demo channel: synthetic people and messages stored in this browser. Nothing is sent to WhatsApp, email or anyone’s phone.</p>
    </div></ReferenceProvider>
  );
}
