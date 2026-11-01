// Living: the operation as one radial picture of the same records the Standard view counts. From the
// centre: progress arcs (done, in progress, blocked), people on an inner orbit leaning toward the
// projects they work in, projects as sectors of packed task nodes (size = weight, colour = stage), and
// an outer tick per task (longer = moved more recently). Chords join a task to unfinished work it waits
// on. Selecting a project, person or task highlights what it touches; the panel beside it explains.
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import { livingRadial } from '../core/living.ts';
import type { RadialSector } from '../core/living.ts';
import { firstName } from '../core/selectors.ts';
import type { Quest } from '../ui/useQuest.ts';

const W = 640, H = 440;

/** An annular wedge (one project's sector) between two radii and two angles. */
function wedge(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

export function LivingView({ quest, company, projectId, person, focusProjectId, onProject, onPerson, onOpen }: {
  quest: Quest; company: boolean;
  /** The shared selection (same as the Standard view's lists). */
  projectId: string | null; person: string | null;
  /** The project the dock is reading about, highlighted until cleared. */
  focusProjectId: string | null;
  onProject: (id: string | null) => void; onPerson: (id: string | null) => void; onOpen: (taskId: string) => void;
}) {
  const { state, actor, now } = quest;
  const view = useMemo(() => livingRadial(state, actor, now, company, { width: W, height: H }), [state, actor, now, company]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const active = projectId ?? focusProjectId;
  const bubble = view.sectors.find(item => item.id === active) ?? null;
  const allDots = view.sectors.flatMap(item => item.dots);
  const dot = taskId ? allDots.find(item => item.id === taskId) ?? null : null;
  const pool = bubble ? [bubble] : view.sectors;
  const dots = pool.flatMap(item => item.dots).filter(item => !person || item.owner === person);
  const movingNow = dots.filter(item => item.moving);
  const attention = dots.filter(item => item.overdue || item.status === 'blocked' || item.waiting);
  const involved = mergePeople(pool);
  const picked = view.people.find(item => item.person === person) ?? null;
  // What the current selection touches, for highlighting; everything else recedes.
  const lit = (id: string, owner: string, sector: string) => (!active || sector === active) && (!person || owner === person) && (!dot || id === dot.id || view.links.some(link => (link.from === dot.id && link.to === id) || (link.to === dot.id && link.from === id)));
  const press = (event: KeyboardEvent, act: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); act(); } };
  const toggleProject = (id: string) => { setTaskId(null); onProject(projectId === id ? null : id); };
  const { cx, cy, rings } = view;

  if (view.sectors.length === 0) return <p className="hd-quiet">No tasks yet.</p>;
  return (
    <div className="lv">
      <svg className="lv-stage lv-radial" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Living view: ${view.open} open of ${view.total} tasks across ${view.sectors.length} projects and ${view.people.length} people. Select a project, person or task to see what it connects to.`}>
        {/* Structure: faint concentric guides for the layers. */}
        {[rings.core, rings.people, rings.inner, rings.outer].map(r => <circle key={r} className="lv-guide" cx={cx} cy={cy} r={r} />)}

        {/* Projects: a sector each, with its tasks packed inside. */}
        {view.sectors.map(sector => {
          const on = sector.id === active, dim = (!!active && !on) || (!!person && !sector.people.some(p => p.person === person));
          const mid = (sector.a0 + sector.a1) / 2;
          const anchor = Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle';
          return (
            <g key={sector.id || 'none'} className={`lv-sector ${on ? 'is-on' : ''} ${sector.id === focusProjectId ? 'is-focus' : ''} ${dim ? 'is-dim' : ''}`}
              role="button" tabIndex={0} aria-pressed={projectId === sector.id}
              aria-label={`${sector.name}: ${sector.open} open of ${sector.total}${sector.moving ? `, ${sector.moving} moving` : ''}${sector.overdue ? `, ${sector.overdue} overdue` : ''}${sector.blocked ? `, ${sector.blocked} blocked` : ''}${sector.waiting ? `, ${sector.waiting} waiting` : ''}`}
              onClick={() => toggleProject(sector.id)} onKeyDown={event => press(event, () => toggleProject(sector.id))}>
              <path className="lv-wedge" d={wedge(cx, cy, rings.inner, rings.outer, sector.a0, sector.a1)} />
              <text className="lv-name" x={sector.x} y={sector.y} textAnchor={anchor} dominantBaseline="middle">{clip(sector.name, 22)}<tspan className="lv-count"> · {sector.open}</tspan></text>
            </g>
          );
        })}

        {/* Activity: the outer ring of ticks. */}
        <g className="lv-ticks" aria-hidden="true">
          {view.ticks.map(tick => <line key={tick.id} className={`lv-tick s-${tick.status}`} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} style={{ opacity: 0.25 + (1 - tick.age) * 0.75 }} />)}
        </g>

        {/* Relationships: dependency chords, and the selected person's work. */}
        <g className="lv-links" aria-hidden="true">
          {view.links.map(link => <path key={`${link.from}>${link.to}`} className={`lv-link ${dot && (link.from === dot.id || link.to === dot.id) ? 'is-on' : ''}`} d={link.path} />)}
          {picked && picked.tasks.map(id => { const target = allDots.find(item => item.id === id); return target ? <line key={id} className="lv-tie" x1={picked.x} y1={picked.y} x2={target.x} y2={target.y} /> : null; })}
        </g>

        {view.sectors.flatMap(sector => sector.dots.map(d => (
          <circle key={d.id} className={`lv-dot s-${d.status} ${d.overdue ? 'is-late' : ''} ${d.moving ? 'is-moving' : ''} ${d.id === taskId ? 'is-picked' : ''} ${lit(d.id, d.owner, sector.id) ? '' : 'is-dim'}`}
            cx={d.x} cy={d.y} r={d.r} onClick={event => { event.stopPropagation(); onProject(sector.id); setTaskId(d.id === taskId ? null : d.id); }}>
            <title>{`${d.title} · ${STATUS_LABELS[d.status]}${d.owner ? ` · ${firstName(state, d.owner)}` : ''}`}</title>
          </circle>
        )))}

        {/* People: the inner orbit. */}
        {view.people.map(item => {
          const on = person === item.person, dim = (!!person && !on) || (!!active && !item.projects.includes(active));
          const toggle = () => { setTaskId(null); onPerson(on ? null : item.person); };
          return (
            <g key={item.person} className={`lv-person-node ${on ? 'is-on' : ''} ${dim ? 'is-dim' : ''}`} role="button" tabIndex={0} aria-pressed={on}
              aria-label={`${item.name}: ${item.open} open ${item.open === 1 ? 'task' : 'tasks'}`} onClick={toggle} onKeyDown={event => press(event, toggle)}>
              <circle cx={item.x} cy={item.y} r={item.r} />
              <text x={item.x} y={item.y} textAnchor="middle" dominantBaseline="central">{item.r >= 11 ? item.name.slice(0, 2) : ''}</text>
              <title>{`${item.name} · ${item.open} open`}</title>
            </g>
          );
        })}

        {/* Core: where everything meets. */}
        <g className="lv-core" aria-hidden="true">
          {view.arcs.map(arc => <g key={arc.key}><circle className={`lv-arc-track a-${arc.key}`} cx={cx} cy={cy} r={arc.r} />{arc.count > 0 && <path className={`lv-arc a-${arc.key}`} d={arc.path} />}</g>)}
          <text className="lv-core-n" x={cx} y={cy - 4} textAnchor="middle">{view.open}</text>
          <text className="lv-core-l" x={cx} y={cy + 11} textAnchor="middle">open</text>
        </g>
      </svg>

      <aside className="lv-detail" aria-live="polite">
        <header>
          <strong>{bubble ? bubble.name : company ? 'All projects' : 'Your projects'}</strong>
          <small>{bubble ? `${bubble.done} of ${bubble.total} done · ${bubble.open} open` : `${view.sectors.length} projects · ${dots.length} tasks`}{person ? ` · ${firstName(state, person)}` : ''}</small>
        </header>
        {dot && <div className="lv-task">
          <b>{dot.title}</b>
          <small>{STATUS_LABELS[dot.status]}{dot.owner ? ` · ${firstName(state, dot.owner)}` : ' · Unassigned'}{dot.overdue ? ' · overdue' : ''}{dot.waiting ? ' · waiting on a dependency' : ''}{dot.moving ? ' · moved recently' : ''}</small>
          <button type="button" className="link" onClick={() => onOpen(dot.id)}>Open task</button>
        </div>}
        <Group label="What’s moving" empty="Nothing moved in the last 48 hours." items={movingNow.slice(0, 3)} onPick={id => setTaskId(id)} picked={taskId} />
        <Group label="Needs attention" empty="Nothing overdue, blocked or waiting." items={attention.slice(0, 3)} more={attention.length - 3} hot onPick={id => setTaskId(id)} picked={taskId} />
        <p className="lv-involved"><span className="pt-label">Who’s involved</span> {involved.length === 0 ? 'Nobody has open work here.' : `${involved.slice(0, 4).map(item => item.name).join(', ')}${involved.length > 4 ? ` +${involved.length - 4}` : ''}`}</p>
        <p className="lv-key" aria-hidden="true"><i className="s-working" />In progress <i className="s-review" />Review <i className="s-blocked" />Blocked <i className="s-ready" />Not started <i className="s-done" />Done · size = weight · outer ticks = recent activity</p>
      </aside>
    </div>
  );
}

function Group({ label, items, empty, hot, more = 0, onPick, picked }: { label: string; items: { id: string; title: string }[]; empty: string; hot?: boolean; more?: number; onPick: (id: string) => void; picked: string | null }) {
  return <div className="lv-group">
    <p className="pt-label">{label}</p>
    {items.length === 0 ? <p className="hd-quiet">{empty}</p> : <ul className="lv-list">
      {items.map(item => <li key={item.id}><button type="button" className={`${hot ? 'is-hot' : ''} ${picked === item.id ? 'is-on' : ''}`} aria-pressed={picked === item.id} title={item.title} onClick={() => onPick(item.id)}>{item.title}</button></li>)}
      {more > 0 && <li className="lv-more">+{more} more</li>}
    </ul>}
  </div>;
}

function mergePeople(bubbles: Pick<RadialSector, 'people'>[]) {
  const map = new Map<string, { person: string; name: string; open: number }>();
  for (const bubble of bubbles) for (const item of bubble.people) {
    const seen = map.get(item.person);
    map.set(item.person, seen ? { ...seen, open: seen.open + item.open } : { ...item });
  }
  return [...map.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, Math.max(3, max - 1))}…` : text;
