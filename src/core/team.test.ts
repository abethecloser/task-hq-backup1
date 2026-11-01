import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedState } from './seed.ts';
import { DAY } from './time.ts';
import { canSeeTeamOverview, filterTeam, memberActivity, memberSummary, memberUpcoming, memberWork, teamCounts, teamOverview } from './team.ts';
import { isOpen } from './selectors.ts';

const NOW = Date.UTC(2026, 10, 1, 15);

test('the overview is Abraham’s alone: owner/admin authority plus his name, an explicit allowlist, or the demo persona', () => {
  const state = seedState(NOW);
  assert.equal(canSeeTeamOverview(state, 'abraham', { demo: true }), true, 'demo persona previews it');
  assert.equal(canSeeTeamOverview(state, 'abraham', { demo: false }), false, 'outside the demo a name without server authority is not enough');
  for (const other of ['jordan', 'maya', 'alex', 'sam', 'riley']) assert.equal(canSeeTeamOverview(state, other, { demo: true }), false, other);
  state.people.push({ id: 'u-abraham', name: 'Abraham Ortiz', role: 'manager', title: 'Owner', authority: 'owner' });
  state.people.push({ id: 'u-abe-member', name: 'Abraham Smith', role: 'field', title: 'Crew', authority: 'member' });
  assert.equal(canSeeTeamOverview(state, 'u-abraham', { demo: false }), true);
  assert.equal(canSeeTeamOverview(state, 'u-abe-member', { demo: false }), false, 'a member named Abraham is not granted it');
  state.people.push({ id: 'u-owner2', name: 'Jordan Two', role: 'manager', title: 'Owner', authority: 'owner' });
  assert.equal(canSeeTeamOverview(state, 'u-owner2', { demo: false }), false, 'other owners are not included yet');
  assert.equal(canSeeTeamOverview(state, 'u-abraham', { demo: false, allow: ['u-owner2'] }), false, 'the allowlist replaces the name rule');
  assert.equal(canSeeTeamOverview(state, 'u-owner2', { demo: false, allow: ['u-owner2'] }), true);
});

test('every figure is a count of real tasks; no member records are created', () => {
  const state = seedState(NOW);
  const before = JSON.stringify(state);
  const team = teamOverview(state, NOW);
  assert.equal(JSON.stringify(state), before, 'read-only');
  assert.deepEqual(team.map(member => member.person.id).sort(), state.people.map(person => person.id).sort(), 'one card per existing person');
  for (const member of team) {
    const open = state.tasks.filter(task => task.owner === member.person.id && isOpen(task));
    assert.equal(member.open, open.length, member.person.id);
    assert.equal(Object.values(member.stages).reduce((sum, value) => sum + value, 0), open.length, 'the stage bar adds up to open work');
    assert.ok(member.overdue <= member.open && member.dueSoon <= member.open);
    if (member.nextUp) assert.ok(isOpen(member.nextUp));
    if (member.lastCompleted) assert.equal(member.lastCompleted.status, 'done');
    assert.ok(!('workload' in member) && !('capacity' in member));
  }
  const counts = teamCounts(team);
  assert.equal(counts.all, state.people.length);
  assert.equal(counts.active + counts.inactive, counts.all);
  assert.deepEqual(filterTeam(team, 'attention').map(member => member.person.id), team.filter(member => member.attention.length).map(member => member.person.id));
});

test('detail views read the same records: activity newest first, work by project, upcoming by date', () => {
  const state = seedState(NOW);
  for (const person of state.people) {
    const activity = memberActivity(state, person.id);
    assert.ok(activity.every((entry, index) => index === 0 || activity[index - 1]!.at >= entry.at), `${person.id} activity order`);
    const work = memberWork(state, person.id, NOW).flatMap(group => group.tasks);
    assert.ok(work.every(task => isOpen(task) && (task.owner === person.id || task.approver === person.id)));
    const { dated, incoming } = memberUpcoming(state, person.id, NOW);
    assert.ok(dated.every((task, index) => index === 0 || dated[index - 1]!.due <= task.due));
    assert.ok(incoming.every(task => task.nextOwner === person.id && task.owner !== person.id));
  }
});

test('activity status follows real activity: open work or anything in the last 14 days', () => {
  const state = seedState(NOW);
  const later = NOW + 60 * DAY;
  for (const task of state.tasks) if (task.status !== 'done') { task.status = 'done'; task.completedAt = NOW; task.completedBy = task.owner; }
  assert.ok(teamOverview(state, later).every(member => !member.active), 'nothing open, nothing recent → inactive');
  const maya = state.people.find(person => person.id === 'maya')!;
  state.events.push({ id: 'e-recent', at: later - DAY, actor: 'maya', kind: 'task', text: 'Updated the permit packet' });
  assert.equal(memberSummary(state, maya, later).active, true);
});
