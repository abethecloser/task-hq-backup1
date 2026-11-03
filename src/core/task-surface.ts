// What a task row says at each level of detail, for this person, right now. Derived only from
// records the viewer already has (via responsibility and selectors); it stores and decides nothing,
// and it grants nothing: actions still come from the engine's authorized offers.
import type { Person, QuestState, Task } from './contract.ts';
import { responsibility } from './responsibility.ts';
import type { Responsibility } from './responsibility.ts';
import { ago } from './dashboard.ts';
import { blockingDeps, coordinates, dependents, firstName, person } from './selectors.ts';
import type { Scope } from './registry.ts';

export type Density = 'compact' | 'standard' | 'detailed';
export const DENSITIES: Density[] = ['compact', 'standard', 'detailed'];
export const DENSITY_LABELS: Record<Density, string> = { compact: 'Compact', standard: 'Standard', detailed: 'Detailed' };
export const asDensity = (value: unknown): Density => (DENSITIES.includes(value as Density) ? value as Density : 'standard');

export interface RowSignal {
  tone: Responsibility['tone'];
  /** This person is the one who must act. */
  mine: boolean;
  /** Who or what holds the work: "Your move", "Maya", "Waiting on Sam", "Blocked", "Unassigned". */
  label: string;
  /** What has to happen. */
  text: string;
}

const readOnly = (who: Person | undefined) => (who?.authority ? who.authority === 'reviewer' : who?.role === 'reviewer');

/** The one line that makes a row actionable: who acts now, and what they do. A read-only viewer is
 * never told it is their move, because the engine offers them no moves. */
export function rowSignal(state: QuestState, task: Task, actor: string): RowSignal {
  const r = responsibility(state, task);
  const holds = !!r.actor && r.actor === actor && r.tone !== 'done';
  const mine = holds && !readOnly(person(state, actor));
  const who = (id: string) => (id === actor ? 'you' : firstName(state, id, 'someone'));
  if (r.tone === 'done') return { tone: r.tone, mine: false, label: 'Done', text: r.action };
  if (r.tone === 'wait') {
    const held = task.dependsOn.map(id => state.tasks.find(item => item.id === id)).find(item => item && item.status !== 'done');
    return { tone: r.tone, mine: false, label: r.actor ? `Waiting on ${who(r.actor)}` : 'Waiting', text: held ? `“${held.title}”` : r.action };
  }
  if (!r.actor) return { tone: r.tone, mine: false, label: r.actorNote === 'Nobody is assigned' ? 'Unassigned' : r.stateLabel, text: r.action };
  if (mine) return { tone: r.tone, mine, label: 'Your move', text: r.action };
  if (holds) return { tone: r.tone, mine, label: 'Assigned to you', text: r.action };
  return { tone: r.tone, mine, label: r.tone === 'stop' ? `Blocked · ${who(r.actor)}` : firstName(state, r.actor, 'Someone'), text: r.action };
}

/** Detailed density: short facts about where the task sits. Only what is true is listed. */
export function rowEvidence(state: QuestState, task: Task, now: number): string[] {
  const facts: string[] = [];
  const blocking = task.status === 'done' ? [] : blockingDeps(state, task);
  const unlocks = task.status === 'done' ? [] : dependents(state, task);
  if (blocking.length) facts.push(`Waiting on ${blocking.length} ${blocking.length === 1 ? 'task' : 'tasks'}`);
  if (unlocks.length) facts.push(`Unlocks ${unlocks.length} ${unlocks.length === 1 ? 'task' : 'tasks'}`);
  if (task.nextOwner && task.status !== 'done') facts.push(`Goes to ${firstName(state, task.nextOwner, 'someone')} next`);
  if (task.approver && task.status !== 'done') facts.push(`${firstName(state, task.approver, 'Someone')} approves`);
  if (task.waitingOn) facts.push(`Outside: ${task.waitingOn}`);
  if (task.lastActivityAt) facts.push(`Active ${ago(task.lastActivityAt, now)}`);
  return facts;
}

/** Where Tasks opens for someone with no saved preference: people who coordinate or review see the
 * company, everyone else starts with their own work. Both stay one click apart; this limits nothing. */
export function defaultScope(who: Person | undefined): Scope {
  return coordinates(who) || readOnly(who) ? 'company' : 'mine';
}
