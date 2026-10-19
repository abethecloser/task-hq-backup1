// Storage for the operational tools (estimates, takeoffs, proposals).
//
// Demo: kept in this browser, one store per workspace (`quest.tools.v1.<org>`), shared across
// tabs. Tool records are deliberately NOT part of the task workspace document: they grow with
// every job and would make each task save heavier. In production they would be their own
// tables with org-scoped RLS (see docs/operational-tools.md). Live workspaces have no tools
// backend yet, so this returns null there and the Tools view says so.
import type { Person } from '../core/contract.ts';
import type { ToolsState } from '../core/tools/estimating.ts';
import { seedTools } from '../core/tools/seed.ts';

const EVENT = 'quest-tools';

export interface ToolsStore {
  orgId: string;
  load(): ToolsState;
  save(state: ToolsState): void;
  subscribe(listener: (state: ToolsState) => void): () => void;
  reset(): ToolsState;
}

export function demoTools(orgId: string, people: Person[]): ToolsStore {
  const key = `quest.tools.v1.${orgId}`;
  const read = (): ToolsState | null => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
      return raw && raw.version === 1 && raw.orgId === orgId ? raw as ToolsState : null;
    } catch { return null; }
  };
  const write = (state: ToolsState) => {
    if (state.orgId !== orgId) throw new Error('Tool records belong to another workspace.');
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* this tab only */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: state }));
  };
  return {
    orgId,
    load() { const stored = read(); if (stored) return stored; const fresh = seedTools(orgId, Date.now(), people); write(fresh); return fresh; },
    save: write,
    reset() { const fresh = seedTools(orgId, Date.now(), people); write(fresh); return fresh; },
    subscribe(listener) {
      const local = (event: Event) => { const detail = (event as CustomEvent<ToolsState>).detail; if (detail.orgId === orgId) listener(detail); };
      const other = (event: StorageEvent) => { if (event.key === key) { const next = read(); if (next) listener(next); } };
      window.addEventListener(EVENT, local);
      window.addEventListener('storage', other);
      return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', other); };
    },
  };
}
