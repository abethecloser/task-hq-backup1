import { useState } from 'react';
import { attentionTotals, groupAttention } from '../core/attention-groups.ts';
import { insights } from '../core/rules.ts';
import { Empty, InsightCard } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { FocusControl } from './UltraFocus.tsx';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function NeedsAttention({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, now } = quest;
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const all = insights(state, now);
  const shown = scope === 'mine' ? all.filter(item => item.who === actor) : all;
  const groups = groupAttention(state, shown);
  const totals = attentionTotals(groups);
  const mine = all.filter(item => item.who === actor).length;

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Rule-based guidance · no AI required</p>
          <h1>Needs Attention</h1>
          <p className="lede">Each task appears once, with every condition that needs attention. One task can have several conditions, and each one says who acts next.</p>
        </div>
        <div className="seg" role="group" aria-label="Whose items">
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Everyone <span>{plural(all.length, 'condition')}</span></button>
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>For me <span>{plural(mine, 'condition')}</span></button>
        </div>
      </header>
      <FocusControl quest={quest} onOpen={onOpen} />
      {shown.length > 0 && (
        <p className="attn-summary" role="status">
          <b>{plural(totals.tasks, 'task')}</b>
          {totals.leads > 0 && <> · {plural(totals.leads, 'lead')}</>}
          {totals.other > 0 && <> · {plural(totals.other, 'other item')}</>}
          {' '}· <b>{plural(totals.conditions, 'condition')}</b> in total
        </p>
      )}
      {shown.length === 0 ? <Empty title="Nothing needs attention">When work stalls, blocks, or waits on someone, it shows up here.</Empty> : groups.map(group => (
        <section key={group.key} className={`group attn-group sev-${group.severity}`} aria-label={`${group.title}, ${plural(group.conditions.length, 'condition')}`}>
          <h3 className="group-title">
            {group.taskId
              ? <button type="button" className="link attn-title" onClick={() => onOpen(group.taskId!)}>{group.title}</button>
              : <span className="attn-title">{group.title}</span>}
            {group.context && <small className="attn-context">{group.context}</small>}
            <span>{plural(group.conditions.length, 'condition')}</span>
          </h3>
          <div className="insights">{group.conditions.map(item => <InsightCard key={item.id} quest={quest} insight={item} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
}
