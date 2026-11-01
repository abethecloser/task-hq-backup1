import type { LivingBubble } from '../core/living.ts';
import type { KeyboardEvent } from 'react';

const COLORS = { ready: '#d5d8dd', working: '#438bb3', review: '#9d8ac2', blocked: '#df6862', done: '#5bb59c' };
const point = (r: number, a: number) => ({ x: 260 + r * Math.cos(a), y: 260 + r * Math.sin(a) });
export function sector(inner: number, outer: number, start: number, end: number) {
  const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${a.x},${a.y} A${outer},${outer} 0 ${large} 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 ${large} 0 ${d.x},${d.y} Z`;
}
export function LivingGraphic({ bubbles, active, person, picked, onProject, onTask }: {
  bubbles: LivingBubble[]; active: string | null; person: string | null; picked: string | null;
  onProject: (id: string) => void; onTask: (project: string, task: string) => void;
}) {
  
  const press = (e: KeyboardEvent, act: () => void) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } };
  const dots = bubbles.flatMap(b => b.dots.map(d => ({ ...d, project: b.id }))).filter(d => !person || d.owner === person);
  const done = dots.filter(d => d.status === 'done').length;
  const percent = dots.length ? Math.floor(done / dots.length * 100) : 0;
  return <svg className="lv-stage lv-reference" viewBox="0 0 520 520" role="group" aria-label={`Task stage donut: ${done} of ${dots.length} complete. Select a task segment.`}>
    {dots.map((d, index) => {
      const start = index / dots.length * Math.PI * 2 - Math.PI / 2;
      const end = (index + 1) / dots.length * Math.PI * 2 - Math.PI / 2;
      const gap = Math.min(.018, (end - start) / 8);
      return <path key={d.id} className={`lg-task ${picked === d.id ? 'is-picked' : ''}`}
        d={sector(picked === d.id ? 139 : 145, picked === d.id ? 227 : 220, start + gap, end - gap)}
        fill={COLORS[d.status]} role="button" tabIndex={0} aria-label={`${d.title}: ${d.status}`} aria-pressed={picked === d.id}
        onClick={() => onTask(d.project, d.id)} onKeyDown={e => press(e, () => onTask(d.project, d.id))}>
        <title>{`${d.title} · ${d.status}`}</title>
      </path>;
    })}
    <text x="260" y="258" textAnchor="middle" className="lg-total">{percent}%</text>
    <text x="260" y="285" textAnchor="middle" className="lg-caption">{done} of {dots.length} complete</text>
  </svg>;
}
