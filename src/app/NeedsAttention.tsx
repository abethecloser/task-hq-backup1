import { useState } from 'react';
import type { InsightKind } from '../core/rules.ts';
import { INSIGHT_LABELS, insights } from '../core/rules.ts';
import { Empty, InsightCard } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { FocusControl } from './UltraFocus.tsx';

export function NeedsAttention({ quest, onOpen }: { quest: Quest; onOpen: (id: string) => void }) {
  const { state, actor, now } = quest;
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const all = insights(state, now);
  const shown = scope === 'mine' ? all.filter(item => item.who === actor) : all;
  const kinds = [...new Set(shown.map(item => item.kind))] as InsightKind[];

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Rule-based guidance · no AI required</p>
          <h1>Needs Attention</h1>
          <p className="lede">Each item says what happened, why it matters, what to do, and who acts next.</p>
        </div>
        <div className="seg" role="group" aria-label="Whose items">
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Everyone <span>{all.length}</span></button>
          <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>For me <span>{all.filter(item => item.who === actor).length}</span></button>
        </div>
      </header>
      <FocusControl quest={quest} onOpen={onOpen} />
      {shown.length === 0 ? <Empty title="Nothing needs attention">When work stalls, blocks, or waits on someone, it shows up here.</Empty> : kinds.map(kind => (
        <section key={kind} className="group">
          <h3 className="group-title">{INSIGHT_LABELS[kind]} <span>{shown.filter(item => item.kind === kind).length}</span></h3>
          <div className="insights">{shown.filter(item => item.kind === kind).map(item => <InsightCard key={item.id} quest={quest} insight={item} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
}
