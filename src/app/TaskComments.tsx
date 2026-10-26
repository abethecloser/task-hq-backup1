// The comment thread of one task, shared by the task page and the notifications drawer so both
// show and save the same thing. Replies go through the same engine action as before
// (`task/comment`), so the server's checks and the task's history are unchanged.
import { useState } from 'react';
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

export function CommentReply({ quest, taskId, onSent, label = 'Task comment', placeholder = 'Write a comment. Use @ to mention someone.', send = 'Comment' }: {
  quest: Quest; taskId: string; onSent?: () => void; label?: string; placeholder?: string; send?: string;
}) {
  const [comment, setComment] = useState('');
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
