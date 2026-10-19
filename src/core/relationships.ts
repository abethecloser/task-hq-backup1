import type { QuestState } from './contract.ts';

/** Derived from persisted outcomes; no mutable score or activity counter. */
export function responseLeague(state: QuestState) {
  const points = new Map<string, number>();
  const add = (id: string, amount: number) => { if (id) points.set(id, (points.get(id) ?? 0) + amount); };
  for (const lead of state.leads) {
    const reached = lead.attempts.find(a => a.outcome === 'reached');
    if (reached) add(reached.by, 10);
    for (const [id, reward] of [[lead.followUpTaskId, 20], [lead.handoffTaskId, 30]] as const) {
      const task = state.tasks.find(t => t.id === id && t.leadId === lead.id);
      if (task?.status === 'done') add(task.owner, reward);
    }
  }
  return state.people.filter(p => p.role !== 'reviewer').map(p => ({ id: p.id, name: p.name, points: points.get(p.id) ?? 0 })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
