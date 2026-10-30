import type { Action, QuestEvent, QuestState } from './contract.ts';
export type FeedbackSignature = 'task-created' | 'task-completed' | 'assignment' | 'handoff' | 'approval-requested' | 'approval-decided' | 'priority' | 'ultra-on' | 'ultra-off' | 'lead-new' | 'lead-claimed' | 'lead-overdue' | 'escalation' | 'reversed' | 'saved' | 'denied' | 'failed';
export type FeedbackPhase = 'acknowledged' | 'processing' | 'confirmed' | 'denied' | 'failed' | 'incoming' | 'attention' | 'reversed';
export interface FeedbackCue { id: string; signature: FeedbackSignature; phase: FeedbackPhase; text: string; taskId?: string; leadId?: string; at: number; passive: boolean; count: number }
export const FEEDBACK: Record<FeedbackSignature, { label: string; icon: string; motion: string; urgent: boolean; notes: number[] }> = {
  'task-created': { label: 'Task created', icon: '+', motion: 'activate', urgent: false, notes: [660, 880] },
  'task-completed': { label: 'Task completed', icon: '✓', motion: 'complete', urgent: false, notes: [660, 990, 1320] },
  assignment: { label: 'Assignment changed', icon: '↗', motion: 'transfer', urgent: false, notes: [520, 780] },
  handoff: { label: 'Work handed off', icon: '⇢', motion: 'transfer', urgent: false, notes: [440, 660, 880] },
  'approval-requested': { label: 'Approval requested', icon: '◇', motion: 'activate', urgent: false, notes: [740, 740] },
  'approval-decided': { label: 'Approval decided', icon: '◆', motion: 'complete', urgent: false, notes: [740, 1100] },
  priority: { label: 'High priority activated', icon: '!', motion: 'activate', urgent: true, notes: [880, 1100] },
  'ultra-on': { label: 'Ultra Priority active', icon: '◉', motion: 'activate', urgent: true, notes: [440, 880, 1320] },
  'ultra-off': { label: 'Ultra Priority released', icon: '○', motion: 'reverse', urgent: false, notes: [880, 440] },
  'lead-new': { label: 'New lead available', icon: '+', motion: 'activate', urgent: false, notes: [880, 1046] },
  'lead-claimed': { label: 'Lead claimed', icon: '⌁', motion: 'transfer', urgent: false, notes: [520, 1040] },
  'lead-overdue': { label: 'Lead response overdue', icon: '!', motion: 'interrupt', urgent: true, notes: [440, 440] },
  escalation: { label: 'Escalation recorded', icon: '↑', motion: 'interrupt', urgent: true, notes: [660, 880, 660] },
  reversed: { label: 'Change reversed', icon: '↶', motion: 'reverse', urgent: false, notes: [880, 660] },
  saved: { label: 'Change saved', icon: '·', motion: 'settle', urgent: false, notes: [880] },
  denied: { label: 'Action denied', icon: '×', motion: 'interrupt', urgent: true, notes: [220, 165] },
  failed: { label: 'Save not confirmed', icon: '!', motion: 'interrupt', urgent: true, notes: [180, 140] },
};
export function feedbackSignature(action: Action, before: QuestState, after?: QuestState): FeedbackSignature {
  switch (action.type) {
    case 'task/create': return 'task-created';
    case 'task/update': return action.changes.priority === 'high' && before.tasks.find(t => t.id === action.id)?.priority !== 'high' ? 'priority' : action.changes.owner !== undefined ? 'assignment' : 'saved';
    case 'task/handoff': case 'lead/advance': return 'handoff';
    case 'task/send-back': return 'approval-decided';
    case 'task/advance': {
      const old = before.tasks.find(t => t.id === action.id), next = after?.tasks.find(t => t.id === action.id);
      return next?.status === 'done' ? old?.status === 'review' ? 'approval-decided' : 'task-completed' : next?.status === 'review' ? 'approval-requested' : old && !old.owner ? 'assignment' : 'saved';
    }
    case 'ultra/activate': return 'ultra-on'; case 'ultra/release': return 'ultra-off';
    case 'lead/receive': return 'lead-new'; case 'lead/claim': return 'lead-claimed'; case 'lead/assign': return 'assignment';
    case 'lead/escalate': return 'escalation'; case 'undo': case 'task/reopen': return 'reversed';
    default: return 'saved';
  }
}
export function actionTarget(action: Action): { taskId?: string; leadId?: string } {
  const id = 'id' in action ? action.id : 'taskId' in action ? action.taskId : undefined;
  return action.type.startsWith('lead/') ? { leadId: id } : { taskId: id };
}
interface SeenStore { load(): string[]; save(ids: string[]): void }
export function createFeedbackEngine(store?: SeenStore) {
  const seen = new Set(store?.load() ?? []); let initialized = false, sequence = 0;
  const remember = (id: string) => { seen.add(id); while (seen.size > 1200) seen.delete(seen.values().next().value!); store?.save([...seen]); };
  return {
    begin(action: Action, now: number): FeedbackCue { return { id: `action-${++sequence}`, signature: 'saved', phase: 'acknowledged', text: 'Action received', ...actionTarget(action), at: now, passive: false, count: 1 }; },
    processing(cue: FeedbackCue): FeedbackCue { return { ...cue, phase: 'processing', text: 'Checking and saving…' }; },
    settle(cue: FeedbackCue, action: Action, before: QuestState, result: { ok: boolean; state?: QuestState; eventId?: string | null; message?: string; error?: string }, now: number): FeedbackCue {
      if (result.ok && result.eventId) remember(result.eventId);
      const failed = !result.ok && /confirm|network|server|session|retry|could not|couldn.t|not saved/i.test(result.error ?? '');
      const signature = result.ok ? feedbackSignature(action, before, result.state) : failed ? 'failed' : 'denied';
      const event = result.eventId ? result.state?.events.find(e => e.id === result.eventId) : undefined;
      return { ...cue, id: result.eventId ?? `${cue.id}-result`, signature, phase: !result.ok ? failed ? 'failed' : 'denied' : signature === 'reversed' ? 'reversed' : 'confirmed', text: result.ok ? result.message ?? FEEDBACK[signature].label : result.error ?? 'Save not confirmed.', taskId: event?.taskId ?? cue.taskId, leadId: event?.leadId ?? cue.leadId, at: now };
    },
    observe(state: QuestState, actor: string, now: number): FeedbackCue[] {
      const incoming: FeedbackCue[] = [];
      if (!state.people.some(p => p.id === actor)) return incoming;
      const focused = state.focus?.employee === actor;
      const visible = (e: QuestEvent) => !focused || e.taskId === state.focus?.taskId;
      for (const e of [...state.events].reverse()) {
        if (seen.has(e.id)) continue;
        remember(e.id);
        if (!initialized || e.actor === actor || e.undone || !visible(e) || now - e.at > 15000 || e.at > now + 1000) continue;
        const signature = e.feedback ?? (e.kind === 'handoff' ? 'handoff' : e.kind === 'approval' ? 'approval-requested' : 'saved');
        incoming.push({ id: e.id, signature, phase: 'incoming', text: e.text, taskId: e.taskId, leadId: e.leadId, at: e.at, passive: true, count: 1 });
      }
      for (const lead of state.leads) {
        if (lead.firstResponseAt || ['won', 'lost'].includes(lead.stage) || now - lead.arrivedAt <= state.policy.leadResponseMinutes * 60000) continue;
        const id = `overdue:${lead.id}:${lead.arrivedAt}`;
        if (seen.has(id)) continue;
        remember(id);
        if (initialized && !focused) incoming.push({ id, signature: 'lead-overdue', phase: 'attention', text: `${lead.name} is past the ${state.policy.leadResponseMinutes} minute response target.`, leadId: lead.id, at: now, passive: true, count: 1 });
      }
      initialized = true;
      return incoming;
    },
  };
}
/** One batch produces one passive notice; source records still retain every event. */
export function coalesceFeedback(cues: FeedbackCue[]): FeedbackCue | null {
  if (!cues.length) return null;
  const ordered = [...cues].sort((a, b) => Number(FEEDBACK[b.signature].urgent) - Number(FEEDBACK[a.signature].urgent) || b.at - a.at);
  return { ...ordered[0]!, count: cues.reduce((n, c) => n + c.count, 0), text: cues.length > 1 ? `${cues.length} incoming changes · ${FEEDBACK[ordered[0]!.signature].label}` : ordered[0]!.text };
}

export function feedbackPolicy(cue: FeedbackCue, preferences: { reducedMotion: boolean; muted: boolean; audioArmed: boolean; haptics: boolean }) {
  const settled = !['acknowledged', 'processing'].includes(cue.phase);
  const noticeable = !cue.passive || FEEDBACK[cue.signature].urgent;
  return { motion: preferences.reducedMotion ? 'none' : FEEDBACK[cue.signature].motion, audio: settled && noticeable && !preferences.muted && preferences.audioArmed, haptic: settled && noticeable && preferences.haptics };
}
