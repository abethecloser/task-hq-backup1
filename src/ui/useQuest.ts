import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, QuestState } from '../core/contract.ts';
import { pickBackend } from '../adapter/store.ts';
import type { QuestBackend } from '../adapter/store.ts';
import type { DispatchResult } from '../adapter/store.ts';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
  undoId?: string;
}

const DEFAULT_ACTOR = 'alex';

export function useQuest(writer: string, override?: QuestBackend) {
  const backend = useMemo(() => override ?? pickBackend(writer), [writer, override]);
  const [state, setState] = useState<QuestState | null>(null);
  const [actor, setActorState] = useState('');
  const [now, setNow] = useState(Date.now);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loadError, setLoadError] = useState('');
  const toastId = useRef(0);
  const stateRef = useRef<QuestState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let alive = true;
    backend.load().then(loaded => { if (alive) setState(current => (current && current.rev > loaded.rev ? current : loaded)); })
      .catch(error => setLoadError(error instanceof Error ? error.message : 'Task-HQ could not load its data.'));
    backend.getActor().then(id => {
      if (!id) void backend.setActor(DEFAULT_ACTOR); // persist so the background worker knows who is working
      if (alive) setActorState(id || DEFAULT_ACTOR);
    });
    const offState = backend.subscribe(next => setState(current => (current && current.rev > next.rev ? current : next)));
    const offActor = backend.subscribeActor(id => { setActorState(id); setToast(null); });
    return () => { alive = false; offState(); offActor(); };
  }, [backend]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const current = stateRef.current;
      if (current?.grants.some(grant => grant.status === 'approved' && (grant.expiresAt ?? Infinity) <= t)) void backend.tick();
    }, 1000);
    return () => clearInterval(id);
  }, [backend]);

  const say = useCallback((text: string, tone: Toast['tone'] = 'ok', undoId?: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, text, tone, undoId });
  }, []);

  const dispatch = useCallback(async (action: Action): Promise<DispatchResult> => {
    const result = await backend.dispatch(action, actor);
    if (result.ok) {
      setState(result.state);
      say(result.message, 'ok', result.undoable && action.type !== 'undo' ? result.eventId ?? undefined : undefined);
    } else {
      say(result.error, 'error');
    }
    return result;
  }, [backend, actor, say]);

  const setActor = useCallback((id: string) => { setActorState(id); setToast(null); void backend.setActor(id); }, [backend]);

  const lastExpiry = useRef('');
  useEffect(() => {
    const expired = state?.events.find(event => event.id.startsWith('expire-'));
    if (!expired || expired.id === lastExpiry.current) return;
    const first = lastExpiry.current === '';
    lastExpiry.current = expired.id;
    const grant = state?.grants.find(item => `expire-${item.id}` === expired.id);
    if (!first && grant?.requester === actor && Date.now() - expired.at < 10_000) say('Temporary access ended. You’re back on the critical task.');
  }, [state, actor, say]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(current => (current?.id === toast.id ? null : current)), toast.undoId ? 8000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);

  return { backend, state, actor, setActor, now, dispatch, toast, dismissToast: () => setToast(null), say, loadError };
}

export type Quest = ReturnType<typeof useQuest> & { state: QuestState };
