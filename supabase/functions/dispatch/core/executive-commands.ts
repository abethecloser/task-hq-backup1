// Voice-first executive commands. Text is the working input today; a future
// voice adapter only has to turn speech into the same text (or command id) and
// read `spoken` aloud. No paid voice service is needed or called.
//
// Like parseIntent (intent.ts), nothing here changes state: answers are read-only
// and "assign" returns a proposal the UI must preview and confirm before apply().
import type { QuestState } from './contract.ts';
import { check } from './capabilities.ts';
import type { Intent } from './intent.ts';
import { normalize } from './intent.ts';
import { dailySignal, decisionDesk, executiveBrief, followUps, isSyntheticWorkspace, recommendOwner } from './executive.ts';
import type { SourceRef } from './executive.ts';
import { firstName, leadById, nameOf, taskById } from './selectors.ts';

export type ExecCommandId = 'holding-us-up' | 'who-needs-me' | 'what-happened' | 'assign' | 'summarize-day';

export interface ExecCommandInput {
  text: string;
  /** How the words arrived. Only 'text' is wired today. */
  modality: 'text' | 'voice';
  principal: string;
  now: number;
  /** The task or lead currently selected, for "this". */
  subject?: { taskId?: string; leadId?: string };
  /** Time of the previous briefing, for "what happened". */
  since?: number | null;
}

export type ExecResponse = Intent & {
  command: ExecCommandId | null;
  /** Short sentences suitable for reading aloud. */
  spoken: string;
  sources: SourceRef[];
};

export const EXEC_COMMANDS: { id: ExecCommandId; examples: string[] }[] = [
  { id: 'holding-us-up', examples: ['What’s holding us up?', 'What is blocked?', 'Any blockers?'] },
  { id: 'who-needs-me', examples: ['Who needs me?', 'What needs my decision?', 'What’s on my desk?'] },
  { id: 'what-happened', examples: ['What happened today?', 'What changed?', 'What did I miss?'] },
  { id: 'assign', examples: ['Assign this to the right person.', 'Who should own this?', 'Delegate this.'] },
  { id: 'summarize-day', examples: ['Summarize my day.', 'Brief me.', 'Give me the rundown.'] },
];

const GRAMMAR: { id: ExecCommandId; pattern: RegExp }[] = [
  { id: 'holding-us-up', pattern: /\b(holding (us|me|things) up|what(s| is) (blocked|stuck)|any blockers|blockers|whats stuck|bottlenecks?)\b/ },
  { id: 'who-needs-me', pattern: /\b(who needs me|needs? my (decision|approval|call)|on my desk|waiting (on|for) me|my decisions)\b/ },
  { id: 'what-happened', pattern: /\b(what happened|what changed|what did i miss|whats new|any changes)\b/ },
  { id: 'assign', pattern: /\b(assign (this|it)|who should (own|take|handle) (this|it)|delegate (this|it)|right person)\b/ },
  { id: 'summarize-day', pattern: /\b(summari[sz]e (my|the) day|brief me|briefing|rundown|my day)\b/ },
];

export function parseExecCommand(text: string): ExecCommandId | null {
  const normalized = normalize(text);
  return GRAMMAR.find(item => item.pattern.test(normalized))?.id ?? null;
}

const list = (items: string[], max = 3) => (items.length <= max ? items : [...items.slice(0, max), `and ${items.length - max} more`]);

export function runExecCommand(state: QuestState, input: ExecCommandInput): ExecResponse {
  const command = parseExecCommand(input.text);
  const { principal, now } = input;
  const reply = (answer: string, sources: SourceRef[] = [], spoken = answer): ExecResponse => ({ kind: 'query', answer, command, spoken, sources });
  const refuse = (message: string, ambiguous = false): ExecResponse => ({ kind: 'unsupported', message, ambiguous, command, spoken: message, sources: [] });

  switch (command) {
    case null:
      return refuse(`Try one of: ${EXEC_COMMANDS.map(item => `“${item.examples[0]}”`).join(', ')}.`, true);

    case 'holding-us-up': {
      const brief = executiveBrief(state, now, principal);
      const items = brief.sections.filter(section => section.key === 'blocked' || section.key === 'reassignment').flatMap(section => section.items);
      if (!items.length) return reply('Nothing is blocked and every open task has an owner.');
      const lines = items.map(item => `${item.text} — ${item.onDesk ? 'on your decision desk' : item.needsPrincipal ? 'needs you' : `with ${nameOf(state, item.handler, 'the team')}`}`);
      return reply(lines.join('\n'), items.map(item => item.source), `${items.length} thing(s) are holding work up. ${list(lines).join('. ')}.`);
    }

    case 'who-needs-me': {
      const desk = decisionDesk(state, now, principal);
      const mine = followUps(state, now, principal).filter(item => item.needsPrincipal && !desk.some(decision => decision.source.id === item.source.id));
      if (!desk.length && !mine.length) return reply('Nobody is waiting on you right now.');
      const lines = [
        ...desk.map(item => `${item.what} Waiting: ${item.waiting.map(who => who.label).join(', ') || 'nobody yet'}.`),
        ...mine.map(item => `${item.what} ${item.suggestion}`),
      ];
      return reply(lines.join('\n'), [...desk.map(item => item.source), ...mine.map(item => item.source)], `${lines.length} item(s) need you. ${list(lines).join(' ')}`);
    }

    case 'what-happened': {
      const signal = dailySignal(state, now);
      // “today” asks for the day; otherwise “what happened” means since the last briefing, when known.
      const brief = input.since != null && !/\btoday\b/.test(normalize(input.text)) ? executiveBrief(state, now, principal, { since: input.since }) : null;
      const changes = brief?.sections.find(section => section.key === 'changes');
      if (changes) {
        if (!changes.items.length) return reply('Nothing has changed since your last briefing.');
        const lines = changes.items.map(item => item.text);
        return reply([...lines, ...(changes.note ? [changes.note] : [])].join('\n'), changes.items.map(item => item.source), `${lines.length} change(s) since your last briefing. ${list(lines).join(' ')}`);
      }
      return reply([signal.summary, ...signal.entries.map(item => item.text)].join('\n'), signal.entries.map(item => item.source), signal.summary);
    }

    case 'summarize-day': {
      const brief = executiveBrief(state, now, principal);
      const signal = dailySignal(state, now);
      const lines = [brief.headline, ...brief.sections.filter(section => section.items.length || section.status !== 'ok').map(section => `${section.label}: ${section.status === 'not-connected' ? 'not connected' : section.items.length}`), signal.summary];
      return reply(lines.join('\n'), brief.sections.flatMap(section => section.items.map(item => item.source)), `${brief.headline} ${signal.summary}`);
    }

    case 'assign': {
      const task = input.subject?.taskId ? taskById(state, input.subject.taskId) : undefined;
      const lead = input.subject?.leadId ? leadById(state, input.subject.leadId) : undefined;
      if (!task && !lead) return refuse('Select a task or lead first, then say “assign this to the right person”.');
      const pick = recommendOwner(state, { task, lead }, [principal, task?.owner ?? lead?.assignee ?? '']);
      if (!pick) return refuse('Nobody else in this workspace can take it.');
      const subject = task ? { taskId: task.id } : { leadId: lead!.id };
      const result = check(state, principal, now, task ? 'task.handoff' : 'lead.assign', subject, { label: `Assign ${firstName(state, pick.personId)}`, preset: { person: pick.personId }, ask: task ? ['note'] : [] });
      if (!result.ok) return refuse(`Task-HQ won’t allow that right now: ${result.error}`);
      const what = task ? `“${task.title}”` : lead!.name;
      const preview = `Assign ${what} to ${nameOf(state, pick.personId)} (${pick.reason})? Nothing changes until you confirm.`;
      return { kind: 'action', offer: result.offer, preview, command, spoken: preview, sources: [{ kind: task ? 'task' : 'lead', id: task ? task.id : lead!.id, synthetic: isSyntheticWorkspace(state) || !!lead?.simulated }] };
    }
  }
}
