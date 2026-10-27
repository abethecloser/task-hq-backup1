import { useEffect, useRef, useState } from 'react';
import { answer, ASK_SUGGESTIONS } from '../core/ask.ts';
import { EdgeDrawer } from '../ui/EdgeDrawer.tsx';
import type { Quest } from '../ui/useQuest.ts';

interface Message { id: number; from: 'you' | 'tasks'; text: string }

/** Right-edge "Ask your tasks" panel. Read-only answers from ask.ts; nothing it says changes data. */
export function AskTasks({ quest, company, open = true, onClose }: { quest: Quest; company: boolean; open?: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    const reply = answer(quest.state, quest.actor, quest.now, text, company);
    setMessages(current => [...current, { id: current.length, from: 'you', text }, { id: current.length + 1, from: 'tasks', text: reply }]);
    setDraft('');
  }

  return (
    <EdgeDrawer id="ask-edge-drawer" open={open} label="Ask your tasks" className="ask-panel" onClose={onClose}>
      <header className="ask-head">
        <svg className="icon ask-spark" viewBox="0 0 24 24" aria-hidden="true"><path d={SPARK} /></svg>
        <h2>Ask your tasks</h2>
        <button type="button" className="ask-icon-btn" aria-label="Close" onClick={onClose}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>
      <div className="ask-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <div className="ask-empty">
            <h3>Ask about your tasks</h3>
            <p>Answers come only from what you can see. I can't change anything.</p>
            <div className="ask-chips">{ASK_SUGGESTIONS.map(text => <button key={text} type="button" onClick={() => ask(text)}>{text}</button>)}</div>
          </div>
        )}
        {messages.map(message => <p key={message.id} className={`ask-msg from-${message.from}`}>{message.text}</p>)}
      </div>
      <form className="ask-foot" onSubmit={event => { event.preventDefault(); ask(draft); }}>
        <input ref={input} data-drawer-autofocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask a question…" aria-label="Ask a question" maxLength={300} />
        <button type="submit" className="ask-icon-btn ask-send" aria-label="Send" disabled={!draft.trim()}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg></button>
      </form>
    </EdgeDrawer>
  );
}

export const SPARK = 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
