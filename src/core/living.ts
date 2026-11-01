// Living view: an organic, circle-packed picture of the same records Projects and Team Overview counts.
// Projects are bubbles sized by their task count; each task is a dot inside its project, coloured by
// status, ringed when overdue and pulsing when it moved recently. Pure and deterministic: the same
// records always produce the same picture, so nothing jumps between renders.
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { recentActivity } from './dashboard.ts';
import { blockingDeps, firstName, isOpen, isOverdue, isProjectArchived } from './selectors.ts';
import { NO_PROJECT } from './project-intel.ts';

/** How long a task counts as moving after its latest activity. */
export const MOVING_WINDOW = 48 * 60 * 60 * 1000;

export interface LivingDot { id: string; title: string; status: TaskStatus; owner: string; overdue: boolean; waiting: boolean; moving: boolean; x: number; y: number; r: number }
export interface LivingBubble {
  id: string; name: string; x: number; y: number; r: number;
  total: number; open: number; done: number; overdue: number; blocked: number; waiting: number; moving: number;
  /** Owners of open work in the project, most open work first. */
  people: { person: string; name: string; open: number }[];
  dots: LivingDot[];
}
export interface LivingLayout { width: number; height: number; bubbles: LivingBubble[] }

const GAP = 6;

/** Packs circles (largest first) as close to the centre as they fit, searching outward on a spiral. */
export function packCircles(radii: number[]): { x: number; y: number }[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const order = radii.map((r, index) => ({ r, index })).sort((a, b) => b.r - a.r || a.index - b.index);
  const out: { x: number; y: number }[] = Array.from({ length: radii.length }, () => ({ x: 0, y: 0 }));
  for (const { r, index } of order) {
    let at = { x: 0, y: 0 };
    if (placed.length) {
      for (let step = 0; step < 20000; step++) {
        const angle = step * 0.35, dist = step * 0.6;
        const x = Math.cos(angle) * dist, y = Math.sin(angle) * dist * 0.72;
        if (placed.every(other => Math.hypot(other.x - x, other.y - y) >= other.r + r + GAP)) { at = { x, y }; break; }
      }
    }
    placed.push({ ...at, r });
    out[index] = at;
  }
  return out;
}

/** Positions inside a unit circle, evenly spread (sunflower pattern). */
export function phyllotaxis(count: number): { x: number; y: number }[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const radius = count === 1 ? 0 : Math.sqrt((i + 0.5) / count);
    return { x: Math.cos(i * golden) * radius, y: Math.sin(i * golden) * radius };
  });
}

export function livingLayout(state: QuestState, actor: string, now: number, company: boolean, size = { width: 640, height: 420 }): LivingLayout {
  // Archived projects leave the picture; their tasks are unchanged.
  const visible = state.tasks.filter(task => (company || task.owner === actor) && !isProjectArchived(state, task.projectId));
  const lastMove = new Map<string, number>();
  for (const event of recentActivity(state, actor, company, Infinity)) if (event.taskId && !lastMove.has(event.taskId)) lastMove.set(event.taskId, event.at);
  const moving = (task: Task) => now - (lastMove.get(task.id) ?? -Infinity) <= MOVING_WINDOW;
  const waiting = (task: Task) => isOpen(task) && task.status !== 'blocked' && blockingDeps(state, task).length > 0;

  const ids = [...new Set(visible.map(task => task.projectId || NO_PROJECT))];
  const groups = ids.map(id => ({ id, tasks: visible.filter(task => (task.projectId || NO_PROJECT) === id) }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.id.localeCompare(b.id));
  const raw = groups.map(group => Math.sqrt(group.tasks.length) * 10 + 8);
  const centres = packCircles(raw);
  // Fit the packed cluster into the box.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  centres.forEach((c, i) => { minX = Math.min(minX, c.x - raw[i]!); maxX = Math.max(maxX, c.x + raw[i]!); minY = Math.min(minY, c.y - raw[i]!); maxY = Math.max(maxY, c.y + raw[i]!); });
  const pad = 12;
  // Fit the cluster, but never blow a few projects up to fill the stage: the largest bubble stays
  // at most ~28% of the stage height in radius, so one or two projects read as anchors, not walls.
  const fit = groups.length ? Math.min((size.width - pad * 2) / (maxX - minX), (size.height - pad * 2 - 18) / (maxY - minY)) : 1;
  const scale = Math.min(fit, (size.height * 0.28) / Math.max(...raw, 1));
  const offX = (size.width - (maxX - minX) * scale) / 2 - minX * scale, offY = (size.height - 18 - (maxY - minY) * scale) / 2 - minY * scale;

  const bubbles = groups.map((group, i): LivingBubble => {
    const r = raw[i]! * scale, x = centres[i]!.x * scale + offX, y = centres[i]!.y * scale + offY;
    const open = group.tasks.filter(isOpen);
    const owners = new Map<string, number>();
    for (const task of open) if (task.owner) owners.set(task.owner, (owners.get(task.owner) ?? 0) + 1);
    const spots = phyllotaxis(group.tasks.length);
    const dotR = Math.max(3, Math.min(7, (r * 0.78) / Math.sqrt(group.tasks.length) * 0.5));
    return {
      id: group.id, name: group.id === NO_PROJECT ? 'No project' : state.projects.find(item => item.id === group.id)?.name ?? 'Removed project',
      x, y, r, total: group.tasks.length, open: open.length, done: group.tasks.length - open.length,
      overdue: open.filter(task => isOverdue(task, now)).length, blocked: open.filter(task => task.status === 'blocked').length,
      waiting: open.filter(waiting).length, moving: group.tasks.filter(moving).length,
      people: [...owners].map(([person, count]) => ({ person, name: firstName(state, person), open: count })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      dots: group.tasks.map((task, at) => ({
        id: task.id, title: task.title, status: task.status, owner: task.owner, overdue: isOpen(task) && isOverdue(task, now), waiting: waiting(task), moving: moving(task),
        x: x + spots[at]!.x * (r - dotR - 4) * 0.92, y: y + spots[at]!.y * (r - dotR - 4) * 0.92, r: dotR,
      })),
    };
  });
  return { ...size, bubbles };
}

// ── Radial living view ────────────────────────────────────────────────────────────────────────────
// One composition from real records, read from the centre outwards:
//   core     — progress arcs: done, in progress and blocked as shares of all visible tasks;
//   people   — an inner orbit; each person sits at the mean angle of their open tasks, so they lean
//              toward the projects they work in; size = open work;
//   projects — angular sectors sized by task count; each task is a node packed into its sector,
//              sized by weight (priority, work waiting on it, overdue) and coloured by stage;
//   activity — an outer tick per task at its angle, longer the more recently it moved;
//   links    — chords between a task and the unfinished work it waits on.
// Pure and deterministic: the same records always draw the same picture.
export interface RadialNode extends LivingDot { angle: number; weight: number }
export interface RadialSector extends Omit<LivingBubble, 'dots'> { a0: number; a1: number; dots: RadialNode[] }
export interface RadialPerson { person: string; name: string; open: number; x: number; y: number; r: number; projects: string[]; tasks: string[] }
export interface RadialTick { id: string; x1: number; y1: number; x2: number; y2: number; age: number; status: TaskStatus }
export interface RadialLink { from: string; to: string; path: string }
export interface RadialArc { key: 'done' | 'working' | 'blocked'; label: string; share: number; count: number; r: number; path: string }
export interface LivingRadial {
  width: number; height: number; cx: number; cy: number;
  rings: { core: number; people: number; inner: number; outer: number; ticks: number };
  arcs: RadialArc[]; sectors: RadialSector[]; people: RadialPerson[]; ticks: RadialTick[]; links: RadialLink[];
  total: number; open: number;
}

const TAU = Math.PI * 2;
const polar = (cx: number, cy: number, r: number, a: number) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
/** An arc path from the top, clockwise, covering `share` of the circle. */
function arcPath(cx: number, cy: number, r: number, share: number) {
  const s = Math.min(Math.max(share, 0), 0.9999);
  const a0 = -Math.PI / 2, a1 = a0 + s * TAU;
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
  return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}A${r} ${r} 0 ${s > 0.5 ? 1 : 0} 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
}

export function livingRadial(state: QuestState, actor: string, now: number, company: boolean, size = { width: 640, height: 440 }): LivingRadial {
  const { width, height } = size;
  const cx = width / 2, cy = height / 2;
  const R = Math.min(width, height) / 2 - 8;
  const rings = { core: R * 0.2, people: R * 0.34, inner: R * 0.47, outer: R * 0.82, ticks: R * 0.97 };
  const visible = state.tasks.filter(task => (company || task.owner === actor) && !isProjectArchived(state, task.projectId));
  const lastMove = new Map<string, number>();
  for (const event of recentActivity(state, actor, company, Infinity)) if (event.taskId && !lastMove.has(event.taskId)) lastMove.set(event.taskId, event.at);
  const moving = (task: Task) => now - (lastMove.get(task.id) ?? -Infinity) <= MOVING_WINDOW;
  const waiting = (task: Task) => isOpen(task) && task.status !== 'blocked' && blockingDeps(state, task).length > 0;
  const dependents = (task: Task) => visible.filter(other => other.dependsOn.includes(task.id) && isOpen(other)).length;
  const weight = (task: Task) => 1 + (task.priority === 'high' ? 1 : 0) + (task.ultra ? 1.5 : 0) + Math.min(2, dependents(task) * 0.75) + (isOpen(task) && isOverdue(task, now) ? 0.75 : 0) - (isOpen(task) ? 0 : 0.4);

  // Projects as sectors, largest first, sized by task count (with a floor so small projects stay legible).
  const ids = [...new Set(visible.map(task => task.projectId || NO_PROJECT))];
  const groups = ids.map(id => ({ id, tasks: visible.filter(task => (task.projectId || NO_PROJECT) === id) }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.id.localeCompare(b.id));
  const gap = groups.length > 1 ? 0.06 : 0;
  const shares = groups.map(group => Math.max(group.tasks.length, visible.length * 0.06));
  const shareTotal = shares.reduce((sum, value) => sum + value, 0) || 1;
  const usable = TAU - gap * groups.length;
  const band = rings.outer - rings.inner;
  // Nodes share out about a third of the band's area by weight: few tasks read large, many pack small,
  // and the clusters always fill their sectors organically rather than floating as specks.
  const totalWeight = visible.reduce((sum, task) => sum + weight(task), 0) || 1;
  const annulus = Math.PI * (rings.outer ** 2 - rings.inner ** 2);
  const unit = Math.max(3.5, Math.min(band / 5, Math.sqrt((annulus * 0.32) / (Math.PI * totalWeight))));

  let angle = -Math.PI / 2 + gap / 2;
  const sectors: RadialSector[] = groups.map((group, index) => {
    const span = (shares[index]! / shareTotal) * usable;
    const a0 = angle, a1 = angle + span;
    angle = a1 + gap;
    // Pack this project's tasks into its sector: heaviest first, each at the first free spot on a
    // spiral that starts at the sector's middle and works outwards in angle and radius.
    const placed: RadialNode[] = [];
    const sorted = [...group.tasks].sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id));
    for (const task of sorted) {
      const r = Math.min(band / 2 - 3, unit * Math.sqrt(weight(task)));
      let spot = { x: cx, y: cy, a: (a0 + a1) / 2 };
      search: for (let step = 0; step < 4000; step++) {
        const t = step * 0.19;
        const rad = rings.inner + r + 2 + ((t * 3.1) % Math.max(1, band - 2 * r - 4));
        const half = (a1 - a0) / 2 - (r + 2) / rad;
        if (half <= 0) continue;
        const a = (a0 + a1) / 2 + Math.sin(t * 1.7) * half * Math.min(1, t / 40);
        const p = polar(cx, cy, rad, a);
        if (placed.every(other => Math.hypot(other.x - p.x, other.y - p.y) >= other.r + r + 1.6)) { spot = { ...p, a }; break search; }
        if (step === 3999) spot = { ...p, a };
      }
      placed.push({ id: task.id, title: task.title, status: task.status, owner: task.owner, overdue: isOpen(task) && isOverdue(task, now), waiting: waiting(task), moving: moving(task), x: spot.x, y: spot.y, r, angle: spot.a, weight: weight(task) });
    }
    const open = group.tasks.filter(isOpen);
    const owners = new Map<string, number>();
    for (const task of open) if (task.owner) owners.set(task.owner, (owners.get(task.owner) ?? 0) + 1);
    const label = polar(cx, cy, rings.outer + 6, (a0 + a1) / 2);
    return {
      id: group.id, name: group.id === NO_PROJECT ? 'No project' : state.projects.find(item => item.id === group.id)?.name ?? 'Removed project',
      x: label.x, y: label.y, r: 0, a0, a1, total: group.tasks.length, open: open.length, done: group.tasks.length - open.length,
      overdue: open.filter(task => isOverdue(task, now)).length, blocked: open.filter(task => task.status === 'blocked').length,
      waiting: open.filter(waiting).length, moving: group.tasks.filter(moving).length,
      people: [...owners].map(([person, count]) => ({ person, name: firstName(state, person), open: count })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      dots: placed,
    };
  });
  const nodes = new Map(sectors.flatMap(sector => sector.dots.map(dot => [dot.id, { dot, sector: sector.id }] as const)));

  // People on the inner orbit, at the circular mean of their open tasks' angles; spaced so they never touch.
  const byPerson = new Map<string, Task[]>();
  for (const task of visible) if (isOpen(task) && task.owner) byPerson.set(task.owner, [...(byPerson.get(task.owner) ?? []), task]);
  type Placed = RadialPerson & { angle: number };
  const people: Placed[] = [...byPerson].map(([person, tasks]): Placed => {
    const angles = tasks.map(task => nodes.get(task.id)?.dot.angle ?? 0);
    const mean = Math.atan2(angles.reduce((s, a) => s + Math.sin(a), 0), angles.reduce((s, a) => s + Math.cos(a), 0));
    const r = Math.min(rings.people - rings.core - 6, 6 + Math.sqrt(tasks.length) * 5);
    const p = polar(cx, cy, rings.people, mean);
    return { person, name: firstName(state, person), open: tasks.length, x: p.x, y: p.y, r, projects: [...new Set(tasks.map(task => task.projectId || NO_PROJECT))], tasks: tasks.map(task => task.id), angle: mean };
  }).sort((a, b) => a.angle - b.angle);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i]!, b = people[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 3) continue;
      const push = 0.03;
      const dir = Math.sin(b.angle - a.angle) >= 0 ? 1 : -1;
      a.angle -= push * dir; b.angle += push * dir;
      Object.assign(a, polar(cx, cy, rings.people, a.angle)); Object.assign(b, polar(cx, cy, rings.people, b.angle));
      moved = true;
    }
    if (!moved) break;
  }

  // Outer activity: one tick per task at its angle; recent movement reaches further out.
  const ticks: RadialTick[] = [...nodes.values()].map(({ dot }) => {
    const at = lastMove.get(dot.id);
    const age = at == null ? 1 : Math.min(1, (now - at) / (7 * 24 * 60 * 60 * 1000));
    const p1 = polar(cx, cy, rings.outer + 8, dot.angle), p2 = polar(cx, cy, rings.outer + 8 + (rings.ticks - rings.outer - 8) * (1 - age * 0.7), dot.angle);
    return { id: dot.id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, age, status: dot.status };
  });

  // Relationships: a chord through the interior from each task to the unfinished work it waits on.
  const links: RadialLink[] = [];
  for (const task of visible) for (const dep of task.dependsOn) {
    const a = nodes.get(task.id)?.dot, b = nodes.get(dep)?.dot;
    const depTask = state.tasks.find(item => item.id === dep);
    if (!a || !b || !depTask || !isOpen(depTask)) continue;
    const mid = polar(cx, cy, rings.people * 0.6, Math.atan2(Math.sin(a.angle) + Math.sin(b.angle), Math.cos(a.angle) + Math.cos(b.angle)));
    links.push({ from: dep, to: task.id, path: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${mid.x.toFixed(1)} ${mid.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}` });
  }

  const total = visible.length;
  const count = (fn: (task: Task) => boolean) => visible.filter(fn).length;
  const arcs: RadialArc[] = ([
    ['done', 'Done', count(task => task.status === 'done')],
    ['working', 'In progress', count(task => task.status === 'working' || task.status === 'review')],
    ['blocked', 'Blocked', count(task => task.status === 'blocked')],
  ] as const).map(([key, label, n], index) => {
    const r = rings.core - 6 - index * 9;
    return { key, label, count: n, share: total ? n / total : 0, r, path: arcPath(cx, cy, r, total ? n / total : 0) };
  });

  return { width, height, cx, cy, rings, arcs, sectors, people: people.map(({ angle: _angle, ...person }) => person), ticks, links, total, open: count(isOpen) };
}
