// Sidebar notifications are a read-only projection of data the actor is already
// authorized to see: tasks, leads, handoff events, insights and the decision desk.
// Nothing here is persisted or sent; "unread" is local presentation state only.
import type { QuestState } from '../core/contract.ts';
import { decisionDesk } from '../core/executive.ts';
import { insights } from '../core/rules.ts';
import { firstName, inFocus, isOpen, nameOf, person, taskById } from '../core/selectors.ts';
import type { Severity } from '../core/rules.ts';

export type NotificationKind = 'assignment' | 'handoff' | 'approval' | 'escalation' | 'deadline' | 'decision';
export type NotificationSection = 'my-work' | 'needs-attention' | 'leads' | 'executive';

export interface Notification {
  id: string;
  kind: NotificationKind;
  section: NotificationSection;
  severity: Severity;
  title: string;
  detail: string;
  at: number;
  target: { taskId?: string; leadId?: string; view?: 'needs-attention' };
}

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  assignment: 'Assignment', handoff: 'Handoff', approval: 'Approval', escalation: 'Escalation', deadline: 'Lead deadline', decision: 'Decision',
};

const RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };

export function notificationsFor(state: QuestState, now: number, actor: string): Notification[] {
  const me = person(state, actor);
  if (!me || me.role === 'reviewer') return [];
  const out: Notification[] = [];
  const seen = new Set<string>();
  const push = (item: Notification) => { if (!seen.has(item.id)) { seen.add(item.id); out.push(item); } };

  const latestHandoff = new Map<string, { id: string; at: number; actor: string; text: string }>();
  for (const event of state.events) {
    if (event.kind !== 'handoff' || event.undone || !event.taskId || event.actor === actor) continue;
    const previous = latestHandoff.get(event.taskId);
    if (!previous || event.at > previous.at) latestHandoff.set(event.taskId, event);
  }

  for (const task of state.tasks) {
    if (!isOpen(task)) continue;
    const priority: Severity = task.priority === 'high' ? 'high' : 'normal';
    if (task.owner === actor) {
      const handoff = latestHandoff.get(task.id);
      if (handoff) {
        push({ id: `handoff-${handoff.id}`, kind: 'handoff', section: 'my-work', severity: priority, title: `${firstName(state, handoff.actor)} handed you “${task.title}”`, detail: task.nextAction || handoff.text, at: handoff.at, target: { taskId: task.id } });
      } else if (task.createdBy && task.createdBy !== actor) {
        push({ id: `assign-${task.id}`, kind: 'assignment', section: 'my-work', severity: priority, title: `${firstName(state, task.createdBy)} assigned you “${task.title}”`, detail: task.nextAction || 'Open the task to see the next step.', at: task.createdAt, target: { taskId: task.id } });
      }
    } else if (task.nextOwner === actor) {
      push({ id: `next-${task.id}`, kind: 'handoff', section: 'my-work', severity: 'normal', title: `You are next on “${task.title}”`, detail: `${nameOf(state, task.owner, 'Nobody')} has it now; it hands off to you.`, at: task.lastActivityAt, target: { taskId: task.id } });
    }
  }

  for (const item of decisionDesk(state, now, actor)) {
    const task = item.source.kind === 'task' ? taskById(state, item.source.id) : undefined;
    const kind: NotificationKind = item.kind === 'approval' ? 'approval' : item.kind === 'escalated-lead' ? 'escalation' : 'decision';
    const target = item.source.kind === 'lead' ? { leadId: item.source.id }
      : task ? { taskId: task.id }
      : { view: 'needs-attention' as const };
    push({ id: `decision-${item.id}`, kind, section: 'executive', severity: item.urgency, title: item.what, detail: item.delay, at: item.since, target });
  }

  const covered = new Set(out.map(item => item.target.taskId).filter(Boolean));
  for (const item of insights(state, now)) {
    if (item.who !== actor) continue;
    if ((item.kind === 'lead-response' || item.kind === 'lead-unassigned') && item.leadId) {
      push({ id: `insight-${item.id}`, kind: 'deadline', section: 'leads', severity: item.severity, title: item.what, detail: item.next, at: now, target: { leadId: item.leadId } });
    } else if (item.kind === 'lead-blocked' && item.leadId) {
      push({ id: `insight-${item.id}`, kind: 'escalation', section: 'needs-attention', severity: item.severity, title: item.what, detail: item.next, at: now, target: { leadId: item.leadId } });
    } else if ((item.kind === 'blocked' || item.kind === 'overdue') && item.taskId && !covered.has(item.taskId)) {
      push({ id: `insight-${item.id}`, kind: 'escalation', section: 'needs-attention', severity: item.severity, title: item.what, detail: item.next, at: now, target: { taskId: item.taskId } });
    }
  }

  const focusTask = inFocus(state, actor) ? state.focus?.taskId : undefined;
  const visible = focusTask ? out.filter(item => item.target.taskId === focusTask) : out;
  return visible.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.at - a.at || a.id.localeCompare(b.id));
}
