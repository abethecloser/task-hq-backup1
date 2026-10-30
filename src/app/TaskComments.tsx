// The comment thread of one task, shared by the task page, the collaboration dock and the
// notifications drawer so all of them show and save the same thing. Replies go through the same
// engine action as before (`task/comment`), so the server's checks and the task's history are
// unchanged. Unsent drafts are kept per task for the session, so switching tasks, collapsing the
// dock or moving between the page and the dock never loses or mixes them.
import { useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import type { QuestEvent } from '../core/contract.ts';
import { ReferenceTextarea, ReferencedText } from '../ui/ReferenceEditor.tsx';
import type { Quest } from '../ui/useQuest.ts';

export const isComment = (event: QuestEvent) => / commented: /.test(event.text);
const when = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Events of a task in the order the workspace keeps them. */
export const taskEvents = (events: QuestEvent[], taskId: string) => events.filter(event => event.taskId === taskId);

export function EventFeed({ events, empty }: { events: QuestEvent[]; empty: string }) {
  if (events.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ol className="ctx-history tp-feed">{events.slice(0, 60).map(event => (
      <li key={event.id} className={event.undone ? 'is-undone' : ''}><time>{when(event.at)}</time><p><ReferencedText text={event.text} document={event.references?.text} /></p></li>
    ))}</ol>
  );
}

/** Reviewers read only; everyone else replies, subject to the same checks as on the task page. */
export function canReply(quest: Quest) {
  return quest.state.people.find(item => item.id === quest.actor)?.role !== 'reviewer';
}

// ── Drafts: one per task, shared by every composer of that task, kept for this browser session ──
const DRAFT_KEY = 'quest-comment-drafts';
const drafts = new Map<string, string>(readDrafts());
const listeners = new Set<() => void>();
function readDrafts(): [string, string][] { try { return Object.entries(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string>); } catch { return []; } }
function setDraft(taskId: string, text: string) {
  if (text) drafts.set(taskId, text); else drafts.delete(taskId);
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(drafts))); } catch { /* storage unavailable */ }
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** The unsent comment for a task, shared live between the page and the dock. */
export function useDraft(taskId: string): [string, (text: string) => void] {
  const text = useSyncExternalStore(subscribe, () => drafts.get(taskId) ?? '', () => '');
  return [text, next => setDraft(taskId, next)];
}

export function CommentReply({ quest, taskId, onSent, label = 'Task comment', placeholder = 'Write a comment. Use @ to mention someone.', send = 'Comment' }: {
  quest: Quest; taskId: string; onSent?: () => void; label?: string; placeholder?: string; send?: string;
}) {
  const [comment, setComment] = useDraft(taskId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim() || busy) return;
    setBusy(true);
    const result = await quest.dispatch({ type: 'task/comment', id: taskId, note: comment });
    setBusy(false);
    if (result.ok) { setComment(''); setError(''); onSent?.(); } else setError((result as { error?: string }).error || 'That comment could not be saved.');
  }
  return (
    <form className="task-comment-form" onSubmit={event => void submit(event)}>
      <ReferenceTextarea rows={2} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} aria-label={label} placeholder={placeholder} />
      <button className="btn btn-primary btn-sm" disabled={!comment.trim() || busy}>{send}</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  );
}

type ConversationTab = 'comments' | 'activity' | 'history';

/** One task's conversation: Comments (people writing), Activity (everything that happened, comments
 * included) and History (recorded changes, comments left out). All three read the same retained task
 * events; nothing new is stored. Used on the task page and in the dock. */
export function TaskConversation({ quest, taskId, compact = false }: { quest: Quest; taskId: string; compact?: boolean }) {
  const [tab, setTab] = useState<ConversationTab>('comments');
  const events = taskEvents(quest.state.events, taskId);
  const comments = events.filter(isComment);
  const history = events.filter(event => !isComment(event));
  const feed = tab === 'comments' ? comments : tab === 'history' ? history : events;
  const tabs: [ConversationTab, string, number][] = [['comments', 'Comments', comments.length], ['activity', 'Activity', events.length], ['history', 'History', history.length]];
  const id = `conv-${compact ? 'dock' : 'page'}-${taskId}`;
  return (
    <div className={`task-conversation ${compact ? 'is-compact' : ''}`}>
      <div className="tp-tabs" role="tablist" aria-label="Comments, activity and history" onKeyDown={event => {
        const index = tabs.findIndex(([key]) => key === tab);
        const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
        if (next !== null) { event.preventDefault(); setTab(tabs[next]![0]); (event.currentTarget.children[next] as HTMLButtonElement).focus(); }
      }}>
        {tabs.map(([key, label, count]) => <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} onClick={() => setTab(key)}>{label} <span>{count}</span></button>)}
      </div>
      {tab === 'comments' && canReply(quest) && <CommentReply quest={quest} taskId={taskId} />}
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="task-conversation-feed">
        <EventFeed events={feed} empty={tab === 'comments' ? 'No comments yet. Start the conversation.' : tab === 'history' ? 'No recorded changes yet.' : 'No activity yet.'} />
      </div>
    </div>
  );
}
