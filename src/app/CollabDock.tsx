// Bottom collaboration dock for Home: the vertical counterpart of the left calendar and right
// notifications panels. Collapsed it is a slim rail with live counts; expanded it opens upward and the
// shell gives it height taken from the center (no overlay). Everything here reuses existing pieces:
// the same comments/mentions feed and team activity Home showed, and the task comment thread with its
// `task/comment` reply, so permissions and history are unchanged.
import { useMemo, useState } from 'react';
import { collaboration, teamActivity, ago } from '../core/dashboard.ts';
import type { CollabItem, MentionSource } from '../core/dashboard.ts';
import { firstName, taskById } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { COLLAB_VERB, Chevron, Initial, Recent } from './Home.tsx';
import { CommentReply, EventFeed, canReply, isComment, taskEvents } from './TaskComments.tsx';

export function CollabDock({ quest, company, open, onToggle, mentions, read, unseen, onUnseen, onOpen, onOpenMention, onActivity }: {
  quest: Quest; company: boolean; open: boolean; onToggle: () => void;
  /** Channel @mentions from the universal inbox, and its read set. */
  mentions: MentionSource[]; read: Set<string>;
  /** Updates in the person's inbox they haven't opened yet (the same read set as the bell). */
  unseen: { count: number; latest?: string }; onUnseen: () => void;
  onOpen: (id: string) => void; onOpenMention: (item: CollabItem) => void; onActivity: () => void;
}) {
  const { state, actor, now } = quest;
  const collab = useMemo(() => collaboration(state, actor, company, mentions, read, 12), [state, actor, company, mentions, read]);
  const activity = useMemo(() => teamActivity(state, actor, company, 12), [state, actor, company]);
  const unreadCollab = collab.filter(item => item.unread).length;
  const people = [...new Set(collab.map(item => item.from))].slice(0, 3);

  // The thread shown in the middle column: the picked task, else the newest task conversation,
  // else the task with the latest team activity.
  const [picked, setPicked] = useState<string | null>(null);
  const threadId = (picked && taskById(state, picked) ? picked : null)
    ?? collab.find(item => item.taskId && !item.channelId)?.taskId ?? activity.find(event => event.taskId && taskById(state, event.taskId))?.taskId ?? null;
  const thread = threadId ? taskById(state, threadId) : undefined;
  const comments = thread ? taskEvents(state.events, thread.id).filter(isComment) : [];

  const toggleLabel = open ? 'Collapse the collaboration panel' : 'Expand the collaboration panel';
  return (
    <section id="collab-dock" className={`collab-dock ${open ? 'is-open' : ''}`} aria-label="Live collaboration">
      <button type="button" className="dock-toggle" aria-controls="collab-dock-body" aria-expanded={open} aria-label={toggleLabel} title={open ? 'Collapse' : 'Comments, mentions & activity'} onClick={onToggle}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} /></svg>
      </button>

      <div className="dock-rail">
        <button type="button" className="dock-rail-main" aria-controls="collab-dock-body" aria-expanded={open} onClick={onToggle}>
          <span className={`dock-mark ${unreadCollab ? 'is-live' : ''}`} aria-hidden="true">
            <svg className="icon" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></svg>
          </span>
          <span className="dock-label">Live collaboration</span>
          <span className="dock-sep" aria-hidden="true" />
          <span className={`dock-count ${unreadCollab ? 'is-hot' : ''}`}>{unreadCollab ? `${unreadCollab} unread ${unreadCollab === 1 ? 'mention' : 'mentions'}` : collab.length ? `${collab.length} recent` : 'All quiet'}</span>
          {activity[0] && <span className="dock-latest">Latest · {ago(activity[0].at, now)}</span>}
        </button>
        {people.length > 0 && <span className="dock-faces" aria-hidden="true">{people.map(id => <Initial key={id} state={state} id={id} />)}</span>}
      </div>

      <div id="collab-dock-body" className="dock-body" inert={!open}>
        <div className="dock-col">
          <header className="dock-head">
            <h2>Comments &amp; mentions</h2>
            <button type="button" className={`hd-unread ${unseen.count ? 'has-unseen' : ''}`} onClick={onUnseen}
              aria-label={unseen.count ? `Inbox: ${unseen.count} unread across all updates — open inbox` : 'Inbox: all caught up — open inbox'} title={unseen.latest ? `Latest in your inbox: ${unseen.latest}` : 'Open inbox'}>
              {unseen.count ? <>Inbox · <b>{unseen.count > 99 ? '99+' : unseen.count}</b> unread</> : 'Inbox · caught up'}<Chevron />
            </button>
          </header>
          <div className="dock-scroll">
            {collab.length === 0
              ? <p className="hd-quiet">No comments or mentions on your work yet. Comments on tasks you’re part of and @mentions of you land here.</p>
              : <ul className="hd-list hd-feed">
                  {collab.map(item => (
                    <li key={item.id}>
                      <button type="button" className={`hd-act ${item.unread ? 'is-unread' : ''} ${item.taskId && !item.channelId && item.taskId === threadId ? 'is-picked' : ''}`}
                        onClick={() => (item.channelId ? onOpenMention(item) : item.taskId && setPicked(item.taskId))}>
                        <Initial state={state} id={item.from} />
                        <span className="t"><b>{firstName(state, item.from, 'Someone')}</b> {COLLAB_VERB[item.kind]} <span className="q">{item.context.replace(/^Mentioned you in /, '')}</span><small>{item.text}</small></span>
                        <time dateTime={new Date(item.at).toISOString()}>{ago(item.at, now)}</time>
                      </button>
                    </li>
                  ))}
                </ul>}
          </div>
        </div>

        <div className="dock-col dock-thread">
          <header className="dock-head">
            <h2>{thread ? thread.title : 'Conversation'}</h2>
            {thread && <button type="button" className="hd-more" onClick={() => onOpen(thread.id)}>Open task<Chevron /></button>}
          </header>
          {thread
            ? <>
                <div className="dock-scroll"><EventFeed events={comments} empty="No comments on this task yet." /></div>
                <div className="dock-reply">
                  {canReply(quest)
                    ? <CommentReply quest={quest} taskId={thread.id} label={`Reply on ${thread.title}`} placeholder="Write a reply. Use @ to mention someone." send="Reply" />
                    : <p className="hd-quiet">Reviewer view: no replies.</p>}
                </div>
              </>
            : <div className="dock-scroll"><p className="hd-quiet">Pick a task comment to read its thread and reply here. Channel mentions open in the inbox.</p></div>}
        </div>

        <div className="dock-col">
          <header className="dock-head">
            <h2>Team activity</h2>
            <button type="button" className="hd-more" onClick={onActivity}>View all<Chevron /></button>
          </header>
          <div className="dock-scroll">
            {activity.length === 0
              ? <p className="hd-quiet">No activity yet. Task changes, handoffs and comments appear here as they happen.</p>
              : <ul className="hd-list hd-feed">{activity.map(event => <li key={event.id}><Recent event={event} quest={quest} onOpen={onOpen} /></li>)}</ul>}
          </div>
        </div>
      </div>
    </section>
  );
}
