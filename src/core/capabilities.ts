// Capability registry: every action Quest can offer, independent of how the
// person expresses it. An input adapter (click, keyboard, typed text today;
// voice, images, recordings or approved services later) only has to produce
// a capability id + subject + values. The engine still decides what is allowed.
import type { Action, ContactChannel, ContactOutcome, QuestState, Section } from './contract.ts';
import { SECTION_LABELS } from './contract.ts';
import { apply } from './engine.ts';
import { localDate } from './time.ts';

export type Modality = 'click' | 'keyboard' | 'text' | 'voice' | 'image' | 'recording' | 'service';

/** Input adapters. Only active ones are wired; future ones are declared, not built. */
export const INPUT_ADAPTERS: { modality: Modality; status: 'active' | 'future'; note: string }[] = [
  { modality: 'click', status: 'active', note: 'Buttons and structured choices on every surface.' },
  { modality: 'keyboard', status: 'active', note: 'Shortcuts on the work surface (M, H, U, A, Esc).' },
  { modality: 'text', status: 'active', note: 'Typed notes: help requests, next actions, send-back reasons.' },
  { modality: 'voice', status: 'future', note: 'Would map speech to the same capability ids. Not implemented.' },
  { modality: 'image', status: 'future', note: 'Would attach photos as evidence to a capability. Not implemented.' },
  { modality: 'recording', status: 'future', note: 'Not implemented. No passive capture.' },
  { modality: 'service', status: 'future', note: 'Only through a separately authorized, versioned interface.' },
];

export type CapabilityId =
  | 'task.advance' | 'task.request-help' | 'task.resolve' | 'task.send-back' | 'task.handoff' | 'task.next-action' | 'task.priority'
  | 'ultra.activate' | 'grant.request'
  | 'lead.take' | 'lead.assign' | 'lead.attempt' | 'lead.qualify' | 'lead.follow-up' | 'lead.advance' | 'lead.escalate' | 'lead.block'
  | 'undo';

export interface InputSpec {
  name: string;
  kind: 'text' | 'person' | 'date' | 'choice';
  label: string;
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
}

export interface Subject { taskId?: string; leadId?: string; eventId?: string }
export type Values = Record<string, string>;

interface Capability {
  modalities: Modality[];
  inputs: InputSpec[];
  build(subject: Subject, values: Values, actor: string): Action | null;
}

const NOTE = (label: string, placeholder: string, required: boolean): InputSpec => ({ name: 'note', kind: 'text', label, placeholder, required });
const OUTCOMES = [{ value: 'reached', label: 'Reached them' }, { value: 'no-answer', label: 'No answer' }, { value: 'left-message', label: 'Left a message' }];
const CHANNELS = [{ value: 'phone', label: 'Phone' }, { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }, { value: 'in-person', label: 'In person' }];

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  'task.advance': { modalities: ['click', 'keyboard'], inputs: [], build: s => (s.taskId ? { type: 'task/advance', id: s.taskId } : null) },
  'task.request-help': {
    modalities: ['click', 'text'],
    inputs: [NOTE('What’s blocking it?', 'e.g. need the gate code', true), { name: 'person', kind: 'person', label: 'Ask', required: false }],
    build: (s, v) => (s.taskId ? { type: 'task/request-help', id: s.taskId, note: v.note ?? '', helper: v.person ?? '' } : null),
  },
  'task.resolve': { modalities: ['click', 'text'], inputs: [NOTE('How was it sorted? (optional)', 'e.g. code is 4411', false)], build: (s, v) => (s.taskId ? { type: 'task/resolve', id: s.taskId, note: v.note } : null) },
  'task.send-back': { modalities: ['click', 'text'], inputs: [NOTE('What needs to change?', 'Be specific', true)], build: (s, v) => (s.taskId ? { type: 'task/send-back', id: s.taskId, note: v.note ?? '' } : null) },
  'task.handoff': {
    modalities: ['click', 'text'],
    inputs: [{ name: 'person', kind: 'person', label: 'Hand to', required: true }, NOTE('What they should do first', 'One line', false)],
    build: (s, v) => (s.taskId && v.person ? { type: 'task/handoff', id: s.taskId, to: v.person, note: v.note } : null),
  },
  'task.next-action': { modalities: ['click', 'text'], inputs: [NOTE('Next physical step', 'e.g. call the supplier', true)], build: (s, v) => (s.taskId ? { type: 'task/update', id: s.taskId, changes: { nextAction: v.note ?? '' } } : null) },
  // Explicit mapping target for deck priority: only 'high' | 'normal' exist on tasks.
  'task.priority': { modalities: ['click', 'text'], inputs: [], build: (s, v) => (s.taskId && (v.priority === 'high' || v.priority === 'normal') ? { type: 'task/update', id: s.taskId, changes: { priority: v.priority } } : null) },
  'ultra.activate': { modalities: ['click'], inputs: [], build: s => (s.taskId ? { type: 'ultra/activate', taskId: s.taskId } : null) },
  'grant.request': {
    modalities: ['click', 'text'],
    inputs: [{ name: 'section', kind: 'choice', label: 'Access to', required: true, options: (Object.keys(SECTION_LABELS) as Section[]).map(value => ({ value, label: SECTION_LABELS[value] })) }, NOTE('Why (linked to this task)', 'What you need', true)],
    build: (_s, v) => ({ type: 'grant/request', section: (v.section ?? 'company-work') as Section, reason: v.note ?? '' }),
  },
  'lead.take': { modalities: ['click', 'keyboard'], inputs: [], build: (s, _v, actor) => (s.leadId ? { type: 'lead/claim', id: s.leadId } : null) },
  'lead.assign': { modalities: ['click'], inputs: [{ name: 'person', kind: 'person', label: 'Assign to', required: true }], build: (s, v) => (s.leadId && v.person ? { type: 'lead/assign', id: s.leadId, to: v.person } : null) },
  'lead.attempt': {
    modalities: ['click', 'keyboard', 'text'],
    inputs: [{ name: 'channel', kind: 'choice', label: 'How', required: true, options: CHANNELS }, { name: 'outcome', kind: 'choice', label: 'What happened', required: true, options: OUTCOMES }, NOTE('Note (optional)', 'e.g. available after 2pm', false)],
    build: (s, v) => (s.leadId ? { type: 'lead/attempt', id: s.leadId, channel: (v.channel ?? 'phone') as ContactChannel, outcome: (v.outcome ?? 'reached') as ContactOutcome, note: v.note } : null),
  },
  'lead.qualify': { modalities: ['click'], inputs: [], build: s => (s.leadId ? { type: 'lead/qualify', id: s.leadId } : null) },
  'lead.follow-up': { modalities: ['click'], inputs: [{ name: 'date', kind: 'date', label: 'Follow up on', required: true }, NOTE('Next step (optional)', 'e.g. send the quote', false)], build: (s, v) => (s.leadId && v.date ? { type: 'lead/follow-up', id: s.leadId, due: v.date, note: v.note } : null) },
  'lead.advance': { modalities: ['click'], inputs: [], build: s => (s.leadId ? { type: 'lead/advance', id: s.leadId } : null) },
  'lead.escalate': { modalities: ['click', 'text'], inputs: [NOTE('Why escalate?', 'What the manager needs to decide', true)], build: (s, v) => (s.leadId ? { type: 'lead/escalate', id: s.leadId, note: v.note ?? '' } : null) },
  'lead.block': { modalities: ['click', 'text'], inputs: [NOTE('What is blocking this lead?', 'e.g. waiting on insurance adjuster', true)], build: (s, v) => (s.leadId ? { type: 'lead/block', id: s.leadId, note: v.note ?? '' } : null) },
  undo: { modalities: ['click', 'keyboard'], inputs: [], build: s => (s.eventId ? { type: 'undo', eventId: s.eventId } : null) },
};

export interface ActionOffer {
  key: string;
  capability: CapabilityId;
  label: string;
  subject: Subject;
  /** Values fixed by the situation (e.g. outcome "reached"). */
  preset: Values;
  /** Inputs still to collect from the person, in order. */
  inputs: InputSpec[];
  tone: 'primary' | 'secondary' | 'quiet';
  hint?: string;
  /** Keyboard shortcut on the work surface. */
  shortcut?: string;
}

function sampleFor(input: InputSpec, state: QuestState, actor: string, now: number) {
  if (!input.required) return '';
  if (input.kind === 'text') return 'sample';
  if (input.kind === 'date') return localDate(now);
  if (input.kind === 'person') return state.people.find(item => item.id !== actor && item.role !== 'reviewer')?.id ?? actor;
  return input.options?.[0]?.value ?? '';
}

/**
 * Offer a capability only if the authoritative engine would accept it right now
 * (dry run with placeholder values). The composition layer can never invent permissions.
 */
type OfferOptions = { label: string; preset?: Values; tone?: ActionOffer['tone']; hint?: string; shortcut?: string; ask?: string[] };

/** Like offer(), but explains a refusal with the engine's own reason. */
export function check(state: QuestState, actor: string, now: number, capability: CapabilityId, subject: Subject, options: OfferOptions): { ok: true; offer: ActionOffer } | { ok: false; error: string } {
  const cap = CAPABILITIES[capability];
  const preset = options.preset ?? {};
  // Inputs left out of `ask` keep a fixed sample value (or the preset) instead of being collected.
  const inputs = cap.inputs.filter(input => !(input.name in preset) && (!options.ask || options.ask.includes(input.name)));
  const sample: Values = { ...Object.fromEntries(cap.inputs.map(input => [input.name, sampleFor(input, state, actor, now)])), ...preset };
  const action = cap.build(subject, sample, actor);
  if (!action) return { ok: false, error: 'That action needs something Task-HQ doesn’t have here.' };
  const dry = apply(state, action, { actor, now, newId: () => 'dry-run' });
  if (!dry.ok) return { ok: false, error: dry.error };
  const fixed = Object.fromEntries(cap.inputs.filter(input => !inputs.includes(input) && !(input.name in preset)).map(input => [input.name, sample[input.name]!]));
  return { ok: true, offer: { key: `${capability}:${subject.taskId ?? subject.leadId ?? subject.eventId ?? ''}:${options.label}`, capability, label: options.label, subject, preset: { ...fixed, ...preset }, inputs, tone: options.tone ?? 'secondary', hint: options.hint, shortcut: options.shortcut } };
}

export function offer(state: QuestState, actor: string, now: number, capability: CapabilityId, subject: Subject, options: OfferOptions): ActionOffer | null {
  const result = check(state, actor, now, capability, subject, options);
  return result.ok ? result.offer : null;
}

/** Turn an accepted offer plus collected values into the engine action. */
export function actionFor(offerItem: ActionOffer, values: Values, actor: string): Action | null {
  return CAPABILITIES[offerItem.capability].build(offerItem.subject, { ...offerItem.preset, ...values }, actor);
}
