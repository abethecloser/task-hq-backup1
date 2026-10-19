import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, QuestState } from '../core/contract.ts';
import { coalesceFeedback, createFeedbackEngine } from '../core/feedback.ts';
import type { FeedbackCue } from '../core/feedback.ts';
import type { DispatchResult } from '../adapter/store.ts';
export function useFeedback(state: QuestState | null, actor: string, now: number) {
  const [cue, setCue] = useState<FeedbackCue | null>(null);
  const key = `tmhq.feedback.seen.${state?.workspace.tenantId ?? ''}.${actor}`;
  const engine = useMemo(() => createFeedbackEngine({ load: () => { try { return JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { return []; } }, save: ids => { try { sessionStorage.setItem(key, JSON.stringify(ids)); } catch { /* no storage: memory idempotency */ } } }), [key]);
  const pending = useRef(new Map<string, FeedbackCue>());
  const passiveQueue = useRef<FeedbackCue[]>([]), passiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const records = useRef(new Map<string, FeedbackCue>());
  const [recordRev, setRecordRev] = useState(0);
  const publish = useCallback((next: FeedbackCue) => { const target = next.taskId ?? next.leadId; if (target) { records.current.set(target, next); setRecordRev(n => n + 1); } setCue(next); }, []);
  useEffect(() => { setCue(null); records.current.clear(); pending.current.clear(); setRecordRev(n => n + 1); if (passiveTimer.current) clearTimeout(passiveTimer.current); passiveTimer.current = null; passiveQueue.current = []; return () => { if (passiveTimer.current) clearTimeout(passiveTimer.current); }; }, [key]);
  useEffect(() => {
    if (!state || !actor) return;
    const events = engine.observe(state, actor, now);
    for (const e of events) { const target = e.taskId ?? e.leadId; if (target) records.current.set(target, e); }
    if (events.length) {
      setRecordRev(n => n + 1); passiveQueue.current.push(...events);
      if (!passiveTimer.current) passiveTimer.current = setTimeout(() => { const passive = coalesceFeedback(passiveQueue.current); passiveQueue.current = []; passiveTimer.current = null; if (passive) setCue(current => current && !current.passive && Date.now() - current.at < 2500 ? current : passive); }, 240);
    }
  }, [state, actor, now, engine]);
  const begin = useCallback((action: Action) => { const c = engine.begin(action, Date.now()); pending.current.set(c.id, c); publish(c); return c; }, [engine, publish]);
  const processing = useCallback((c: FeedbackCue) => { if (pending.current.has(c.id)) publish(engine.processing(c)); }, [engine, publish]);
  const settle = useCallback((c: FeedbackCue, action: Action, before: QuestState, result: DispatchResult) => { pending.current.delete(c.id); publish(engine.settle(c, action, before, result, Date.now())); }, [engine, publish]);
  return { cue, pending: pending.current.size, recordRev, record: (id: string) => records.current.get(id), begin, processing, settle, dismiss: () => setCue(null) };
}
