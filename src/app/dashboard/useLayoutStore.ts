// Where a person's dashboard layout lives. Live: in their own account (Supabase auth user metadata,
// under taskhq_layouts[orgId][pageId]), so it follows them across devices, belongs to nobody else and
// needs no migration. A copy in this browser paints the layout instantly before the account answers.
// Demo: this browser only, per demo person. Anything missing or malformed falls back to the default.
import { useCallback, useEffect, useState } from 'react';
import { normalizeLayout } from '../../core/dashboard-layout.ts';
import type { DashboardLayout, ModuleSpec } from '../../core/dashboard-layout.ts';
import { useLive } from '../LiveContext.tsx';

const META_KEY = 'taskhq_layouts';
type Saved = Record<string, Record<string, unknown>>; // orgId → pageId → layout
const cacheKey = (scope: string, actor: string, pageId: string) => `quest.layout.v1.${scope}.${actor}.${pageId}`;
const readCache = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
const writeCache = (key: string, layout: DashboardLayout | null) => { try { if (layout) localStorage.setItem(key, JSON.stringify(layout)); else localStorage.removeItem(key); } catch { /* this page only */ } };

export function useLayoutStore(pageId: string, scope: string, actor: string, specs: ModuleSpec[]) {
  const live = useLive();
  const key = cacheKey(live?.org.id ?? scope, live?.userId ?? actor, pageId);
  const [raw, setRaw] = useState<unknown>(() => readCache(key));
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  useEffect(() => { setRaw(readCache(key)); }, [key]);

  // Live: the account's saved copy wins over this browser's.
  useEffect(() => {
    if (!live) return;
    let current = true;
    void live.client.auth.getUser().then(({ data }) => {
      if (!current) return;
      const saved = (data.user?.user_metadata?.[META_KEY] as Saved | undefined)?.[live.org.id]?.[pageId];
      setRaw(saved ?? null); writeCache(key, saved ? normalizeLayout(saved, specs) : null);
    }).catch(() => { /* keep this browser's copy */ });
    return () => { current = false; };
  }, [live, key, pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = normalizeLayout(raw, specs);
  const customized = raw != null;

  /** Saves this person's layout (null clears it back to the default). Only their own entry changes. */
  const save = useCallback(async (next: DashboardLayout | null) => {
    setRaw(next); writeCache(key, next);
    if (!live) return true;
    setStatus('saving');
    try {
      // Read-modify-write of this person's own metadata, touching only this org and page.
      const { data, error: readError } = await live.client.auth.getUser();
      if (readError) throw readError;
      const all: Saved = { ...((data.user?.user_metadata?.[META_KEY] as Saved | undefined) ?? {}) };
      const pages = { ...(all[live.org.id] ?? {}) };
      if (next) pages[pageId] = next; else delete pages[pageId];
      all[live.org.id] = pages;
      const { error } = await live.client.auth.updateUser({ data: { [META_KEY]: all } });
      if (error) throw error;
      setStatus('idle');
      return true;
    } catch { setStatus('error'); return false; }
  }, [live, key, pageId]);

  return { layout, customized, save, status };
}
