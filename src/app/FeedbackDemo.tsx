// Disposable synthetic control board. Uses the real adapter/engine and shared sensory
// layer; never touches the selected workspace, Auth, memberships, or remote storage.
import { useMemo } from 'react';
import type { QuestBackend } from '../adapter/store.ts';
import { processAction, STATE_KEY } from '../adapter/store.ts';
import type { QuestState } from '../core/contract.ts';
import { blankLead, blankTask, seedState } from '../core/seed.ts';
import { FeedbackBar, FeedbackProvider, feedbackAttributes } from '../ui/Feedback.tsx';
import { TaskTags } from '../ui/components.tsx';
import { useQuest } from '../ui/useQuest.ts';
import type { Quest } from '../ui/useQuest.ts';
function backend(): QuestBackend {
  const now = Date.now(), seed = seedState(now);
  let state: QuestState = { ...seed, workspace: { ...seed.workspace, tenantId: 'synthetic-feedback-lab', name: 'Synthetic control board' }, events: [], grants: [], focus: null,
    tasks: [blankTask('demo-completion', { title: 'Synthetic task completion', owner: 'jordan' }, 'jordan', now), blankTask('demo-priority', { title: 'Synthetic priority & Ultra focus', owner: 'alex' }, 'jordan', now), blankTask('demo-handoff', { title: 'Synthetic handoff', owner: 'jordan' }, 'jordan', now)],
    leads: [blankLead('demo-lead', { name: 'Synthetic inquiry', source: 'Control-board fixture', phone: '', address: '', need: 'Local claim demonstration' }, now)] };
  state.tasks[0]!.status = 'working';
  const listeners = new Set<(s: QuestState) => void>();
  const data = new Map<string, unknown>([[STATE_KEY, state]]);
  const kv = { async get<T>(key: string) { return (data.get(key) as T) ?? null; }, async set(key: string, value: unknown) { data.set(key, value); } };
  return { kind: 'browser', authority: 'local-demo', label: 'Synthetic feedback lab', detail: 'Memory-only fixture. No production data.', load: async () => state,
    async dispatch(action, actor) { const r = await processAction(kv, action, actor, 'sensory-lab'); if (r.ok) { state = r.state; listeners.forEach(fn => fn(state)); } return r; },
    tick: async () => {}, subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getActor: async () => 'jordan', setActor: async () => {}, subscribeActor: () => () => {}, outboxCount: async () => 0 };
}
export function FeedbackDemo() {
  const store = useMemo(backend, []), result = useQuest('sensory-lab', store);
  if (!result.state || !result.actor) return <p>Loading synthetic control board…</p>;
  const quest = result as Quest;
  const { state, dispatch } = quest;
  return <FeedbackProvider feedback={quest.feedback}><section className="panel feedback-demo" aria-label="Synthetic sensory feedback demonstration"><h3>Operational feedback · synthetic control board</h3><p className="boundary">Six real engine transitions on disposable, memory-only fixtures. No accounts, access or live workspace records change. Reopen this demo to start fresh.</p><FeedbackBar quest={quest} />
    <div className="feedback-demo-buttons">
      <button className="btn btn-sm" disabled={state.tasks[0]!.status === 'done'} onClick={() => void dispatch({ type: 'task/advance', id: 'demo-completion' })}>1 · Complete task</button>
      <button className="btn btn-sm" disabled={state.tasks[1]!.priority === 'high'} onClick={() => void dispatch({ type: 'task/update', id: 'demo-priority', changes: { priority: 'high' } })}>2 · Activate high priority</button>
      <button className="btn btn-sm btn-primary" onClick={() => void dispatch(state.focus ? { type: 'ultra/release', reason: 'Synthetic demo release' } : { type: 'ultra/activate', taskId: 'demo-priority' })}>3 · {state.focus ? 'Release Ultra' : 'Activate Ultra'}</button>
      <button className="btn btn-sm" disabled={!!state.leads[0]!.assignee} onClick={() => void dispatch({ type: 'lead/claim', id: 'demo-lead' })}>4 · Claim lead</button>
      <button className="btn btn-sm" disabled={state.tasks[2]!.owner === 'maya'} onClick={() => void dispatch({ type: 'task/handoff', id: 'demo-handoff', to: 'maya', note: 'Synthetic handoff to Maya' })}>5 · Hand off to Maya</button>
      <button className="btn btn-sm" onClick={() => void dispatch({ type: 'task/update', id: 'demo-handoff', changes: { owner: 'not-a-member' } })}>6 · Try denied assignment</button>
    </div><div className="feedback-demo-records">{state.tasks.map(t => <div {...feedbackAttributes(quest.feedback.record(t.id))} key={t.id} data-feedback-record={t.id}><strong>{t.title}</strong><span>{t.status} · {state.people.find(p => p.id === t.owner)?.name}</span><TaskTags state={state} task={t} now={quest.now} /></div>)}<div {...feedbackAttributes(quest.feedback.record('demo-lead'))}><strong>Synthetic inquiry</strong><span>{state.leads[0]!.assignee ? 'Claimed by Jordan' : 'Available to claim'}</span></div></div>
  </section></FeedbackProvider>;
}
