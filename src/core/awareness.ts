// Live awareness: the three questions the sidebar pullout answers, kept as three distinct
// things rather than three filters over one list.
//
//   Inbox      What is addressed to me?  Notifications and messages, each read or unread.
//              The only one with unread state (the shared read set, by item id).
//   Attention  What is wrong right now?  Rule-based insights over current state. Reading
//              never resolves one: it leaves when its condition clears, or while a person
//              has snoozed it (only for kinds that are safe to defer).
//   Activity   What changed?             The event log, with automatic effects. Never
//              counted as unread and never a notification.
//
// Quick actions come from the rule's own action, offered only when the engine accepts it
// for this person right now (a dry run): no authority logic lives here.
import type { Action, QuestEvent, QuestState } from './contract.ts';
import { apply } from './engine.ts';
import type { Insight, InsightKind } from './rules.ts';
import { insights } from './rules.ts';
import { person } from './selectors.ts';

/** Kinds a person may defer. Access, approvals, leads, blockers and overdue work can't be hidden. */
export const SNOOZABLE: InsightKind[] = ['missing-next-action', 'stalled', 'dependency-ready', 'handoff-gap', 'unassigned'];

export interface Snooze { id: string; until: number }

export interface AttentionItem extends Insight {
  mine: boolean;
  /** The rule's one-click action, present only if the engine accepts it from this person now. */
  quick?: { label: string; do: Action };
  snoozable: boolean;
}

export interface Attention { items: AttentionItem[]; mine: number; snoozed: number }

export function attentionFor(state: QuestState, now: number, actor: string, snoozes: Snooze[] = []): Attention {
  const me = person(state, actor);
  const seeAll = me?.role === 'manager' || me?.role === 'coordinator';
  const active = new Set(snoozes.filter(item => item.until > now).map(item => item.id));
  let snoozed = 0;
  const items: AttentionItem[] = [];
  for (const insight of insights(state, now)) {
    const mine = insight.who === actor;
    const concernsMe = mine || (!!insight.taskId && state.tasks.some(task => task.id === insight.taskId && (task.owner === actor || task.approver === actor)));
    if (!seeAll && !concernsMe) continue;
    const snoozable = SNOOZABLE.includes(insight.kind);
    if (snoozable && active.has(insight.id)) { snoozed += 1; continue; }
    const quick = insight.action && me && me.role !== 'reviewer' && apply(state, insight.action.do, { actor, now, newId: () => 'dry-run' }).ok ? insight.action : undefined;
    items.push({ ...insight, mine, quick, snoozable });
  }
  items.sort((a, b) => Number(b.mine) - Number(a.mine));
  return { items, mine: items.filter(item => item.mine).length, snoozed };
}

export interface ActivityItem { event: QuestEvent; mine: boolean }

/** Recent changes, newest first. Undone events stay visible, marked as undone. */
export function activityFor(state: QuestState, actor: string, limit = 40): ActivityItem[] {
  return [...state.events]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(event => ({ event, mine: event.actor === actor || (!!event.taskId && state.tasks.some(task => task.id === event.taskId && task.owner === actor)) }));
}

/** Badge numbers: unread inbox items, and attention items that are this person's to act on. */
export function awarenessCounts(inboxUnread: number, attention: Attention) {
  return { inbox: inboxUnread, attention: attention.mine, total: inboxUnread + attention.mine };
}
