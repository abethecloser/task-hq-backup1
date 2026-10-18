// Instrument registry: the only modules a deck layout may reference. A layout
// spec is plain data (ids, values, states); the renderer maps ids to its own
// components, so no input can introduce code, URLs or unregistered components.
import type { CapabilityId } from './capabilities.ts';

export type DeckContextKind = 'lead' | 'dependency' | 'focus' | 'task' | 'none';

export type InstrumentId =
  | 'priority-dial' | 'duration-fader' | 'action-rocker' | 'status-display'
  | 'context-timeline' | 'response-meter' | 'dependency-map' | 'access-panel';

export type ValueSchema =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'range'; min: number; max: number; step: number; unit: string }
  | { kind: 'none' };

export interface InstrumentDef {
  id: InstrumentId;
  title: string;
  contexts: DeckContextKind[];
  value: ValueSchema;
  states: readonly string[];
  /** Capability ids it can propose, or 'deck-setting' for local, non-business values. */
  actions: readonly (CapabilityId | 'deck-setting')[];
  /** What authorizes a change made through this instrument. */
  authorization: string;
  a11y: string;
}

export const PRIORITY_LEVELS = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;
export const DURATION_RANGE = { min: 5, max: 60, step: 5, unit: 'min' } as const;

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  'priority-dial': {
    id: 'priority-dial', title: 'Priority', contexts: ['lead', 'dependency', 'task', 'focus'],
    value: { kind: 'enum', values: PRIORITY_LEVELS }, states: ['adjustable', 'locked'],
    actions: ['deck-setting', 'task.priority'],
    authorization: 'P1–P5 is a deck designation stored on this device. Applying it to a task uses the engine’s task priority update (P1–P2 → High, P3–P5 → Normal). Leads have no priority field. Locked during Only Priority; a dial never grants focus authority.',
    a11y: 'Dial with five positions, P1 (highest) to P5. Arrow keys step, Home and End jump to the ends.',
  },
  'duration-fader': {
    id: 'duration-fader', title: 'Work interval', contexts: ['lead', 'dependency', 'task', 'focus'],
    value: { kind: 'range', ...DURATION_RANGE }, states: ['idle', 'running'],
    actions: ['deck-setting'],
    authorization: 'Personal work interval stored on this device. Never changes due dates, lead response targets or Only Priority access.',
    a11y: 'Slider from 5 to 60 minutes in 5-minute steps.',
  },
  'action-rocker': {
    id: 'action-rocker', title: 'Next action', contexts: ['lead', 'dependency', 'task', 'focus'],
    value: { kind: 'none' }, states: ['ready', 'none'],
    actions: ['lead.take', 'lead.attempt', 'lead.follow-up', 'lead.qualify', 'lead.advance', 'lead.escalate', 'task.advance', 'task.resolve', 'task.request-help', 'task.send-back'],
    authorization: 'Only positions the Task-HQ engine accepts for this person right now (dry run). Committing dispatches the same engine action.',
    a11y: 'Switch between the authorized next actions, then commit. Each commit shows a preview first when details are needed.',
  },
  'status-display': {
    id: 'status-display', title: 'Status', contexts: ['lead', 'dependency', 'task', 'focus'],
    value: { kind: 'none' }, states: ['local-demo', 'server-verified'], actions: [],
    authorization: 'Read only.', a11y: 'Owner, state, elapsed time, verified next step and where the data lives.',
  },
  'context-timeline': {
    id: 'context-timeline', title: 'Timeline', contexts: ['lead', 'dependency', 'task', 'focus'],
    value: { kind: 'none' }, states: ['history'], actions: [],
    authorization: 'Read only. Past entries come from Task-HQ’s event history; upcoming entries are authorized next actions, not completed work.',
    a11y: 'List of recorded events, newest first, followed by possible next steps.',
  },
  'response-meter': {
    id: 'response-meter', title: 'First response', contexts: ['lead'],
    value: { kind: 'none' }, states: ['within', 'over'], actions: [],
    authorization: 'Read only. Elapsed time since the lead arrived, against the policy target.',
    a11y: 'Time since the lead arrived compared with the response target.',
  },
  'dependency-map': {
    id: 'dependency-map', title: 'Handoff', contexts: ['dependency'],
    value: { kind: 'none' }, states: ['waiting', 'ready', 'handed-off'], actions: [],
    authorization: 'Read only. Built from task dependencies.', a11y: 'What this task waits on and what it unlocks, with owners.',
  },
  'access-panel': {
    id: 'access-panel', title: 'Access requests', contexts: ['focus'],
    value: { kind: 'none' }, states: ['can-request', 'pending', 'granted', 'none'], actions: ['grant.request'],
    authorization: 'Requests go through the engine; only an approver decides. Durations come from the policy, not from the deck.',
    a11y: 'Request temporary access to another part of Task-HQ, or see a pending or granted request.',
  },
};

export interface InstrumentSpec {
  id: string;
  instrument: InstrumentId;
  state: string;
  value?: string | number;
}

export interface DeckSpec {
  context: DeckContextKind;
  key: string;
  /** Changes whenever the composition should change, e.g. a lead moves stage. */
  signature: string;
  instruments: InstrumentSpec[];
}

/** Reject anything not in the registry or outside an instrument's declared schema. */
export function validateDeck(spec: DeckSpec): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of spec.instruments) {
    const def = (INSTRUMENTS as Record<string, InstrumentDef | undefined>)[item.instrument];
    if (!def) { errors.push(`Unknown instrument “${item.instrument}”.`); continue; }
    if (ids.has(item.id)) errors.push(`Duplicate instrument id “${item.id}”.`);
    ids.add(item.id);
    if (!def.contexts.includes(spec.context)) errors.push(`${def.id} is not allowed in ${spec.context} context.`);
    if (!def.states.includes(item.state)) errors.push(`${def.id} has no state “${item.state}”.`);
    const schema = def.value;
    if (schema.kind === 'none' && item.value !== undefined) errors.push(`${def.id} takes no value.`);
    if (schema.kind === 'enum' && !schema.values.includes(String(item.value))) errors.push(`${def.id} value must be one of ${schema.values.join(', ')}.`);
    if (schema.kind === 'range') {
      const n = Number(item.value);
      if (!Number.isFinite(n) || n < schema.min || n > schema.max || (n - schema.min) % schema.step !== 0) errors.push(`${def.id} value must be ${schema.min}–${schema.max} ${schema.unit} in steps of ${schema.step}.`);
    }
  }
  return errors;
}
