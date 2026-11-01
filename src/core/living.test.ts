import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankTask, seedState } from './seed.ts';
import { livingLayout, packCircles, phyllotaxis } from './living.ts';
import type { TaskStatus } from './contract.ts';

const NOW = Date.parse('2026-10-27T15:00:00Z');

test('packed circles never overlap', () => {
  const radii = [30, 22, 18, 12, 9, 5, 5];
  const at = packCircles(radii);
  for (let i = 0; i < radii.length; i++) for (let j = i + 1; j < radii.length; j++)
    assert.ok(Math.hypot(at[i]!.x - at[j]!.x, at[i]!.y - at[j]!.y) >= radii[i]! + radii[j]! - 1e-6, `${i} overlaps ${j}`);
});

test('task spots stay inside the unit circle', () => {
  for (const spot of phyllotaxis(25)) assert.ok(Math.hypot(spot.x, spot.y) <= 1);
  assert.deepEqual(phyllotaxis(1), [{ x: 0, y: 0 }]);
});

test('bubbles come from real tasks, fit the box, and count attention honestly', () => {
  const state = seedState(NOW);
  state.projects = [{ id: 'roof', name: 'Roof' }, { id: 'yard', name: 'Yard' }];
  const make = (id: string, owner: string, projectId: string, status: TaskStatus, due = '') => {
    const task = blankTask(id, { title: id, owner, projectId, due }, 'jordan', NOW);
    task.status = status;
    return task;
  };
  state.tasks = [make('r1', 'alex', 'roof', 'done'), make('r2', 'alex', 'roof', 'working', '2026-10-20'), make('r3', 'maya', 'roof', 'blocked'), make('y1', 'maya', 'yard', 'ready')];
  state.events = [];
  const layout = livingLayout(state, 'jordan', NOW, true, { width: 600, height: 400 });
  assert.deepEqual(layout.bubbles.map(item => item.id), ['roof', 'yard']);
  const roof = layout.bubbles[0]!;
  assert.deepEqual([roof.total, roof.open, roof.done, roof.overdue, roof.blocked, roof.moving], [3, 2, 1, 1, 1, 0]);
  assert.deepEqual(roof.people.map(item => item.person), ['alex', 'maya']);
  for (const bubble of layout.bubbles) {
    assert.ok(bubble.x - bubble.r >= -0.5 && bubble.x + bubble.r <= 600.5 && bubble.y - bubble.r >= -0.5 && bubble.y + bubble.r <= 400.5);
    for (const dot of bubble.dots) assert.ok(Math.hypot(dot.x - bubble.x, dot.y - bubble.y) + dot.r <= bubble.r);
  }
  // Only the viewer's own work outside company scope.
  assert.deepEqual(livingLayout(state, 'maya', NOW, false).bubbles.flatMap(item => item.dots.map(dot => dot.id)).sort(), ['r3', 'y1']);
});

test('radial view: real records, every task once, inside its own project sector, no overlaps', async () => {
  const { livingRadial } = await import('./living.ts');
  const state = seedState(NOW);
  const view = livingRadial(state, 'jordan', NOW, true, { width: 640, height: 440 });
  const visible = state.tasks.filter(task => !task.archivedAt);
  const dots = view.sectors.flatMap(sector => sector.dots.map(dot => ({ ...dot, sector })));
  assert.deepEqual(dots.map(dot => dot.id).sort(), visible.map(task => task.id).sort(), 'one node per task');
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    const a = dots[i]!, b = dots[j]!;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.5, `${a.id} overlaps ${b.id}`);
  }
  for (const dot of dots) {
    const radius = Math.hypot(dot.x - view.cx, dot.y - view.cy);
    assert.ok(radius - dot.r >= view.rings.inner - 0.5 && radius + dot.r <= view.rings.outer + 0.5, `${dot.id} stays in the project band`);
    assert.ok(dot.angle >= dot.sector.a0 - 1e-6 && dot.angle <= dot.sector.a1 + 1e-6, `${dot.id} stays in its project's sector`);
    assert.equal(state.tasks.find(task => task.id === dot.id)!.projectId || '', dot.sector.id, `${dot.id} sits in its own project`);
  }
  // People: one per owner of open work, sized by it; the core counts match.
  const owners = new Set(visible.filter(task => task.status !== 'done' && task.owner).map(task => task.owner));
  assert.deepEqual(view.people.map(p => p.person).sort(), [...owners].sort());
  assert.equal(view.open, visible.filter(task => task.status !== 'done').length);
  assert.equal(view.arcs.find(arc => arc.key === 'done')!.count, visible.filter(task => task.status === 'done').length);
  // Links only join a task to unfinished work it waits on.
  for (const link of view.links) assert.ok(state.tasks.find(task => task.id === link.to)!.dependsOn.includes(link.from));
  // Deterministic: the same records draw the same picture.
  assert.deepEqual(livingRadial(state, 'jordan', NOW, true, { width: 640, height: 440 }), view);
});
