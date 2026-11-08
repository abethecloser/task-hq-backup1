// Clarify: turn an unclear instruction already sitting on a task into a structured next action.
//
//   generate → refine → approve → commit
//
// Pure and local. Nothing here changes state. `clarify` proposes, `refine` folds in the person's
// answers, and `plan` dry-runs the result through the engine (the same rule capabilities.check
// uses) and returns the exact actions to apply once a human approves. The original wording is
// always preserved as a task comment, so a correction is traceable.
//
// The generator is replaceable. The default is deterministic and rule-based; a model-backed
// generator can be passed to `clarify` without changing refine/plan/commit or the approval step.
import type { Action, EditableTaskFields, QuestState, Task } from './contract.ts';
import { apply } from './engine.ts';
import { firstName, taskById } from './selectors.ts';

export type FieldSource = 'inferred' | 'answer';
export type QuestionId = 'what' | 'who' | 'detail';

export interface Question { id: QuestionId; ask: string; why: string }

export interface Clarification {
  taskId: string;
  /** The task's next-action text exactly as found. Never edited. */
  original: string;
  verdict: 'clear' | 'needs-work';
  /** Plain-language reasons the original is not yet actionable. */
  reasons: string[];
  proposal: { nextAction: string; source: FieldSource };
  /** Open questions. Empty means the proposal needs no more input before approval. */
  questions: Question[];
  answers: Partial<Record<QuestionId, string>>;
  /** The person wrote the final wording themselves, so open questions no longer gate approval. */
  revised?: boolean;
}

export type GeneratorOutput = Pick<Clarification, 'reasons' | 'proposal' | 'questions'>;
export type Generator = (task: Task, state: QuestState) => GeneratorOutput;
/**
 * The seam for any generator, rule-based today and model-backed later. It may be async and may
 * honour `signal`. Whatever it returns is validated by `checkGenerated` before anyone sees it, so a
 * provider can only ever propose; refine, plan and the engine still decide what is saved.
 */
export type ClarifyProvider = (task: Task, state: QuestState, signal?: AbortSignal) => GeneratorOutput | Promise<GeneratorOutput>;

export const MAX_NEXT_ACTION = 200;

const FILLER = /^\s*(?:(?:ok(?:ay)?|so|well|um+|uh+|hmm+|oh|yeah|right|alright)\b[\s.,!…-]*)+/i;
const HEDGE = /\b(?:or something|i guess|maybe|kind of|sort of|somehow|whatever|or whatever|i think)\b/i;
const TRAILING_TRAIL = /(?:\.{2,}|…)\s*$/;
const EXPLAINING = /\b[A-Za-z]+ (?:means|meant)\b/i;
const CHANNELS: [RegExp, string][] = [
  [/\bcall(?:ing)?\b|\bphone\b/i, 'Call'], [/\be-?mail\b/i, 'Email'], [/\btext\b|\bsms\b/i, 'Text'], [/\bvisit\b|\bdrive out\b|\bin person\b/i, 'Visit'],
];
const NAME_STOP = new Set(['okay', 'ok', 'oh', 'so', 'well', 'the', 'a', 'i', 'it', 'we', 'he', 'she', 'they', 'this', 'that', 'if', 'and', 'but', 'then', 'call', 'email', 'text']);

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Words that are probably people: capitalised and not opening a sentence. */
function nameMentions(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(^|[.!?]\s+|,\s*)?\b([A-Z][a-z]{2,})\b/g)) {
    const opensSentence = match[1] !== undefined && /[.!?]/.test(match[1]) || match.index === 0;
    const word = match[2]!;
    if (opensSentence || NAME_STOP.has(word.toLowerCase()) || found.includes(word)) continue;
    found.push(word);
  }
  return found;
}

/** Why the text is not yet a clear, doable next step. */
export function diagnose(text: string): string[] {
  const reasons: string[] = [];
  const body = text.trim();
  if (!body) return ['There is no next action yet.'];
  if (FILLER.test(body)) reasons.push('Starts mid-conversation rather than with an action.');
  if (EXPLAINING.test(body)) reasons.push('Explains what someone meant instead of saying what to do.');
  if (HEDGE.test(body)) reasons.push('Hedged (“or something”), so the actual step is a guess.');
  if (TRAILING_TRAIL.test(body)) reasons.push('Trails off, so the thought looks unfinished.');
  if (body.replace(FILLER, '').split(/\s+/).filter(Boolean).length < 2) reasons.push('Too short to say what to do.');
  return reasons;
}

export const ruleGenerator: Generator = (task, state) => {
  const text = task.nextAction.trim();
  const reasons = diagnose(text);
  const questions: Question[] = [];

  // Build the action from what the task already says: a channel in the text + the verb/object in the title.
  const channel = CHANNELS.find(([pattern]) => pattern.test(text))?.[1];
  const titled = /^(dispute|cancel|refund|confirm|schedule|follow up with|follow up on|pay|renew|reschedule)\s+(.+)$/i.exec(task.title.trim());
  let nextAction = text;
  if (reasons.length && channel && titled) {
    const [, verb, object] = titled;
    nextAction = `${channel} ${sentenceCase(object!)} to ${verb!.toLowerCase()}`;
  } else if (reasons.length) {
    nextAction = text.replace(FILLER, '').replace(TRAILING_TRAIL, '').replace(HEDGE, '').replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '').trim();
  }

  // Who? A name that matches nobody on the task is a question, not a guess.
  const roster = state.people.map(person => ({ id: person.id, first: firstName(state, person.id).toLowerCase() }));
  for (const mention of nameMentions(text)) {
    const lower = mention.toLowerCase();
    if (roster.some(person => person.first === lower)) continue;
    const near = roster.find(person => lower.length >= 4 && person.first.includes(lower));
    questions.push({
      id: 'who',
      ask: near ? `Does “${mention}” mean ${near.first.replace(/^./, character => character.toUpperCase())}, or someone else?` : `Who is “${mention}”?`,
      why: `“${mention}” is not a name Task-HQ can match for certain.`,
    });
    break;
  }
  if (reasons.length && channel) questions.push({ id: 'detail', ask: `What should the ${channel.toLowerCase()} cover — which charge, amount or order number?`, why: 'The step is inferred from the task title; the specifics are not in the text.' });
  if (reasons.length && !channel) questions.push({ id: 'what', ask: 'What is the one concrete thing to do next?', why: 'The text does not contain an action Task-HQ can recognise.' });

  return { reasons, proposal: { nextAction, source: 'inferred' }, questions };
};

/** Generate a proposal for a task's unclear next action. Null if the task is missing or has nothing to clarify. */
export function clarify(state: QuestState, taskId: string, generate: Generator = ruleGenerator): Clarification | null {
  const task = taskById(state, taskId);
  if (!task) return null;
  const made = generate(task, state);
  return { taskId, original: task.nextAction, verdict: made.reasons.length ? 'needs-work' : 'clear', ...made, answers: {} };
}

/** Fold the person's answers in. Answered questions close; an explicit `what` replaces the proposal. */
export function refine(current: Clarification, answers: Partial<Record<QuestionId, string>>): Clarification {
  const merged = { ...current.answers };
  for (const [key, value] of Object.entries(answers) as [QuestionId, string][]) if (value?.trim()) merged[key] = value.trim();
  let nextAction = current.proposal.nextAction;
  let source: FieldSource = current.proposal.source;
  if (merged.what) { nextAction = merged.what; source = 'answer'; }
  else if (merged.detail) { nextAction = `${nextAction.replace(/\s+—\s+.*$/, '')} — ${merged.detail}`; source = 'answer'; }
  const questions = current.questions.filter(question => !merged[question.id]);
  return { ...current, answers: merged, proposal: { nextAction, source }, questions, verdict: questions.length ? 'needs-work' : 'clear' };
}

/** Should Task-HQ offer to clarify this task? Open work whose next action exists but reads as unfinished. */
export function isAmbiguous(task: Pick<Task, 'status' | 'nextAction'>): boolean {
  return task.status !== 'done' && task.nextAction.trim().length > 0 && diagnose(task.nextAction).length > 0;
}

const QUESTION_IDS: readonly QuestionId[] = ['what', 'who', 'detail'];
const text = (value: unknown, max: number, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`The suggestion had no ${label}.`);
  if (value.trim().length > max) throw new Error(`The suggested ${label} was too long.`);
  return value.trim();
};

/**
 * Gate for anything a provider returns. A provider can only propose wording and questions: the
 * source is always forced to 'inferred', sizes are bounded, unknown question ids are dropped, and
 * a malformed result throws so the caller shows an error instead of a half-built draft.
 */
export function checkGenerated(output: GeneratorOutput): GeneratorOutput {
  if (!output || typeof output !== 'object' || !output.proposal || !Array.isArray(output.reasons) || !Array.isArray(output.questions)) throw new Error('The suggestion was not in a form Task-HQ can use.');
  const seen = new Set<QuestionId>();
  const questions: Question[] = [];
  for (const question of output.questions.slice(0, 6)) {
    if (!QUESTION_IDS.includes(question?.id) || seen.has(question.id)) continue;
    seen.add(question.id);
    questions.push({ id: question.id, ask: text(question.ask, 200, 'question'), why: typeof question.why === 'string' ? question.why.trim().slice(0, 200) : '' });
  }
  return {
    reasons: output.reasons.filter((reason): reason is string => typeof reason === 'string' && !!reason.trim()).slice(0, 6).map(reason => reason.trim().slice(0, 200)),
    proposal: { nextAction: text(output.proposal.nextAction, MAX_NEXT_ACTION, 'next action'), source: 'inferred' },
    questions,
  };
}

/** Async entry point for any provider. Null if the task is gone or the request was cancelled. */
export async function clarifyWith(state: QuestState, taskId: string, provider: ClarifyProvider = ruleGenerator, signal?: AbortSignal): Promise<Clarification | null> {
  const task = taskById(state, taskId);
  if (!task) return null;
  const made = checkGenerated(await provider(task, state, signal));
  if (signal?.aborted) return null;
  return { taskId, original: task.nextAction, verdict: made.reasons.length ? 'needs-work' : 'clear', ...made, answers: {} };
}

/** The person writes the final wording themselves. It is theirs, so open questions stop gating approval. */
export function revise(current: Clarification, nextAction: string): Clarification {
  return { ...current, proposal: { nextAction, source: 'answer' }, questions: [], verdict: 'clear', revised: true };
}

export interface FieldChange { field: keyof EditableTaskFields; from: string; to: string }

export type PlanFailure = 'missing' | 'stale' | 'open-questions' | 'empty' | 'unchanged' | 'too-long' | 'refused';
export type Plan =
  | { ok: true; changes: FieldChange[]; actions: Action[] }
  | { ok: false; code: PlanFailure; error: string };

const refuse = (code: PlanFailure, error: string): Plan => ({ ok: false, code, error });

/**
 * What approving would do, checked against the engine first so an approval is never offered for
 * something the engine would refuse for this person. Still applies nothing.
 */
export function plan(state: QuestState, current: Clarification, actor: string, now: number): Plan {
  const task = taskById(state, current.taskId);
  if (!task) return refuse('missing', 'That task no longer exists.');
  if (task.nextAction !== current.original) return refuse('stale', 'The next action changed since this was drafted. Draft it again from the new wording.');
  if (current.questions.length) return refuse('open-questions', 'Answer the open questions first.');
  const to = current.proposal.nextAction.trim();
  if (!to) return refuse('empty', 'Write the next action first.');
  if (to.length > MAX_NEXT_ACTION) return refuse('too-long', `Keep the next action under ${MAX_NEXT_ACTION} characters.`);
  if (to === task.nextAction) return refuse('unchanged', 'There is nothing to change.');
  const answered = (Object.entries(current.answers) as [QuestionId, string][]).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
  const actions: Action[] = [
    { type: 'task/comment', id: task.id, note: `Next action clarified. Was: “${current.original || '(empty)'}”${answered.length ? ` Answers — ${answered.join('; ')}.` : ''}` },
    { type: 'task/update', id: task.id, changes: { nextAction: to } },
  ];
  let probe = state;
  for (const action of actions) {
    const result = apply(probe, action, { actor, now, newId: () => 'dry-run' });
    if (!result.ok) return refuse('refused', result.error);
    probe = result.state;
  }
  return { ok: true, changes: [{ field: 'nextAction', from: task.nextAction, to }], actions };
}
