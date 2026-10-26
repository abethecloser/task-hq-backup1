// Notifications, in a drawer on the right (where the bell is). It holds the same Inbox, Attention
// and Activity lists as before. Selecting a task notification from the Inbox opens that task's
// existing conversation here (context, comments with @mentions, and an inline reply) without
// leaving the page underneath, so scroll position and everything else stay put.
import { useEffect, useRef, useState } from 'react';
import type { Attention } from '../core/awareness.ts';
import type { UniversalInbox } from '../core/inbox.ts';
import { responsibility } from '../core/responsibility.ts';
import { nameOf, taskById } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';
import { Awareness } from './Awareness.tsx';
import type { SidebarControl } from './Sidebar.tsx';
import { CommentReply, EventFeed, canReply, isComment, taskEvents } from './TaskComments.tsx';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

export function NotificationDrawer({ quest, control, inbox, attention, docked, threadAllowed, onClose, onOpenTask, onOpenLead, onOpenInbox, onOpenAttention, onOpenActivity }: {
  quest: Quest; control: SidebarControl; inbox: UniversalInbox; attention: Attention; docked: boolean;
  /** False for a task outside the person's Critical Focus: its thread is not shown. */
  threadAllowed: (taskId: string) => boolean;
  onClose: () => void; onOpenTask: (id: string) => void; onOpenLead: (id: string) => void; onOpenInbox: () => void; onOpenAttention: () => void; onOpenActivity: () => void;
}) {
  const [thread, setThread] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // As an overlay: take focus, keep it inside, hand it back on close.
  useEffect(() => {
    if (docked) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { returnFocus.current?.focus(); };
  }, [docked]);

  // On a phone the drawer fills the screen; follow the visible area so the reply box stays above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    const node = panel.current;
    if (!viewport || !node) return;
    const fit = () => node.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => { viewport.removeEventListener('resize', fit); viewport.removeEventListener('scroll', fit); };
  }, []);

  // The drawer stays open for navigation on desktop; on a phone it gets out of the way.
  const sheet = { ...control, afterNavigate: () => { if (control.isMobile || !docked) onClose(); } } as SidebarControl;
  const open = (fn: (id: string) => void) => (id: string) => { fn(id); sheet.afterNavigate(); };

  return (
    <aside ref={panel} className={`context context-signals notify-drawer ${docked ? 'is-docked' : 'is-drawer'}`} role={docked ? 'complementary' : 'dialog'} aria-modal={docked ? undefined : true} aria-label="Notifications"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (thread) setThread(null); else onClose(); }
        if (!docked && event.key === 'Tab') {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(el => el.getClientRects().length > 0);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      {thread
        ? <Thread quest={quest} taskId={thread} allowed={threadAllowed(thread)} onBack={() => setThread(null)} onClose={onClose} onOpenTask={id => { open(onOpenTask)(id); setThread(null); }} />
        : <>
            <header className="context-head"><span className="context-label">Notifications</span><button type="button" className="icon-btn" aria-label="Close notifications" onClick={onClose}>×</button></header>
            <div className="context-body notify-body">
              <Awareness quest={quest} control={sheet} inbox={inbox} attention={attention}
                onOpenTask={open(onOpenTask)} onOpenThread={setThread} onOpenLead={open(onOpenLead)}
                onOpenInbox={() => { onOpenInbox(); sheet.afterNavigate(); }} onOpenAttention={() => { onOpenAttention(); sheet.afterNavigate(); }} onOpenActivity={() => { onOpenActivity(); sheet.afterNavigate(); }} />
            </div>
          </>}
    </aside>
  );
}

function Thread({ quest, taskId, allowed, onBack, onClose, onOpenTask }: { quest: Quest; taskId: string; allowed: boolean; onBack: () => void; onClose: () => void; onOpenTask: (id: string) => void }) {
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
