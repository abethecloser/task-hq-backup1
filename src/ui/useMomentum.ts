import { useEffect, useMemo, useState } from 'react';
import { momentumGreeting } from '../core/momentum.ts';
import { MOMENTUM_IDLE, momentumKey, readMomentumSession } from '../core/momentum-session.ts';
import { localDate } from '../core/time.ts';
import type { Quest } from './useQuest.ts';

/** Session copy is stable across Home navigation, tab reloads and minute ticks.
 * A new day or a return after 30 minutes starts a new deterministic variation. */
export function useMomentum(quest: Quest, company: boolean) {
  const { state, actor, now } = quest;
  const key = momentumKey(state.workspace.tenantId, actor);
  const date = localDate(now);
  const [resume, setResume] = useState(0);
  const session = useMemo(() => {
    const at = Math.max(now, Date.now());
    try { return readMomentumSession(key, at, localStorage, sessionStorage); }
    catch { return { date: localDate(at), startedAt: at, previousAt: null, visit: 0, lastSeen: at }; }
  }, [key, date, resume]);
  const minute = Math.floor(now / 60000);
  useEffect(() => {
    const stamp = () => {
      const at = Date.now();
      try { sessionStorage.setItem(key, JSON.stringify({ ...session, lastSeen: at })); localStorage.setItem(key, JSON.stringify({ lastSeen: at, visit: session.visit })); } catch { /* optional local preference */ }
    };
    if (!document.hidden) stamp();
    const visibility = () => {
      if (document.hidden) { stamp(); return; }
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        if (saved && Date.now() - saved.lastSeen >= MOMENTUM_IDLE) { setResume(value => value + 1); return; }
      } catch { /* no reliable previous visit */ }
      stamp();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stamp);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', stamp); };
  }, [key, session, minute]);
  return momentumGreeting(state, actor, now, session, company);
}
