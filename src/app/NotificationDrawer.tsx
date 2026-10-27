// Notifications, in a drawer on the right (where the bell is). It holds the same Inbox, Attention
// and Activity lists as before. Selecting a task notification from the Inbox opens that task's
// existing conversation here (context, comments with @mentions, and an inline reply) without
// leaving the page underneath, so scroll position and everything else stay put.
import { useState } from 'react';
import { EdgeDrawer } from '../ui/EdgeDrawer.tsx';
import { ChannelThread } from './Inbox.tsx';
import type { InboxData } from './Inbox.tsx';
import { channelsFor } from '../core/inbox.ts';
import type { InboxItem } from '../core/inbox.ts';
import { LeadCard } from './SpeedToLead.tsx';
import type { Attention } from '../core/awareness.ts';
import type { UniversalInbox } from '../core/inbox.ts';
import { responsibility } from '../core/responsibility.ts';
import { nameOf, taskById } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { Awareness } from './Awareness.tsx';
import type { SidebarControl } from './Sidebar.tsx';
import { CommentReply, EventFeed, canReply, isComment, taskEvents } from './TaskComments.tsx';

export function NotificationDrawer({ quest, control, inbox, attention, data, detailsAllowed = true, open: visible, threadAllowed, onClose, onOpenTask, onOpenLead, onOpenInbox, onOpenAttention, onOpenActivity }: {
  quest: Quest; control: SidebarControl; inbox: UniversalInbox; attention: Attention; data?: InboxData; detailsAllowed?: boolean; open: boolean;
  /** False for a task outside the person's Critical Focus: its thread is not shown. */
  threadAllowed: (taskId: string) => boolean;
  onClose: () => void; onOpenTask: (id: string) => void; onOpenLead: (id: string) => void; onOpenInbox: () => void; onOpenAttention: () => void; onOpenActivity: () => void;
}) {
  const [thread, setThread] = useState<string | null>(null);
  const [item, setItem] = useState<InboxItem | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const sheet = { ...control, afterNavigate: () => {} } as SidebarControl;
  const back = () => { setThread(null); setItem(null); setLeadId(null); };
  const selectTask = (id: string) => { back(); setThread(id); };
  const selectLead = (id: string) => { back(); setLeadId(id); };
  const lead = quest.state.leads.find(entry => entry.id === leadId);
  const channel = item?.channelId && data?.messaging
    ? channelsFor(data.messaging, quest.actor).find(entry => entry.id === item.channelId) : null;

  return (
    <EdgeDrawer id="notifications-edge-drawer" open={visible} label="Notifications" className="context context-signals notify-drawer is-drawer" onClose={onClose}>
      {(item || leadId) ? <>
        <header className="context-head"><button type="button" className="btn btn-ghost" onClick={back}>Back to notifications</button><button type="button" className="icon-btn" aria-label="Close notifications" onClick={onClose}>×</button></header>
        <div className="context-body">
          {!detailsAllowed ? <p role="alert">This detail is outside your Critical Focus. Request access first.</p> : leadId ? lead ? <LeadCard quest={quest} lead={lead} onOpen={selectTask} /> : <p>This lead no longer exists.</p>
            : channel && data?.messaging && data.store ? <ChannelThread quest={quest} messaging={data.messaging} store={data.store} channelId={channel.id} current={data.current} onOpenTask={selectTask} />
            : <><h2>{item?.title}</h2><p>{item?.detail}</p><p className="muted">Conversation unavailable in this workspace.</p></>}
        </div>
      </> :
      thread
        ? <Thread quest={quest} taskId={thread} allowed={threadAllowed(thread)} onBack={() => setThread(null)} onClose={onClose} onOpenTask={id => { onOpenTask(id); onClose(); }} />
        : <>
            <header className="context-head"><span className="context-label">Notifications</span><button type="button" className="icon-btn" aria-label="Close notifications" onClick={onClose}>×</button></header>
            <div className="context-body notify-body">
              <Awareness quest={quest} control={sheet} inbox={inbox} attention={attention}
                onOpenTask={selectTask} onOpenThread={selectTask} onOpenLead={selectLead}
                onOpenItem={entry => { if (entry.channelId) { back(); setItem(entry); } else if (entry.taskId) selectTask(entry.taskId); else if (entry.leadId) selectLead(entry.leadId); else { back(); setItem(entry); } }}
                onOpenInbox={() => { onOpenInbox(); onClose(); }} onOpenAttention={() => { onOpenAttention(); onClose(); }} onOpenActivity={() => { onOpenActivity(); onClose(); }} />
            </div>
          </>}
    </EdgeDrawer>
  );
}

export function Thread({ quest, taskId, allowed, onBack, onClose, onOpenTask }: { quest: Quest; taskId: string; allowed: boolean; onBack: () => void; onClose: () => void; onOpenTask: (id: string) => void }) {
  const { state } = quest;
  const task = taskById(state, taskId);
  const who = task ? responsibility(state, task) : null;
  const comments = task ? taskEvents(state.events, task.id).filter(isComment) : [];
  return (
    <>
      <header className="context-head thread-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>Back to notifications
        </button>
        {task && allowed && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenTask(task.id)}>Open task</button>}
        <button type="button" className="icon-btn" aria-label="Close notifications" onClick={onClose}>×</button>
      </header>
      {!task && <div className="context-body"><p className="muted">This task no longer exists.</p></div>}
      {task && !allowed && <div className="context-body"><p className="locked-note" role="alert">“{task.title}” is outside your Critical Focus, so its conversation isn’t available. Request access first.</p></div>}
      {task && allowed && who && (
        <>
          <div className="context-body thread-body">
            <section className="thread-context" aria-label="Task context">
              <h2>{task.title}</h2>
              <p className="muted">{who.stateLabel}{task.owner ? ` · ${nameOf(state, task.owner)}` : ' · Unassigned'}</p>
              <p><b>Who acts next:</b> {who.actor ? nameOf(state, who.actor) : 'Nobody yet'}{who.actorNote ? ` (${who.actorNote})` : ''}</p>
              <p><b>What to do:</b> {who.action}</p>
            </section>
            <section aria-label="Comments">
              <h3 className="ctx-label">Comments <span>{comments.length}</span></h3>
              <EventFeed events={comments} empty="No comments yet." />
            </section>
          </div>
          <div className="thread-reply">
            {canReply(quest)
              ? <CommentReply quest={quest} taskId={task.id} label="Reply to this task" placeholder="Write a reply. Use @ to mention someone." send="Reply" />
              : <p className="muted">Reviewer view: no replies.</p>}
          </div>
        </>
      )}
    </>
  );
}
