import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentumGreeting } from './momentum.ts';
import { seedState } from './seed.ts';
import type { QuestEvent } from './contract.ts';
import { apply } from './engine.ts';

const at = (day = 19, hour = 9) => new Date(2026, 9, day, hour).getTime();
const session = (now: number, visit = 0, previousAt: number | null = null) => ({ startedAt: now, previousAt, visit });
function ready(now: number) {
  const state = seedState(now);
  state.tasks = state.tasks.filter(task => task.owner === 'alex').map(task => ({ ...task, due: '', status: 'ready', dependsOn: [], lastActivityAt: now }));
  state.events = [];
  return state;
}

test('morning, afternoon, evening and weekend copy uses local time and date', () => {
  for (const [day, hour, kind, label] of [[19, 9, 'morning', 'Morning'], [19, 14, 'afternoon', 'Afternoon'], [19, 21, 'evening', 'Evening'], [24, 9, 'weekend', 'Weekend'], [25, 18, 'weekend', 'Weekend']] as const) {
    const now = at(day, hour), state = ready(now);
    const greeting = momentumGreeting(state, 'alex', now, session(now));
    assert.equal(greeting.kind, kind);
    assert.ok(greeting.eyebrow.includes(label));
    assert.ok(greeting.support.startsWith('Alex, '));
  }
});

test('overdue, blocked, dependency and completed conditions are accurate and take priority over generic greetings', () => {
  const now = at(), state = ready(now);
  state.tasks[0]!.due = '2026-10-18';
  assert.equal(momentumGreeting(state, 'alex', now, session(now)).kind, 'overdue');
  state.tasks[0]!.due = '';
  state.tasks[0]!.status = 'blocked';
  assert.equal(momentumGreeting(state, 'alex', now, session(now)).kind, 'blocked');
  state.tasks[0]!.status = 'ready'; state.tasks[0]!.dependsOn = [state.tasks[1]!.id];
  assert.equal(momentumGreeting(state, 'alex', now, session(now)).kind, 'blocked');
  state.tasks[0]!.dependsOn = [];
  state.tasks[0]!.status = 'done'; state.tasks[0]!.completedAt = now - 1000;
  const done = momentumGreeting(state, 'alex', now, session(now));
  assert.equal(done.kind, 'completed'); assert.ok(done.support.includes('1 task you own was completed today'));
  state.tasks[0]!.completedAt = at(18);
  assert.notEqual(momentumGreeting(state, 'alex', now, session(now)).kind, 'completed');
});

test('no tasks, unavailable context, reviewer and email display names fall back without fabricated claims', () => {
  const now = at(), state = ready(now);
  state.tasks = [];
  assert.equal(momentumGreeting(state, 'alex', now, session(now)).kind, 'clear');
  assert.equal(momentumGreeting(null, 'alex', now, session(now)).kind, 'unavailable');
  assert.equal(momentumGreeting(state, 'abraham', now, session(now), true).kind, 'unavailable');
  state.people.find(person => person.id === 'alex')!.name = 'alex.private@example.test';
  const text = JSON.stringify(momentumGreeting(state, 'alex', now, session(now)));
  assert.ok(!text.includes('@')); assert.ok(!text.includes('private'));
});

test('copy is stable within a session; successive visits vary deterministically', () => {
  const now = at(), state = ready(now);
  const first = momentumGreeting(state, 'alex', now, session(now));
  assert.equal(momentumGreeting(state, 'alex', now + 60_000, session(now)).id, first.id);
  assert.notEqual(momentumGreeting(state, 'alex', now, session(now, 1)).id, first.id);
  assert.deepEqual(momentumGreeting(state, 'alex', now, session(now, 1)), momentumGreeting(state, 'alex', now, session(now, 1)));
});

test('returning copy counts only retained, non-undone authorized events before the session began', () => {
  const now = at(), state = ready(now), previous = now - 3_600_000;
  const event: QuestEvent = { id: 'actual-change', actor: 'maya', taskId: state.tasks[0]!.id, text: 'Actual change', kind: 'task', at: now - 1000 };
  state.events = [event, event, { ...event, id: 'undone', undone: true }, { ...event, id: 'future', at: now + 1000 }];
  const result = momentumGreeting(state, 'alex', now, session(now, 1, previous));
  assert.equal(result.kind, 'returning'); assert.ok(result.support.includes('1 recorded task change'));
  state.events = [{ ...event, taskId: 'inaccessible' }];
  assert.notEqual(momentumGreeting(state, 'alex', now, session(now, 1, previous), false).kind, 'returning');
  state.events = Array.from({ length: 400 }, (_, index) => ({ ...event, id: `retained-${index}` }));
  assert.notEqual(momentumGreeting(state, 'alex', now, session(now, 1, previous)).kind, 'returning');
});

test('company activity is gated separately from personal activity', () => {
  const now = at(), state = ready(now), other = { ...state.tasks[0]!, id: 'other-work', owner: 'maya' };
  state.tasks.push(other);
  state.events = [{ id: 'company-event', actor: 'maya', taskId: other.id, kind: 'task', at: now - 1000, text: 'Other work changed' }];
  assert.notEqual(momentumGreeting(state, 'alex', now, session(now, 1, now - 2000), false).kind, 'returning');
  assert.equal(momentumGreeting(state, 'alex', now, session(now, 1, now - 2000), true).kind, 'returning');
});

test('Critical Focus cannot expose other owned or company tasks through a greeting', () => {
  const now = at(), state = ready(now), focusTask = state.tasks[0]!;
  state.tasks[1]!.due = '2026-10-18';
  state.events = [{ id: 'other-change', actor: 'maya', taskId: state.tasks[1]!.id, kind: 'task', at: now - 1000, text: 'Outside focus' }];
  const activated = apply(state, { type: 'ultra/activate', taskId: focusTask.id }, { actor: 'jordan', now });
  assert.ok(activated.ok);
  const result = momentumGreeting(activated.state, 'alex', now, session(now, 1, now - 2000), true);
  assert.notEqual(result.kind, 'overdue');
  assert.ok(!result.support.includes('workspace'));
  assert.ok(!result.support.includes('Outside focus'));
});
