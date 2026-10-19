import type { MomentumSession } from './momentum.ts';
import { localDate } from './time.ts';
export interface VisitStorage { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
export const momentumKey = (tenant: string, actor: string) => `quest.momentum.v1.${encodeURIComponent(JSON.stringify([tenant, actor]))}`;
export interface Visit extends MomentumSession { date: string; lastSeen: number }
export const MOMENTUM_IDLE = 30 * 60_000;
export function readMomentumSession(key: string, now: number, local: VisitStorage, tab: VisitStorage): Visit {
  const date = localDate(now);
  try {
    const saved = JSON.parse(tab.getItem(key) ?? 'null') as Visit | null;
    if (saved?.date === date && Number.isFinite(saved.startedAt) && Number.isFinite(saved.lastSeen) && Number.isSafeInteger(saved.visit)
      && saved.startedAt <= now && now - saved.lastSeen < MOMENTUM_IDLE) return saved;
    const prior = JSON.parse(local.getItem(key) ?? 'null') as { lastSeen?: number; visit?: number } | null;
    const visit = Number.isSafeInteger(prior?.visit) && prior!.visit! >= 0 ? prior!.visit! + 1 : 0;
    const next = { date, startedAt: now, previousAt: typeof prior?.lastSeen === 'number' && Number.isFinite(prior.lastSeen) && prior.lastSeen > 0 && prior.lastSeen < now ? prior.lastSeen : null, visit, lastSeen: now };
    tab.setItem(key, JSON.stringify(next));
    local.setItem(key, JSON.stringify({ lastSeen: now, visit }));
    return next;
  } catch { return { date, startedAt: now, previousAt: null, visit: 0, lastSeen: now }; }
}

