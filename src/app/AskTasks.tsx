import { useEffect, useRef, useState } from 'react';
import { answer, ASK_SUGGESTIONS } from '../core/ask.ts';
import { EdgeDrawer } from '../ui/EdgeDrawer.tsx';
import type { Quest } from '../ui/useQuest.ts';

interface Message { id: number; from: 'you' | 'tasks'; text: string }

/** Right-edge "Ask your tasks" panel. Read-only answers from ask.ts; nothing it says changes data. */
export function AskTasks({ quest, company, open = true, onClose, onUpdates }: { quest: Quest; company: boolean; open?: boolean; onClose: () => void; /** Switches the right panel to notifications. */ onUpdates?: () => void }) {
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
        {onUpdates ? <><h2 className="sr-only">Ask your tasks</h2><PanelSwitch current="ask" onUpdates={onUpdates} onAsk={() => {}} /></>
          : <><svg className="icon ask-spark" viewBox="0 0 24 24" aria-hidden="true"><path d={SPARK} /></svg><h2>Ask your tasks</h2></>}
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

/** The right edge holds what's addressed to you: updates and Ask share one panel. */
export function PanelSwitch({ current, onUpdates, onAsk }: { current: 'updates' | 'ask'; onUpdates: () => void; onAsk: () => void }) {
  return (
    <div className="panel-switch" role="group" aria-label="Right panel">
      <button type="button" aria-pressed={current === 'updates'} onClick={current === 'updates' ? undefined : onUpdates}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" /></svg>Updates
      </button>
      <button type="button" aria-pressed={current === 'ask'} onClick={current === 'ask' ? undefined : onAsk}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={SPARK} /></svg>Ask
      </button>
    </div>
  );
}
