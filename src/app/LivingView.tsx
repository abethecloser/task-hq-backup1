// Compact project donut. Operational detail lives in the dedicated dashboard modules.
import { useMemo, useState } from 'react';
import { LivingGraphic } from './LivingGraphic.tsx';
import { STATUS_LABELS } from '../core/contract.ts';
import { livingLayout } from '../core/living.ts';
import type { Quest } from '../ui/useQuest.ts';

export function LivingView({ quest, company, projectId, person, focusProjectId, onProject, onOpen }: {
  quest: Quest; company: boolean; projectId: string | null; person: string | null;
  focusProjectId: string | null; onProject: (id: string | null) => void;
  onPerson: (id: string | null) => void; onOpen: (taskId: string) => void;
}) {
  const { state, actor, now } = quest;
  const layout = useMemo(() => livingLayout(state, actor, now, company), [state, actor, now, company]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const active = projectId ?? focusProjectId;
  const pool = active == null ? layout.bubbles : layout.bubbles.filter(item => item.id === active);
  const dots = pool.flatMap(b => b.dots).filter(d => !person || d.owner === person);
  const picked = dots.find(d => d.id === taskId);
  if (!dots.length) return <p className="hd-quiet">No tasks in this selection.</p>;
  return <div className="lv lv-minimal">
    <LivingGraphic bubbles={pool} active={active} person={person} picked={picked?.id ?? null}
      onProject={id => { setTaskId(null); onProject(projectId === id ? null : id); }}
      onTask={(_project, task) => setTaskId(task)} />
    <div className="lv-selection" aria-live="polite">{picked
      ? <button type="button" className="link" onClick={() => onOpen(picked.id)}>{picked.title} · {STATUS_LABELS[picked.status]} →</button>
      : <span>Select a segment to explore a task</span>}</div>
    <div className="lv-compact-legend" aria-label="Task stages">{(['ready', 'working', 'review', 'blocked', 'done'] as const).map(status => {
      const count = dots.filter(d => d.status === status).length;
      return count > 0 && <span key={status}><i data-status={status} />{STATUS_LABELS[status]} <b>{count}</b></span>;
    })}</div>
  </div>;
}
