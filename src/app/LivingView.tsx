// Living: Projects and Team Overview as an organic picture. Projects are bubbles sized by their tasks;
// each dot is a task (colour = stage, red ring = overdue, pulse = moved in the last 48 hours). It shares
// the Standard view's project and person selection, and the dock can focus a project from a thread.
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import { livingLayout } from '../core/living.ts';
import type { LivingBubble } from '../core/living.ts';
import { firstName } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';

const W = 640, H = 380;

export function LivingView({ quest, company, projectId, person, focusProjectId, onProject, onPerson, onOpen }: {
  quest: Quest; company: boolean;
  /** The shared selection (same as the Standard view's lists). */
  projectId: string | null; person: string | null;
  /** The project the dock is reading about, highlighted until cleared. */
  focusProjectId: string | null;
  onProject: (id: string | null) => void; onPerson: (id: string | null) => void; onOpen: (taskId: string) => void;
}) {
  const { state, actor, now } = quest;
  const layout = useMemo(() => livingLayout(state, actor, now, company, { width: W, height: H }), [state, actor, now, company]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const active = projectId ?? focusProjectId;
  const bubble = layout.bubbles.find(item => item.id === active) ?? null;
  const dot = taskId ? layout.bubbles.flatMap(item => item.dots).find(item => item.id === taskId) ?? null : null;
  const pool = bubble ? [bubble] : layout.bubbles;
  const dots = pool.flatMap(item => item.dots).filter(item => !person || item.owner === person);
  const movingNow = dots.filter(item => item.moving);
  const attention = dots.filter(item => item.overdue || item.status === 'blocked' || item.waiting);
  const involved = mergePeople(pool);
  const press = (event: KeyboardEvent, act: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); act(); } };
  const toggleProject = (id: string) => { setTaskId(null); onProject(projectId === id ? null : id); };

  if (layout.bubbles.length === 0) return <p className="hd-quiet">No tasks yet.</p>;
  return (
    <div className="lv">
      <svg className="lv-stage" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Living view: ${layout.bubbles.length} projects. Select a project to see what’s moving, what needs attention and who’s involved.`}>
        {layout.bubbles.map(item => {
          const on = item.id === active, dim = (!!active && !on) || (!!person && !item.people.some(p => p.person === person));
          return (
            <g key={item.id || 'none'} className={`lv-bubble ${on ? 'is-on' : ''} ${item.id === focusProjectId ? 'is-focus' : ''} ${dim ? 'is-dim' : ''}`}
              role="button" tabIndex={0} aria-pressed={projectId === item.id}
              aria-label={`${item.name}: ${item.open} open of ${item.total}${item.moving ? `, ${item.moving} moving` : ''}${item.overdue ? `, ${item.overdue} overdue` : ''}${item.blocked ? `, ${item.blocked} blocked` : ''}${item.waiting ? `, ${item.waiting} waiting` : ''}`}
              onClick={() => toggleProject(item.id)} onKeyDown={event => press(event, () => toggleProject(item.id))}>
              <circle className="lv-skin" cx={item.x} cy={item.y} r={item.r} />
              {item.dots.map(d => (
                <circle key={d.id} className={`lv-dot s-${d.status} ${d.overdue ? 'is-late' : ''} ${d.moving ? 'is-moving' : ''} ${d.id === taskId ? 'is-picked' : ''} ${person && d.owner !== person ? 'is-dim' : ''}`}
                  cx={d.x} cy={d.y} r={d.r} onClick={event => { event.stopPropagation(); onProject(item.id); setTaskId(d.id === taskId ? null : d.id); }}>
                  <title>{`${d.title} · ${STATUS_LABELS[d.status]}${d.owner ? ` · ${firstName(state, d.owner)}` : ''}`}</title>
                </circle>
              ))}
              {item.r > 26 && <text className="lv-name" x={item.x} y={item.y + item.r + 0} dy="-6" textAnchor="middle">{clip(item.name, Math.floor(item.r / 4))}</text>}
            </g>
          );
        })}
      </svg>

      <aside className="lv-detail" aria-live="polite">
        <header>
          <strong>{bubble ? bubble.name : company ? 'All projects' : 'Your projects'}</strong>
          <small>{bubble ? `${bubble.done} of ${bubble.total} done · ${bubble.open} open` : `${layout.bubbles.length} projects · ${dots.length} tasks`}{person ? ` · ${firstName(state, person)}` : ''}</small>
        </header>
        {dot && <div className="lv-task">
          <b>{dot.title}</b>
          <small>{STATUS_LABELS[dot.status]}{dot.owner ? ` · ${firstName(state, dot.owner)}` : ' · Unassigned'}{dot.overdue ? ' · overdue' : ''}{dot.waiting ? ' · waiting on a dependency' : ''}{dot.moving ? ' · moved recently' : ''}</small>
          <button type="button" className="link" onClick={() => onOpen(dot.id)}>Open task</button>
        </div>}
        <Group label="What’s moving" empty="Nothing moved in the last 48 hours." items={movingNow.slice(0, 3)} onPick={id => setTaskId(id)} picked={taskId} />
        <Group label="Needs attention" empty="Nothing overdue, blocked or waiting." items={attention.slice(0, 3)} hot onPick={id => setTaskId(id)} picked={taskId} />
        <div className="lv-group">
          <p className="pt-label">Who’s involved</p>
          {involved.length === 0 ? <p className="hd-quiet">Nobody has open work here.</p> : <div className="lv-people">
            {involved.slice(0, 8).map(item => <button key={item.person} type="button" className="lv-person" aria-pressed={person === item.person}
              onClick={() => { setTaskId(null); onPerson(person === item.person ? null : item.person); }}>{item.name}<b>{item.open}</b></button>)}
          </div>}
        </div>
        <p className="lv-key" aria-hidden="true"><i className="s-working" />In progress <i className="s-review" />Review <i className="s-blocked" />Blocked <i className="s-ready" />Not started <i className="s-done" />Done</p>
      </aside>
    </div>
  );
}

function Group({ label, items, empty, hot, onPick, picked }: { label: string; items: { id: string; title: string }[]; empty: string; hot?: boolean; onPick: (id: string) => void; picked: string | null }) {
  return <div className="lv-group">
    <p className="pt-label">{label}</p>
    {items.length === 0 ? <p className="hd-quiet">{empty}</p> : <ul className="lv-list">
      {items.map(item => <li key={item.id}><button type="button" className={`${hot ? 'is-hot' : ''} ${picked === item.id ? 'is-on' : ''}`} aria-pressed={picked === item.id} onClick={() => onPick(item.id)}>{item.title}</button></li>)}
    </ul>}
  </div>;
}

function mergePeople(bubbles: LivingBubble[]) {
  const map = new Map<string, { person: string; name: string; open: number }>();
  for (const bubble of bubbles) for (const item of bubble.people) {
    const seen = map.get(item.person);
    map.set(item.person, seen ? { ...seen, open: seen.open + item.open } : { ...item });
  }
  return [...map.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, Math.max(3, max - 1))}…` : text;
