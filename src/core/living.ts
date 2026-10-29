// Living view: an organic, circle-packed picture of the same records Projects and Team Overview counts.
// Projects are bubbles sized by their task count; each task is a dot inside its project, coloured by
// status, ringed when overdue and pulsing when it moved recently. Pure and deterministic: the same
// records always produce the same picture, so nothing jumps between renders.
import type { QuestState, Task, TaskStatus } from './contract.ts';
import { recentActivity } from './dashboard.ts';
import { blockingDeps, firstName, isOpen, isOverdue } from './selectors.ts';
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
  const visible = state.tasks.filter(task => company || task.owner === actor);
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
