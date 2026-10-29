// Bottom communications dock for Home: the vertical counterpart of the left calendar and right
// context panels. Collapsed it is a slim rail with live counts; expanded it opens upward and the
// shell gives it height taken from the center (no overlay).
// Left: the lists — Inbox (the same universal inbox and read state as the bell and the Inbox page),
// Conversations (channels), Comments & mentions, Activity, and a reserved Agents slot.
// Right: the reader — a channel thread with its composer (ChannelThread, demo channels only until a
// messaging backend exists) or a task's comment thread with its `task/comment` reply (live).
// Nothing here keeps its own copy of inbox or messaging state.
// Height: four snap positions (src/ui/dock-size.ts). The top-edge handle drags it like a window edge and
// snaps on release; arrow keys step between positions. The shell gives the dock's height to the center.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DOCK_RAIL, DOCK_SNAP_LABELS, clampDock, nearestSnap, snapHeights, stepSnap } from '../ui/dock-size.ts';
import type { DockSnap } from '../ui/dock-size.ts';
import { collaboration, teamActivity, ago } from '../core/dashboard.ts';
import type { MentionSource } from '../core/dashboard.ts';
import { channelsFor } from '../core/inbox.ts';
import type { InboxItem, UniversalInbox } from '../core/inbox.ts';
import { firstName, nameOf, projectName, taskById } from '../core/selectors.ts';
import { STATUS_LABELS } from '../core/contract.ts';
import { responsibility } from '../core/responsibility.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';
import { COLLAB_VERB, Chevron, Initial, Recent } from './Home.tsx';
import { ChannelThread } from './Inbox.tsx';
import type { InboxData } from './Inbox.tsx';
import { CommentReply, EventFeed, canReply, isComment, taskEvents } from './TaskComments.tsx';

export type DockTab = 'inbox' | 'conversations' | 'mentions' | 'activity';
type Reading = { kind: 'task'; id: string } | { kind: 'channel'; id: string } | { kind: 'item'; item: InboxItem } | { kind: 'compose' } | null;

const TABS: { id: DockTab; label: string; short?: string }[] = [
  { id: 'inbox', label: 'Inbox' }, { id: 'conversations', label: 'Conversations', short: 'Channels' }, { id: 'mentions', label: 'Comments & mentions', short: 'Mentions' }, { id: 'activity', label: 'Activity' },
];

export function CollabDock({ quest, company, snap, onSnap, onToggle, tab, onTab, inbox, data, read, markRead, mentions, onOpen, onOpenLead, onActivity, onOpenInboxPage, onFocusTask }: {
  quest: Quest; company: boolean;
  /** The saved snap position; the toggle collapses it or restores the last open position. */
  snap: DockSnap; onSnap: (snap: DockSnap) => void; onToggle: () => void;
  tab: DockTab; onTab: (tab: DockTab) => void;
  /** The universal inbox and its read state, shared with the bell and the Inbox page. */
  inbox: UniversalInbox; data: InboxData; read: Set<string>; markRead: (ids: string[]) => void;
  /** Channel @mentions from the universal inbox. */
  mentions: MentionSource[];
  onOpen: (id: string) => void; onOpenLead: (id: string) => void; onActivity: () => void; onOpenInboxPage: () => void;
  /** Picking a task thread (inbox item, comment or mention) focuses its project in the overview's Living view. */
  onFocusTask?: (taskId: string) => void;
}) {
  const { state, actor, now } = quest;
  const collab = useMemo(() => collaboration(state, actor, company, mentions, read, 20), [state, actor, company, mentions, read]);
  const activity = useMemo(() => teamActivity(state, actor, company, 20), [state, actor, company]);
  const channels = data.messaging ? channelsFor(data.messaging, actor) : [];
  const postable = channels.filter(channel => channel.members.includes(actor));
  const unreadIn = (id: string) => inbox.items.filter(item => item.channelId === id && !read.has(item.id)).length;
  const people = [...new Set(collab.map(item => item.from))].slice(0, 3);

  // The reader: what was picked, else the newest task conversation, else the task with the latest activity.
  const [picked, setPickedState] = useState<Reading>(null);
  // Compact (collapsed/default height, between the side panels): one view at a time, the list or the reader.
  const [pane, setPane] = useState<'list' | 'reader'>('list');
  const setPicked = (next: Reading) => { setPickedState(next); setPane('reader'); if (next?.kind === 'task') onFocusTask?.(next.id); };
  const fallback = collab.find(item => item.taskId && !item.channelId)?.taskId ?? activity.find(event => event.taskId && taskById(state, event.taskId))?.taskId;
  const reading: Reading = picked && !(picked.kind === 'task' && !taskById(state, picked.id)) && !(picked.kind === 'channel' && !channels.some(item => item.id === picked.id))
    ? picked : fallback ? { kind: 'task', id: fallback } : null;

  // Reading a channel reads its inbox items, as on the Inbox page.
  const channelId = reading?.kind === 'channel' ? reading.id : null;
  const shown = snap !== 'collapsed';
  useEffect(() => {
    if (!channelId || !shown) return;
    const ids = inbox.items.filter(item => item.channelId === channelId && !read.has(item.id)).map(item => item.id);
    if (ids.length) markRead(ids);
  }, [channelId, shown, inbox.items, read, markRead]);

  function openItem(item: InboxItem) {
    markRead([item.id]);
    if (item.channelId) setPicked({ kind: 'channel', id: item.channelId });
    else if (item.taskId) setPicked({ kind: 'task', id: item.taskId });
    else if (item.leadId) onOpenLead(item.leadId);
    else setPicked({ kind: 'item', item });
  }
  const isReading = (kind: 'task' | 'channel', id?: string) => !!id && reading?.kind === kind && reading.id === id;

  // ── Size ──
  const dock = useRef<HTMLElement>(null);
  const measure = () => {
    const node = dock.current, content = node?.parentElement?.querySelector<HTMLElement>(':scope > .content');
    return content ? Math.max(DOCK_RAIL + 120, window.innerHeight - content.getBoundingClientRect().top) : window.innerHeight - 120;
  };
  const [avail, setAvail] = useState(() => window.innerHeight - 120);
  useLayoutEffect(() => {
    const update = () => setAvail(measure());
    update();
    window.addEventListener('resize', update);
    // Bars above the center (a saved-change notice, the demo banner) move its top edge: keep the snaps honest.
    const content = dock.current?.parentElement?.querySelector<HTMLElement>(':scope > .content');
    const observer = content ? new ResizeObserver(update) : null;
    if (content) observer!.observe(content);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, []);
  const heights = snapHeights(avail);
  const [drag, setDrag] = useState<{ startY: number; startH: number; height: number; moved: boolean } | null>(null);
  const height = drag ? drag.height : heights[snap];
  const open = snap !== 'collapsed' || (!!drag && drag.height > DOCK_RAIL + 8);
  // The shell lays the side panels out above the dock (they end at --dock-h) and hides the center at full height.
  const full = height >= heights.full - 2;
  const tall = height >= heights.half - 2;
  // Width follows height: up to the default snap the dock sits in the center column between full-height side
  // panels; above it the dock spans the app and the panels end at its edge. Derived, never stored.
  const wide = height > heights.default + 8;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--dock-h', `${Math.round(height)}px`);
    root.toggleAttribute('data-dock-full', full);
    root.toggleAttribute('data-dock-tall', tall);
    root.toggleAttribute('data-dock-wide', wide);
  }, [height, full, tall, wide]);
  useLayoutEffect(() => () => { const root = document.documentElement; root.style.removeProperty('--dock-h'); for (const name of ['data-dock-full', 'data-dock-tall', 'data-dock-wide']) root.removeAttribute(name); }, []);
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const fresh = measure(); setAvail(fresh);
    setDrag({ startY: event.clientY, startH: snapHeights(fresh)[snap], height: snapHeights(fresh)[snap], moved: false });
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    setDrag({ ...drag, height: clampDock(drag.startH + delta, avail), moved: drag.moved || Math.abs(delta) > 3 });
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) onSnap(nearestSnap(drag.height, avail));
    setDrag(null);
  }
  function stepKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const to = event.key === 'ArrowUp' || event.key === 'PageUp' ? stepSnap(snap, 1) : event.key === 'ArrowDown' || event.key === 'PageDown' ? stepSnap(snap, -1)
      : event.key === 'Home' ? 'collapsed' : event.key === 'End' ? 'expanded' : null;
    if (!to) return;
    event.preventDefault();
    onSnap(to);
  }

  const toggleLabel = open ? 'Collapse the communications panel' : 'Expand the communications panel';
  return (
    <section ref={dock} id="collab-dock" className={`collab-dock ${open ? 'is-open' : ''} ${drag ? 'is-dragging' : ''} ${wide ? 'is-wide' : 'is-compact'}`} data-pane={pane} style={{ height }} aria-label="Communications">
      <div className="dock-handle" role="separator" aria-orientation="horizontal" tabIndex={0} aria-controls="collab-dock"
        aria-label="Resize the communications panel" aria-valuemin={DOCK_RAIL} aria-valuemax={heights.expanded} aria-valuenow={Math.round(height)}
        aria-valuetext={drag ? `${Math.round(height)} pixels` : `${DOCK_SNAP_LABELS[snap]} height`} title="Drag to resize · ↑ ↓ to step"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={stepKey}>
        <span className="dock-grip" aria-hidden="true" />
      </div>
      <button type="button" className="dock-toggle" aria-controls="collab-dock-body" aria-expanded={open} aria-label={toggleLabel} title={open ? 'Collapse' : 'Inbox, conversations & activity'} onClick={onToggle}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={open ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} /></svg>
      </button>

      <div className="dock-rail">
        <button type="button" className="dock-rail-main" aria-controls="collab-dock-body" aria-expanded={open} onClick={onToggle}>
          <span className={`dock-mark ${inbox.unread ? 'is-live' : ''}`} aria-hidden="true">
            <svg className="icon" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></svg>
          </span>
          <span className="dock-label">Inbox &amp; collaboration</span>
          <span className="dock-sep" aria-hidden="true" />
          <span className={`dock-count ${inbox.unread ? 'is-hot' : ''}`}>{inbox.unread ? `${inbox.unread > 99 ? '99+' : inbox.unread} unread` : 'All caught up'}</span>
          {activity[0] && <span className="dock-latest">Latest · {ago(activity[0].at, now)}</span>}
        </button>
        {people.length > 0 && <span className="dock-faces" aria-hidden="true">{people.map(id => <Initial key={id} state={state} id={id} />)}</span>}
      </div>

      <div id="collab-dock-body" className="dock-body" inert={!open}>
        <div className="dock-col dock-lists">
          <div className="dock-tabs" role="tablist" aria-label="Communications">
            {TABS.map(item => {
              const count = item.id === 'inbox' ? inbox.unread : item.id === 'conversations' ? channels.reduce((sum, channel) => sum + unreadIn(channel.id), 0) : item.id === 'mentions' ? collab.filter(entry => entry.unread).length : 0;
              return <button key={item.id} type="button" role="tab" id={`dock-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="dock-list" className={tab === item.id ? 'is-active' : ''} onClick={() => onTab(item.id)}>
                {item.short ? <><span className="dock-tab-full">{item.label}</span><span className="dock-tab-short">{item.short}</span></> : item.label}{count > 0 && <span className="dock-tab-count">{count > 99 ? '99+' : count}</span>}
              </button>;
            })}
            <button type="button" role="tab" aria-selected={false} aria-disabled="true" className="is-soon" title="Agent conversations aren’t connected yet">Agents<span className="dock-soon">Soon</span></button>
          </div>

          <div id="dock-list" className="dock-scroll" role="tabpanel" aria-labelledby={`dock-tab-${tab}`}>
            {tab === 'inbox' && <>
              <div className="dock-list-head">
                <span><b>{inbox.unread}</b> unread · {inbox.items.length} total</span>
                <span>
                  <button type="button" className="link" disabled={!inbox.unread} onClick={() => markRead(inbox.items.map(item => item.id))}>Mark all read</button>
                  <button type="button" className="link" onClick={onOpenInboxPage}>Inbox page</button>
                </span>
              </div>
              {inbox.items.length === 0 ? <p className="hd-quiet">Nothing is addressed to you.</p> : <ul className="dock-items">
                {inbox.items.map(item => {
                  const unread = !read.has(item.id);
                  const on = (item.channelId && isReading('channel', item.channelId)) || (!item.channelId && isReading('task', item.taskId));
                  return <li key={item.id}><button type="button" className={`dock-item ${unread ? 'is-unread' : ''} ${on ? 'is-picked' : ''}`} onClick={() => openItem(item)}>
                    <span className="dock-item-kind">{unread && <i className="dock-dot" aria-label="Unread" />}<b>{item.kind === 'mention' ? 'Mention' : item.kind === 'message' ? 'Message' : 'Task'}</b><em>{item.workspace.name}</em><time>{ago(item.at, now)}</time></span>
                    <strong>{item.title}</strong>
                    <small>{item.from ? `${firstName(state, item.from) || data.messaging?.people.find(person => person.id === item.from)?.name || item.from}: ` : ''}{item.detail}</small>
                  </button></li>;
                })}
              </ul>}
            </>}

            {tab === 'conversations' && <>
              <div className="dock-list-head">
                <span>{channels.length ? `${channels.length} channel${channels.length === 1 ? '' : 's'}` : 'Channels'}</span>
                {postable.length > 0 && <button type="button" className="dock-new" onClick={() => setPicked({ kind: 'compose' })}>
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New message</button>}
              </div>
              {channels.length === 0 ? <p className="hd-quiet">Channels aren’t set up for this workspace yet. Task comments and replies work in Comments &amp; mentions.</p> : <ul className="dock-items">
                {channels.map(channel => {
                  const unread = unreadIn(channel.id);
                  return <li key={channel.id}><button type="button" className={`dock-item is-channel ${unread ? 'is-unread' : ''} ${isReading('channel', channel.id) ? 'is-picked' : ''}`} onClick={() => setPicked({ kind: 'channel', id: channel.id })}>
                    <span className="dock-item-kind"><b># {channel.name}</b><em>{data.messaging?.workspaces.find(ws => ws.id === channel.workspaceId)?.name}</em>{unread > 0 && <span className="dock-tab-count">{unread}</span>}</span>
                    <small>{channel.purpose}</small>
                  </button></li>;
                })}
              </ul>}
            </>}

            {tab === 'mentions' && (collab.length === 0
              ? <p className="hd-quiet">No comments or mentions on your work yet. Comments on tasks you’re part of and @mentions of you land here.</p>
              : <ul className="hd-list hd-feed">
                  {collab.map(item => (
                    <li key={item.id}>
                      <button type="button" className={`hd-act ${item.unread ? 'is-unread' : ''} ${(item.channelId ? isReading('channel', item.channelId) : isReading('task', item.taskId)) ? 'is-picked' : ''}`}
                        onClick={() => { if (item.unread) markRead([item.id]); if (item.channelId) setPicked({ kind: 'channel', id: item.channelId }); else if (item.taskId) setPicked({ kind: 'task', id: item.taskId }); }}>
                        <Initial state={state} id={item.from} />
                        <span className="t"><b>{firstName(state, item.from, 'Someone')}</b> {COLLAB_VERB[item.kind]} <span className="q">{item.context.replace(/^Mentioned you in /, '')}</span><small>{item.text}</small></span>
                        <time dateTime={new Date(item.at).toISOString()}>{ago(item.at, now)}</time>
                      </button>
                    </li>
                  ))}
                </ul>)}

            {tab === 'activity' && <>
              <div className="dock-list-head"><span>Recent · {company ? 'all work you can see' : 'your work'}</span><button type="button" className="link" onClick={onActivity}>Full history</button></div>
              {activity.length === 0
                ? <p className="hd-quiet">No activity yet. Task changes, handoffs and comments appear here as they happen.</p>
                : <ul className="hd-list hd-feed">{activity.map(event => <li key={event.id}><Recent event={event} quest={quest} onOpen={onOpen} /></li>)}</ul>}
            </>}
          </div>
        </div>

        <div className="dock-col dock-reader" aria-live="polite">
          {!wide && <button type="button" className="dock-back" onClick={() => setPane('list')}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Back to {TABS.find(item => item.id === tab)?.label ?? 'list'}
          </button>}
          <Reader quest={quest} reading={reading} data={data} postable={postable} onPick={setPicked} onOpen={onOpen} onOpenInboxPage={onOpenInboxPage} />
        </div>
      </div>
    </section>
  );
}

function Reader({ quest, reading, data, postable, onPick, onOpen, onOpenInboxPage }: {
  quest: Quest; reading: Reading; data: InboxData; postable: ReturnType<typeof channelsFor>;
  onPick: (reading: Reading) => void; onOpen: (id: string) => void; onOpenInboxPage: () => void;
}) {
  const { state } = quest;
  if (reading?.kind === 'channel' && data.messaging && data.store) {
    return <div className="dock-channel"><ChannelThread key={reading.id} quest={quest} messaging={data.messaging} store={data.store} channelId={reading.id} current={data.current} onOpenTask={onOpen} /></div>;
  }
  if (reading?.kind === 'compose') {
    return <>
      <header className="dock-head"><h2>New message</h2></header>
      <div className="dock-scroll">
        <p className="dock-note">Choose a channel to write in. Use @name to mention someone.</p>
        <ul className="dock-items">{postable.map(channel => <li key={channel.id}><button type="button" className="dock-item is-channel" onClick={() => onPick({ kind: 'channel', id: channel.id })}>
          <span className="dock-item-kind"><b># {channel.name}</b><em>{data.messaging?.workspaces.find(ws => ws.id === channel.workspaceId)?.name}</em></span><small>{channel.purpose}</small>
        </button></li>)}</ul>
      </div>
    </>;
  }
  if (reading?.kind === 'item') {
    return <>
      <header className="dock-head"><h2>{reading.item.title}</h2><button type="button" className="hd-more" onClick={onOpenInboxPage}>Inbox page<Chevron /></button></header>
      <div className="dock-scroll"><p className="dock-note">{reading.item.detail}</p></div>
    </>;
  }
  const task = reading?.kind === 'task' ? taskById(state, reading.id) : undefined;
  if (!task) return <>
    <header className="dock-head"><h2>Conversation</h2></header>
    <div className="dock-scroll"><p className="hd-quiet">Pick an inbox item, a channel or a task comment to read the thread and reply here.</p></div>
  </>;
  const comments = taskEvents(state.events, task.id).filter(isComment);
  const who = responsibility(state, task);
  const today = localDate(quest.now);
  return <div className="dock-task">
    <div className="dock-task-thread">
      <header className="dock-head"><h2>{task.title}</h2><button type="button" className="hd-more" onClick={() => onOpen(task.id)}>Open task<Chevron /></button></header>
      <div className="dock-scroll"><EventFeed events={comments} empty="No comments on this task yet." /></div>
      <div className="dock-reply">
        {canReply(quest)
          ? <CommentReply quest={quest} taskId={task.id} label={`Reply on ${task.title}`} placeholder="Write a reply. Use @ to mention someone." send="Reply" />
          : <p className="hd-quiet">Reviewer view: no replies.</p>}
      </div>
    </div>
    {/* Task context beside the thread (shown where the dock is wide enough). */}
    <aside className="dock-task-context" aria-label="Task details">
      <dl>
        <div><dt>Status</dt><dd><span className={`pill pill-${task.status}`}>{STATUS_LABELS[task.status]}</span></dd></div>
        <div><dt>Owner</dt><dd>{task.owner ? nameOf(state, task.owner) : 'Unassigned'}</dd></div>
        <div><dt>Due</dt><dd className={task.due && task.due < today && task.status !== 'done' ? 'is-late' : ''}>{task.due ? shortDate(task.due, today) : 'No date'}{task.dueTime ? ` · ${task.dueTime}` : ''}</dd></div>
        <div><dt>Priority</dt><dd>{task.ultra ? 'Ultra' : task.priority ? task.priority[0]!.toUpperCase() + task.priority.slice(1) : 'Normal'}</dd></div>
        {task.projectId && <div><dt>Project</dt><dd>{projectName(state, task.projectId)}</dd></div>}
        {who && <div><dt>Acts next</dt><dd>{who.actor ? nameOf(state, who.actor) : 'Nobody yet'}</dd></div>}
      </dl>
      {who && <p className="dock-task-next"><b>What to do</b>{who.action}</p>}
    </aside>
  </div>;
}
