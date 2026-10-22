// The prominent "who acts now" summary shared by the task page and the new-task preview.
import type { ReactNode } from 'react';
import type { QuestState } from '../core/contract.ts';
import { responsibility } from '../core/responsibility.ts';
import type { ResponsibilityInput } from '../core/responsibility.ts';
import { nameOf } from '../core/selectors.ts';
import { Avatar } from './components.tsx';

function Who({ state, id, you, empty }: { state: QuestState; id: string; you: string; empty: string }) {
  if (!id) return <span className="rc-who is-empty"><Avatar state={state} id="" size="sm" /><span>{empty}</span></span>;
  return <span className="rc-who"><Avatar state={state} id={id} size="sm" /><span>{id === you ? 'You' : nameOf(state, id, 'Former member')}</span></span>;
}

export function ResponsibilityCard({ state, task, actor, className = '', children }: { state: QuestState; task: ResponsibilityInput; actor: string; className?: string; children?: ReactNode }) {
  const r = responsibility(state, task);
  const mine = !!r.actor && r.actor === actor && r.tone !== 'done';
  return (
    <section className={`resp-card tone-${r.tone} ${mine ? 'is-mine' : ''} ${className}`.trim()} aria-label="Current action and handoff">
      <div className="rc-main">
        <span className="rc-state">{r.stateLabel}</span>
        <p className="rc-label">{r.tone === 'done' ? 'Status' : mine ? 'Your move' : 'Acts now'}</p>
        <Who state={state} id={r.actor} you={actor} empty={r.actorNote || 'Nobody yet'} />
        {r.actor && r.actorNote && <small className="rc-note">{r.actorNote}</small>}
        <p className="rc-action">{r.action}</p>
      </div>
      <div className="rc-side">
        <div><p className="rc-label">Next handoff</p><Who state={state} id={r.handoff.id} you={actor} empty="Not set" /><small className="rc-note">{r.handoff.text}</small></div>
        {r.approval && <div><p className="rc-label">Approval</p><Who state={state} id={r.approval.id} you={actor} empty="" /><small className="rc-note">{r.approval.text}</small></div>}
      </div>
      {children && <div className="rc-foot">{children}</div>}
    </section>
  );
}
