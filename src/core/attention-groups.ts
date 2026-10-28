// Needs Attention lists conditions. Several conditions often belong to one task (blocked,
// overdue and missing a next action, say), so the page shows each task once with all of its
// conditions beneath it. Pure presentation: nothing here adds, drops or changes a condition.
import type { QuestState } from './contract.ts';
import type { Insight, Severity } from './rules.ts';
import { leadById, projectName, taskById } from './selectors.ts';

export interface AttentionGroup {
  key: string;
  kind: 'task' | 'lead' | 'other';
  taskId?: string;
  leadId?: string;
  title: string;
  /** Project name for a task, when it has one. */
  context: string;
  severity: Severity;
  conditions: Insight[];
}

const RANK: Record<Severity, number> = { critical: 2, high: 1, normal: 0 };
const worst = (items: Insight[]): Severity => items.reduce<Severity>((best, item) => (RANK[item.severity] > RANK[best] ? item.severity : best), 'normal');

/** One group per task (or per lead; any other condition stands alone). Most urgent first. */
export function groupAttention(state: QuestState, conditions: Insight[]): AttentionGroup[] {
  const groups = new Map<string, Insight[]>();
  for (const item of conditions) {
    const key = item.taskId ? `task:${item.taskId}` : item.leadId ? `lead:${item.leadId}` : `other:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, items], order) => {
      const first = items[0]!;
      const task = first.taskId ? taskById(state, first.taskId) : undefined;
      const lead = !first.taskId && first.leadId ? leadById(state, first.leadId) : undefined;
      const group: AttentionGroup = {
        key,
        kind: first.taskId ? 'task' : first.leadId ? 'lead' : 'other',
        taskId: first.taskId, leadId: first.leadId,
        title: task?.title ?? lead?.name ?? first.what,
        context: task ? projectName(state, task.projectId) : '',
        severity: worst(items),
        conditions: items,
      };
      return { group, order };
    })
    .sort((a, b) => RANK[b.group.severity] - RANK[a.group.severity] || b.group.conditions.length - a.group.conditions.length || a.order - b.order)
    .map(entry => entry.group);
}

export interface AttentionTotals { tasks: number; leads: number; other: number; conditions: number }

/** Unique tasks and the condition total are different numbers; keep both visible. */
export function attentionTotals(groups: AttentionGroup[]): AttentionTotals {
  return {
    tasks: groups.filter(group => group.kind === 'task').length,
    leads: groups.filter(group => group.kind === 'lead').length,
    other: groups.filter(group => group.kind === 'other').length,
    conditions: groups.reduce((sum, group) => sum + group.conditions.length, 0),
  };
}
