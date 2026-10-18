// Local, deterministic intent grammar for the deck's "What do you want to move forward?" strip.
// parseIntent never changes anything. It returns one of:
//   query       – a read-only answer from Quest data
//   setting     – a local deck preference change (priority designation, interval, personal focus)
//   action      – a proposed engine action; the UI must preview it and get confirmation
//   unsupported – a clear explanation (unknown, ambiguous, or refused by the engine)
import type { QuestState } from './contract.ts';
import { LEAD_STAGE_LABELS, STATUS_LABELS } from './contract.ts';
import { check } from './capabilities.ts';
import type { ActionOffer, CapabilityId, Values } from './capabilities.ts';
import type { DeckContext, DeckPrefs } from './deck.ts';
import { DURATION_RANGE } from './instruments.ts';
import { activeLeads, firstName, leadBucket, leadById, leadElapsed, nameOf, taskById } from './selectors.ts';
import { addDays, duration, localDate } from './time.ts';
import { presetFor } from './workspace.ts';

export type Intent =
  | { kind: 'query'; answer: string }
  | { kind: 'setting'; change: Partial<DeckPrefs>; summary: string }
  | { kind: 'action'; offer: ActionOffer; preview: string }
  | { kind: 'unsupported'; message: string; ambiguous?: boolean };

export const INTENT_EXAMPLES = [
  'Show my leads', 'Who owns this lead?', 'What should happen next?', 'Set priority to P2', 'Set 25 minutes',
  'Focus off', 'Record a contact attempt', 'Schedule a follow-up', 'Start this task', 'Show what this unlocks',
];

/** Examples that make sense for the current context. */
export function examplesFor(kind: DeckContext['kind']) {
  return kind === 'lead'
    ? ['Who owns this lead?', 'What should happen next?', 'Record a contact attempt', 'Schedule a follow-up', 'Set 15 minutes', 'Show my leads']
    : kind === 'none'
      ? ['Show my leads', 'Set 25 minutes', 'Focus off']
      : ['What should happen next?', 'Who owns this task?', 'Start this task', 'Show what this unlocks', 'Set priority to P2', 'Focus for 25 minutes'];
}

export function normalize(input: string) {
  return input.toLowerCase().replace(/[’']/g, '').replace(/[?.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const unsupported = (message: string, ambiguous = false): Intent => ({ kind: 'unsupported', message, ambiguous });

function propose(state: QuestState, ctx: DeckContext, now: number, capability: CapabilityId, label: string, preview: string, preset: Values = {}, ask?: string[]): Intent {
  const result = check(state, ctx.actor, now, capability, ctx.subject, { label, preset, ask });
  if (!result.ok) return unsupported(`Task-HQ won’t allow that right now: ${result.error}`);
  return { kind: 'action', offer: result.offer, preview };
}

export function parseIntent(input: string, ctx: DeckContext, state: QuestState, now: number, prefs: DeckPrefs): Intent {
  const text = normalize(input);
  if (!text) return unsupported('Type what you want to move forward, for example “What should happen next?”.', true);
  const lead = ctx.subject.leadId ? leadById(state, ctx.subject.leadId) : undefined;
  const task = ctx.subject.taskId ? taskById(state, ctx.subject.taskId) : undefined;
  const needSubject = () => unsupported('Select a lead or task first — click its card — then try again.');

  // ── Read-only queries ────────────────────────────────────────────────
  if (/^(show|list|see|open)( me)?( all)? (my )?leads$/.test(text) || text === 'my leads') {
    const mine = activeLeads(state).filter(item => item.assignee === ctx.actor || (!item.assignee && !item.firstResponseAt));
    if (!mine.length) return { kind: 'query', answer: 'No open leads are assigned to you or waiting for an owner.' };
    return { kind: 'query', answer: mine.map(item => `${item.name} — ${item.assignee ? (item.assignee === ctx.actor ? 'yours' : nameOf(state, item.assignee)) : 'unassigned'}, ${item.firstResponseAt ? LEAD_STAGE_LABELS[item.stage].toLowerCase() : `waiting ${duration(leadElapsed(item, now))}`}${leadBucket(state, item, now) === 'attention' ? ' (needs attention)' : ''}`).join('\n') };
  }
  if (/^who (owns|has|is assigned|is on|is responsible for)( to)?( this| the)?( lead| task| one)?$|^whose (lead|task) is this$|^who owns it$/.test(text)) {
    if (!lead && !task) return needSubject();
    if (lead) return { kind: 'query', answer: lead.assignee ? `${nameOf(state, lead.assignee)} owns ${lead.name}${lead.assignedAt ? `, assigned ${duration(now - lead.assignedAt)} ago` : ''}.` : `Nobody owns ${lead.name} yet. It arrived ${duration(now - lead.arrivedAt)} ago.` };
    return { kind: 'query', answer: task!.owner ? `${nameOf(state, task!.owner)} owns “${task!.title}” (${STATUS_LABELS[task!.status]}).${task!.nextOwner ? ` Next step goes to ${nameOf(state, task!.nextOwner)}.` : ''}` : `“${task!.title}” has no owner yet.` };
  }
  if (/^what (should|do i|must i|needs to|has to)?\s*(happen|do|be done)? ?next$|^whats next$|^next step$|^what now$|^what should i do$/.test(text)) {
    if (ctx.kind === 'none') return needSubject();
    return { kind: 'query', answer: ctx.actions.length ? `Next authorized step for you: ${ctx.actions[0]!.label}.${ctx.actions.length > 1 ? ` Also possible: ${ctx.actions.slice(1).map(item => item.label).join(', ')}.` : ''}` : ctx.nextStep || 'There is no action for you here right now.' };
  }
  if (/(show )?(what )?(this|it) unlocks$|^what happens after( this)?$|^what does (this|it) unlock$/.test(text)) {
    if (!task) return unsupported(lead ? `Leads don’t unlock tasks directly; “${presetFor(state).leadHandoffAction}” creates an ${presetFor(state).leadHandoffNoun}.` : 'Select a task first.');
    const after = state.tasks.filter(item => item.dependsOn.includes(task.id));
    return { kind: 'query', answer: after.length ? after.map(item => `“${item.title}” for ${nameOf(state, item.owner, 'nobody yet')} (${STATUS_LABELS[item.status]})`).join('\n') : `Nothing is waiting on “${task.title}”.${task.nextOwner ? ` It hands off to ${nameOf(state, task.nextOwner)}.` : ''}` };
  }

  // ── Local deck settings ──────────────────────────────────────────────
  const pLevel = text.match(/^(?:set |change |make )?(?:the )?(?:deck )?(?:priority|this|it)?(?: to| as| =)? ?p ?([1-5])$/) ?? text.match(/^(?:set |change )?(?:the )?(?:deck )?priority (?:to |level |= ?)?(?:p ?)?([1-5])$/);
  if (pLevel) {
    if (ctx.kind === 'focus') return unsupported('Priority is fixed at P1 during Only Priority. A dial or command can’t change focus authority — a manager releases it.');
    const level = Number(pLevel[1]);
    return { kind: 'setting', change: { priority: level }, summary: `Deck priority set to P${level}.${lead ? ' The lead itself has no priority field, so nothing on the lead changes.' : task ? ` The task stays ${task.priority === 'high' ? 'High' : 'Normal'} unless you apply it.` : ''}` };
  }
  if (/^(set |change )?(the )?priority$/.test(text)) return unsupported('Which level? Try “Set priority to P2” (P1 is highest, P5 lowest).', true);
  const wordPriority = text.match(/^(?:make|set|mark) (?:this|it|the task)(?: as| to)? (high|normal|low) priority$|^(?:set )?priority (?:to )?(high|normal|low)$/);
  if (wordPriority) {
    const word = wordPriority[1] ?? wordPriority[2];
    if (!task) return unsupported('Leads have no priority field in Task-HQ. Use the deck dial (P1–P5) instead.');
    const target = word === 'high' ? 'high' : 'normal';
    return propose(state, ctx, now, 'task.priority', `Set task priority to ${target === 'high' ? 'High' : 'Normal'}`, `Change “${task.title}” from ${task.priority === 'high' ? 'High' : 'Normal'} to ${target === 'high' ? 'High' : 'Normal'} priority. This updates the task for everyone using this device’s Task-HQ data.`, { priority: target });
  }

  const minutes = text.match(/^(?:set |change )?(?:the )?(?:duration |interval |timer |deck )?(?:to |for )?(\d{1,3}) ?(?:m|min|mins|minute|minutes)(?: interval| timer)?$/)
    ?? text.match(/^(?:set )?(?:duration|interval|timer) (?:to )?(\d{1,3})$/);
  const focusFor = text.match(/^(?:focus|start (?:a )?focus|work) (?:for )?(\d{1,3}) ?(?:m|min|mins|minute|minutes)$/);
  const asked = minutes ?? focusFor;
  if (asked) {
    const value = Number(asked[1]);
    if (value < DURATION_RANGE.min || value > DURATION_RANGE.max) return unsupported(`The interval goes from ${DURATION_RANGE.min} to ${DURATION_RANGE.max} minutes.`);
    if (value % DURATION_RANGE.step) return unsupported(`Use ${DURATION_RANGE.step}-minute steps, for example ${Math.round(value / 5) * 5} minutes.`, true);
    const keep = lead ? ` The ${state.policy.leadResponseMinutes}-minute lead response target is unchanged.` : task ? ' The task’s due date is unchanged.' : '';
    if (focusFor) return { kind: 'setting', change: { durationMin: value, focus: { on: true, startedAt: now } }, summary: `Personal focus interval started: ${value} minutes. This doesn’t lock anything (it isn’t Only Priority).${keep}` };
    return { kind: 'setting', change: { durationMin: value }, summary: `Interval set to ${value} minutes.${keep}` };
  }
  if (/^(set |change )?(the )?(duration|interval|timer|minutes)$/.test(text)) return unsupported('How many minutes? Try “Set 25 minutes” (5–60, in 5-minute steps).', true);
  if (/^(focus off|stop (the )?focus|end (the )?focus|turn (the )?focus off|turn off focus|no focus)$/.test(text)) return { kind: 'setting', change: { focus: { on: false, startedAt: null } }, summary: 'Personal focus is off. Navigation was never restricted by it; Only Priority is separate.' };
  if (/^(focus( on)?|start (a )?focus|turn (the )?focus on)$/.test(text)) return { kind: 'setting', change: { focus: { on: true, startedAt: now } }, summary: `Personal focus interval started: ${prefs.durationMin} minutes. Nothing is locked.` };

  // ── Proposed engine actions (preview + confirm in the UI) ────────────
  if (/^(record|log|add|enter)( a| the)?( new)? (contact( attempt)?|call|attempt|response)$|^i (called|texted|emailed|reached|phoned)( them| the lead)?$/.test(text)) {
    if (!lead) return unsupported('Contact attempts belong to leads. Select a lead first.');
    const channel = /texted/.test(text) ? 'text' : /emailed/.test(text) ? 'email' : /(called|phoned)/.test(text) ? 'phone' : undefined;
    return propose(state, ctx, now, 'lead.attempt', 'Record contact attempt',
      `Record a contact attempt on ${lead.name} by ${nameOf(state, ctx.actor)}.${lead.firstResponseAt ? '' : ` It will count as the first response (${duration(now - lead.arrivedAt)} after arrival).`} This only logs what you did — Task-HQ will not call, text or email anyone.`,
      channel ? { channel } : {}, ['channel', 'outcome', 'note']);
  }
  const follow = text.match(/^(schedule|prepare|plan|set up|book|create)( a| the)?( lead)? follow ?-?up( for (today|tomorrow|next week))?$/);
  if (follow) {
    if (!lead) return unsupported('Follow-ups here are for leads. Select a lead first.');
    const when = follow[5] === 'today' ? localDate(now) : follow[5] === 'tomorrow' ? addDays(now, 1) : follow[5] === 'next week' ? addDays(now, 7) : undefined;
    return propose(state, ctx, now, 'lead.follow-up', 'Schedule follow-up',
      `Create a follow-up task for ${lead.name}, owned by ${nameOf(state, lead.assignee || ctx.actor)}${when ? ` on ${when}` : ''}. Pick the date before confirming.`, when ? { date: when } : {}, ['date', 'note']);
  }
  if (/^(start|begin)( this| the)?( task| work)?$|^start work$/.test(text)) {
    if (!task) return unsupported(lead ? 'Leads aren’t started — record a contact attempt instead.' : 'Select a task first.');
    if (task.status !== 'ready' || !task.owner) return unsupported(`“${task.title}” is ${STATUS_LABELS[task.status].toLowerCase()}${task.owner ? '' : ' and has no owner'}; it can’t be started now.`);
    return propose(state, ctx, now, 'task.advance', 'Start work', `Mark “${task.title}” as Working.`);
  }
  if (/^(complete|finish|mark (this|it) (done|complete))( this| the)?( task)?$/.test(text)) {
    if (!task) return needSubject();
    return propose(state, ctx, now, 'task.advance', 'Move work forward', `Move “${task.title}” forward from ${STATUS_LABELS[task.status]}.`);
  }
  if (/^(assign (it |this |the lead )?to me|assign me|ill take (it|this)|take (it|this|this lead))$/.test(text)) {
    if (!lead) return unsupported('Select a lead first.');
    return propose(state, ctx, now, 'lead.take', 'Assign to me', `Make ${nameOf(state, ctx.actor)} the owner of ${lead.name}.`);
  }
  const assignTo = text.match(/^assign (?:it |this |the lead )?to ([a-z]+)$/);
  if (assignTo) {
    if (!lead) return unsupported('Select a lead first.');
    const person = state.people.find(item => item.name.toLowerCase().split(' ')[0] === assignTo[1]);
    if (!person) return unsupported(`There’s no “${assignTo[1]}” in this workspace. People: ${state.people.map(item => firstName(state, item.id)).join(', ')}.`);
    return propose(state, ctx, now, 'lead.assign', `Assign to ${person.name}`, `Make ${person.name} the owner of ${lead.name}.`, { person: person.id });
  }
  if (/^escalate( this| it| the lead)?$/.test(text)) {
    if (!lead) return unsupported('Escalation here is for leads. Select a lead first.');
    return propose(state, ctx, now, 'lead.escalate', 'Escalate', `Escalate ${lead.name} to a manager with your note.`, {}, ['note']);
  }
  if (/^(ask for help|i need help|get help)$/.test(text)) {
    if (!task) return unsupported('Select a task first.');
    return propose(state, ctx, now, 'task.request-help', 'Ask for help', `Mark “${task.title}” blocked and ask for help.`, {}, ['note', 'person']);
  }

  return unsupported(`I can’t do that from here. Task-HQ only understands a few local commands, for example: ${examplesFor(ctx.kind).slice(0, 4).map(item => `“${item}”`).join(', ')}.`);
}

