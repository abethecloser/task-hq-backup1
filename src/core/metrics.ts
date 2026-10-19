// Operational measures computed only from records Task-HQ already holds. No baselines,
// no targets beyond configured policy, no money. Every measure states its sample size,
// and the window is "what the workspace history still retains" (marked partial once
// the 400-event history is full). Measures with no data say so instead of showing zero.
import type { QuestEvent, QuestState, Task } from './contract.ts';
import { decisionDesk, handoffHistory } from './executive.ts';
import { isOpen, isStalled, leadElapsed } from './selectors.ts';

export interface Measure {
  key: string;
  label: string;
  /** null = nothing to measure yet. */
  value: number | null;
  unit: 'minutes' | 'hours' | 'count' | 'percent' | 'per-task';
  /** How many records the value is based on. */
  sample: number;
  note: string;
}

export interface OperationalMeasures {
  since: number | null;
  partial: boolean;
  measures: Measure[];
}

const MINUTE = 60_000;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const round = (value: number | null, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const before = (event: QuestEvent) => (event.taskId ? event.undo?.tasks[event.taskId] : undefined);

/** Blocked → resolved durations, paired per task from the event history (oldest first). */
function blockedDurations(state: QuestState): number[] {
  const open = new Map<string, number>();
  const out: number[] = [];
  for (const event of [...state.events].reverse()) {
    if (event.undone || !event.taskId || event.kind !== 'help') continue;
    const prior = before(event);
    if (!prior) continue;
    if (prior.status !== 'blocked') open.set(event.taskId, event.at);
    else if (open.has(event.taskId)) { out.push(event.at - open.get(event.taskId)!); open.delete(event.taskId); }
  }
  return out;
}

const reopened = (state: QuestState) => state.events.filter(event => !event.undone && before(event)?.status === 'done' && event.kind === 'task').length;

export function operationalMeasures(state: QuestState, now: number, principal: string): OperationalMeasures {
  const oldest = state.events[state.events.length - 1];
  const partial = state.events.length >= 400;
  const responded = state.leads.filter(lead => lead.firstResponseAt !== null);
  const firstResponse = responded.map(lead => leadElapsed(lead, now) / MINUTE);
  const target = state.policy.leadResponseMinutes;
  const blocked = blockedDurations(state).map(ms => ms / (60 * MINUTE));
  const completed = state.tasks.filter((task: Task) => task.status === 'done');
  const history = new Map(handoffHistory(state).map(item => [item.taskId, item]));
  const reassignments = completed.map(task => history.get(task.id)?.reassignments ?? 0);
  const sendBacks = handoffHistory(state).reduce((sum, item) => sum + item.sendBacks, 0);
  const principalApprovals = state.events.filter(event => !event.undone && event.actor === principal && event.kind === 'approval' && before(event)?.status === 'review').length;
  const approvalsTotal = state.events.filter(event => !event.undone && event.kind === 'approval' && before(event)?.status === 'review').length;
  const desk = decisionDesk(state, now, principal).length;

  return {
    since: oldest?.at ?? null,
    partial,
    measures: [
      { key: 'lead-first-response', label: 'Lead first response (median)', value: round(median(firstResponse)), unit: 'minutes', sample: responded.length,
        note: responded.length ? `${responded.filter(lead => leadElapsed(lead, now) <= target * MINUTE).length} of ${responded.length} within the ${target}-minute target.` : 'No lead has a logged first response yet.' },
      { key: 'blocked-to-resolved', label: 'Blocked → resolved (median)', value: round(median(blocked)), unit: 'hours', sample: blocked.length,
        note: blocked.length ? 'From the help request to the blocker being cleared.' : 'No blocker has been resolved in the retained history.' },
      { key: 'stalled-now', label: 'Stalled right now', value: state.tasks.filter(task => isOpen(task) && isStalled(state, task, now)).length, unit: 'count', sample: state.tasks.filter(isOpen).length,
        note: `Open work with no activity for ${state.policy.stalledHours}h or more.` },
      { key: 'handoffs', label: 'Reassignments per completed task', value: completed.length ? round(reassignments.reduce((a, b) => a + b, 0) / completed.length, 2) : null, unit: 'per-task', sample: completed.length,
        note: completed.length ? 'Owner changes before completion.' : 'Nothing completed yet.' },
      { key: 'rework', label: 'Rework (sent back + reopened)', value: sendBacks + reopened(state), unit: 'count', sample: approvalsTotal + completed.length,
        note: `${sendBacks} sent back from review · ${reopened(state)} reopened after completion.` },
      { key: 'principal', label: 'Decisions waiting on you', value: desk, unit: 'count', sample: approvalsTotal,
        note: approvalsTotal ? `You made ${principalApprovals} of ${approvalsTotal} approval decisions in the retained history.` : 'No approvals recorded yet.' },
      { key: 'bid-readiness', label: 'Measurement → estimate ready', value: null, unit: 'hours', sample: 0,
        note: 'Not measured: Task-HQ has no measurement or estimating records yet.' },
    ],
  };
}
