// Deterministic local intelligence. No model, network or subscription involved:
// every insight comes from a named rule over QuestState and the current time.
import type { Action, QuestState } from './contract.ts';
import { SECTION_LABELS } from './contract.ts';
import { apply } from './engine.ts';
import {
  blockingDeps, canDecideGrants, dependents, firstName, isOpen, isOverdue, isStalled, leadElapsed, nameOf, peopleWithRole, taskById,
} from './selectors.ts';
import { MINUTE, duration } from './time.ts';
import { presetFor } from './workspace.ts';

export type InsightKind =
  | 'ultra-request' | 'ultra-expiring' | 'lead-response' | 'lead-unassigned' | 'lead-blocked'
  | 'blocked' | 'approval' | 'overdue' | 'dependency-ready' | 'unassigned' | 'handoff-gap'
  | 'missing-next-action' | 'stalled';

export type Severity = 'critical' | 'high' | 'normal';

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  /** What happened. */
  what: string;
  /** Why it matters. */
  why: string;
  /** What can be done. */
  next: string;
  /** Who should act next ('' = anyone / the team). */
  who: string;
  taskId?: string;
  leadId?: string;
  grantId?: string;
  /** One-click action, when the rule has an unambiguous one. */
  action?: { label: string; do: Action };
}

export const INSIGHT_LABELS: Record<InsightKind, string> = {
  'ultra-request': 'Access decisions',
  'ultra-expiring': 'Temporary access ending',
  'lead-response': 'Leads waiting for first response',
  'lead-unassigned': 'Unassigned leads',
  'lead-blocked': 'Stuck leads',
  blocked: 'Blocked work',
  approval: 'Approvals needed',
  overdue: 'Overdue',
  'dependency-ready': 'Ready to start',
  unassigned: 'No owner',
  'handoff-gap': 'Handoffs with no next owner',
  'missing-next-action': 'Missing a next action',
  stalled: 'Stalled',
};

const ORDER: Record<Severity, number> = { critical: 0, high: 1, normal: 2 };

function coordinator(state: QuestState) {
  return peopleWithRole(state, 'coordinator')[0]?.id ?? peopleWithRole(state, 'manager')[0]?.id ?? '';
}

function manager(state: QuestState) {
  return peopleWithRole(state, 'manager')[0]?.id ?? '';
}

export function insights(state: QuestState, now: number): Insight[] {
  const out: Insight[] = [];
  const policy = state.policy;

  // Ultra Priority access and expiry.
  for (const grant of state.grants) {
    const task = taskById(state, grant.taskId);
    if (grant.status === 'pending') {
      // Never the requester: nobody approves their own access.
      const deciders = state.people.filter(item => item.id !== grant.requester && canDecideGrants(state, item.id));
      const decider = (deciders.find(item => item.role === 'manager') ?? deciders[0])?.id ?? '';
      out.push({
        id: `grant-${grant.id}`, kind: 'ultra-request', severity: 'critical', grantId: grant.id, taskId: grant.taskId, who: decider,
        what: `${nameOf(state, grant.requester)} asked for ${SECTION_LABELS[grant.section]} while in Critical Focus.`,
        why: `They are locked to “${task?.title ?? 'the critical task'}” until someone decides. Reason given: “${grant.reason}”.`,
        next: `Approve for ${duration(policy.grantSeconds * 1000)} or deny.`,
        action: canDecideGrants(state, decider) ? { label: `Approve ${duration(policy.grantSeconds * 1000)}`, do: { type: 'grant/decide', id: grant.id, approve: true } } : undefined,
      });
    }
    if (grant.status === 'approved' && grant.expiresAt && grant.expiresAt > now && grant.expiresAt - now <= 20_000) {
      out.push({
        id: `expiring-${grant.id}`, kind: 'ultra-expiring', severity: 'high', grantId: grant.id, taskId: grant.taskId, who: grant.requester,
        what: `Access to ${SECTION_LABELS[grant.section]} ends in ${duration(grant.expiresAt - now)}.`,
        why: 'When it ends Task-HQ returns to the critical task automatically.',
        next: 'Finish what you opened it for, or return now.',
        action: { label: 'Return now', do: { type: 'grant/return', id: grant.id } },
      });
    }
  }

  // Speed to lead.
  for (const lead of state.leads) {
    if (lead.stage === 'lost' || lead.stage === 'won') continue;
    const target = policy.leadResponseMinutes * MINUTE;
    if (!lead.firstResponseAt) {
      const elapsed = leadElapsed(lead, now);
      const late = elapsed > target;
      if (!lead.assignee) {
        out.push({
          id: `lead-unassigned-${lead.id}`, kind: 'lead-unassigned', severity: 'critical', leadId: lead.id, who: manager(state),
          what: `${lead.name} has been waiting ${duration(elapsed)} with nobody assigned.`,
          why: `Nobody owns the first response. Target is ${policy.leadResponseMinutes} min.`,
          next: 'Assign a sales owner now.',
          action: peopleWithRole(state, 'sales')[0] ? { label: `Assign ${firstName(state, peopleWithRole(state, 'sales')[0]!.id)}`, do: { type: 'lead/assign', id: lead.id, to: peopleWithRole(state, 'sales')[0]!.id } } : undefined,
        });
      } else {
        out.push({
          id: `lead-response-${lead.id}`, kind: 'lead-response', severity: late ? 'critical' : 'high', leadId: lead.id, who: lead.assignee,
          what: late ? `${lead.name} is past the ${policy.leadResponseMinutes}-minute response target (${duration(elapsed)}).` : `${lead.name} needs a first response — ${duration(target - elapsed)} left on the target.`,
          why: 'The first company to respond usually wins the job.',
          next: `${firstName(state, lead.assignee)} contacts them, then logs the attempt.`,
        });
      }
    }
    if (lead.stage === 'blocked' || lead.stage === 'escalated') {
      out.push({
        id: `lead-blocked-${lead.id}`, kind: 'lead-blocked', severity: 'high', leadId: lead.id, who: lead.escalatedTo || manager(state),
        what: lead.stage === 'escalated' ? `${lead.name} was escalated.` : `${lead.name} is blocked: “${lead.blocker}”.`,
        why: 'A responsive lead goes cold when nobody owns the decision.',
        next: `Decide the next step: schedule a follow-up or ${presetFor(state).leadHandoffAction.toLowerCase()}.`,
      });
    }
  }

  for (const task of state.tasks) {
    if (!isOpen(task)) continue;
    const owner = task.owner;

    if (task.status === 'blocked') {
      const helper = task.blocker?.helper ?? '';
      out.push({
        id: `blocked-${task.id}`, kind: 'blocked', severity: task.ultra || task.priority === 'high' ? 'critical' : 'high', taskId: task.id, who: helper || coordinator(state),
        what: `“${task.title}” is blocked${task.blocker ? ` for ${duration(now - task.blocker.at)}` : ''}.`,
        why: `${firstName(state, task.blocker?.by ?? owner, 'Someone')} asked: “${task.blocker?.note ?? 'needs help'}”.${dependents(state, task).length ? ` ${dependents(state, task).length} task(s) wait behind it.` : ''}`,
        next: `${helper ? firstName(state, helper) : 'Someone on the team'} helps, then marks the blocker resolved.`,
      });
    }

    if (task.status === 'review') {
      out.push({
        id: `approval-${task.id}`, kind: 'approval', severity: 'high', taskId: task.id, who: task.approver || manager(state),
        what: `“${task.title}” is waiting for ${nameOf(state, task.approver, 'an approver')}’s approval.`,
        why: dependents(state, task).length ? `It unlocks ${dependents(state, task).map(item => `“${item.title}”`).join(', ')}.` : `${firstName(state, owner)} can’t close it until it’s approved.`,
        next: 'Approve, or send it back with a note.',
        action: { label: 'Approve & complete', do: { type: 'task/advance', id: task.id } },
      });
    }

    if (isOverdue(task, now)) {
      out.push({
        id: `overdue-${task.id}`, kind: 'overdue', severity: 'high', taskId: task.id, who: owner || coordinator(state),
        what: `“${task.title}” was due ${task.due}.`,
        why: task.leadId ? 'This is a customer follow-up; a missed follow-up loses the lead.' : 'Late work pushes everything after it.',
        next: owner ? `${firstName(state, owner)} finishes it or moves the date with a reason.` : 'Give it an owner and a realistic date.',
      });
    }

    if (task.status === 'ready' && task.dependsOn.length > 0 && blockingDeps(state, task).length === 0 && owner) {
      out.push({
        id: `ready-${task.id}`, kind: 'dependency-ready', severity: 'normal', taskId: task.id, who: owner,
        what: `“${task.title}” is ready to start.`,
        why: `Everything it was waiting on is done.`,
        next: `${firstName(state, owner)} starts it.`,
        action: { label: 'Start work', do: { type: 'task/advance', id: task.id } },
      });
    }

    if (!owner) {
      out.push({
        id: `unassigned-${task.id}`, kind: 'unassigned', severity: task.priority === 'high' ? 'high' : 'normal', taskId: task.id, who: coordinator(state),
        what: `“${task.title}” has no owner.`,
        why: 'Work without an owner doesn’t move, and nobody is told when it unlocks.',
        next: 'Assign someone who can do it.',
      });
    }

    if (task.status !== 'review' && dependents(state, task).some(item => !item.owner) && !task.nextOwner) {
      out.push({
        id: `handoff-${task.id}`, kind: 'handoff-gap', severity: 'normal', taskId: task.id, who: coordinator(state),
        what: `When “${task.title}” finishes, nobody is set to pick up the next step.`,
        why: `${dependents(state, task).filter(item => !item.owner).map(item => `“${item.title}”`).join(', ')} has no owner.`,
        next: 'Set a next-step owner so the handoff happens on completion.',
      });
    }

    if (!task.nextAction.trim() && task.status !== 'blocked') {
      out.push({
        id: `next-${task.id}`, kind: 'missing-next-action', severity: 'normal', taskId: task.id, who: owner || coordinator(state),
        what: `“${task.title}” has no next action.`,
        why: 'Without a concrete first step it’s easy to put off.',
        next: 'Write the next physical action (one line).',
      });
    }

    if (isStalled(state, task, now)) {
      out.push({
        id: `stalled-${task.id}`, kind: 'stalled', severity: 'normal', taskId: task.id, who: owner || coordinator(state),
        what: `“${task.title}” hasn’t moved in ${duration(now - task.lastActivityAt)}.`,
        why: `Nothing has changed for over ${state.policy.stalledHours}h.`,
        next: 'Move it forward, ask for help, or hand it off.',
      });
    }
  }

  // A one-click action is shown only when the engine would accept it from the person asked
  // to act (Critical Focus, dependencies and roles all apply), so no button is a dead end.
  return out
    .map(item => (item.action && !(item.who && apply(state, item.action.do, { actor: item.who, now, newId: () => 'dry-run' }).ok) ? { ...item, action: undefined } : item))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export function insightsFor(state: QuestState, now: number, actor: string) {
  return insights(state, now).filter(item => item.who === actor);
}

