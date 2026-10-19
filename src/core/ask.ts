// "Ask your tasks": plain questions answered from records the asker can already see.
// Deterministic and read-only: it matches a handful of intents and never dispatches.
// Without company access (Critical Focus, or no Company Work), answers cover only the
// asker's own work, and questions about other people are declined.
import type { QuestState, Task } from './contract.ts';
import { atRisk, performance, teamWorkload } from './dashboard.ts';
import { blockingDeps, compareTasks, firstName, isOpen, isOverdue, myTasks } from './selectors.ts';
import { localDate } from './time.ts';

export const ASK_SUGGESTIONS = ["What's overdue?", 'What did I finish this week?', "Who's busiest right now?"];

const MAX_LISTED = 3;

function list(state: QuestState, tasks: Task[], withOwner: boolean) {
  const shown = tasks.slice(0, MAX_LISTED).map(task => `“${task.title}”${withOwner ? ` (${firstName(state, task.owner)})` : ''}`);
  const more = tasks.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function answer(state: QuestState, actor: string, now: number, question: string, company: boolean): string {
  const q = question.toLowerCase().trim();
  if (!q) return 'Ask about overdue work, what you finished, what is due, what is blocked, or who is busiest.';
  const visible = state.tasks.filter(task => isOpen(task) && (company || task.owner === actor)).sort(compareTasks(now));
  const scope = company ? 'across the team' : 'on your work';

  const words = new Set(q.split(/[^a-z0-9']+/).map(word => word.replace(/'s$/, '')));
  const named = state.people.find(item => item.id !== actor && words.has(firstName(state, item.id).toLowerCase()));
  if (named) {
    if (!company) return 'I can only answer about your own work right now.';
    const theirs = visible.filter(task => task.owner === named.id);
    if (!theirs.length) return `${firstName(state, named.id)} has nothing open.`;
    const late = theirs.filter(task => isOverdue(task, now)).length;
    return `${firstName(state, named.id)} has ${plural(theirs.length, 'open task')}${late ? `, ${late} late` : ''}: ${list(state, theirs, false)}.`;
  }

  if (/overdue|late|past due/.test(q)) {
    const overdue = visible.filter(task => isOverdue(task, now));
    if (!overdue.length) return `Nothing is overdue ${scope}.`;
    return `${plural(overdue.length, 'task is', 'tasks are')} overdue ${scope}: ${list(state, overdue, company)}.`;
  }
  if (/finish|complete|done/.test(q)) {
    const period = /month/.test(q) ? 'month' : /today/.test(q) ? 'today' : 'week';
    const { completed } = performance(state, actor, now, period);
    const span = period === 'today' ? 'today' : `this ${period}`;
    return completed ? `You completed ${plural(completed, 'task')} ${span}.` : `You haven't completed any tasks ${span} yet.`;
  }
  if (/busiest|workload|most work|who has/.test(q)) {
    if (!company) return 'I can only answer about your own work right now.';
    const [first, second] = teamWorkload(state, now);
    if (!first) return 'Nobody has open work right now.';
    const late = (n: number) => (n ? `, ${n} late` : '');
    return `${first.name} has the most open work: ${first.open} open${late(first.late)}.${second ? ` Next is ${second.name} with ${second.open} open${late(second.late)}.` : ''}`;
  }
  if (/block|stuck|waiting/.test(q)) {
    const stuck = visible.filter(task => task.status === 'blocked' || blockingDeps(state, task).length > 0);
    if (!stuck.length) return `Nothing is blocked ${scope}.`;
    return `${plural(stuck.length, 'task is', 'tasks are')} blocked or waiting ${scope}: ${list(state, stuck, company)}.`;
  }
  if (/risk|attention/.test(q)) {
    const risky = atRisk(state, actor, now, company);
    if (!risky.length) return `Nothing is at risk ${scope}.`;
    return `${plural(risky.length, 'task needs', 'tasks need')} attention ${scope}: ${list(state, risky.map(item => item.task), company)}.`;
  }
  if (/due|today|tomorrow/.test(q)) {
    const day = localDate(/tomorrow/.test(q) ? now + 86_400_000 : now);
    const due = myTasks(state, actor, now).filter(task => task.due === day);
    const when = /tomorrow/.test(q) ? 'tomorrow' : 'today';
    return due.length ? `${plural(due.length, 'of your tasks is', 'of your tasks are')} due ${when}: ${list(state, due, false)}.` : `Nothing of yours is due ${when}.`;
  }
  if (/next|should i|my work|my tasks/.test(q)) {
    const mine = myTasks(state, actor, now);
    if (!mine.length) return 'You have nothing open. Your queue is clear.';
    const top = mine[0]!;
    return `Start with “${top.title}”${top.nextAction ? `: ${top.nextAction}` : ''}. You have ${plural(mine.length, 'open task')}.`;
  }
  return "I can answer about overdue work, what you finished, what's due, what's blocked, what's at risk, and who is busiest.";
}
