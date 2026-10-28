// The employee workday around the live app: resolve a missed EOD → SOD and check-in → My Work →
// EOD → check out. Authentication, attendance and authorization stay separate: being signed in
// never opens a shift, and the server (shift_list / shift_command) decides every shift state.
// Anyone signed in may view their authorized work off-shift (shiftless); only an explicit
// check-in starts a shift. Reviewers never hold shifts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QuestBackend } from '../adapter/store.ts';
import type { QuestState } from '../core/contract.ts';
import type { OrgRole } from '../app/LiveContext.tsx';
import { ShiftModule } from './ShiftModule.tsx';
import type { ShiftStatus } from './ShiftModule.tsx';
import { liveShiftBackend } from './backend.ts';
import type { Shift, ShiftContext } from './types.ts';
import { entryPhase } from './workday.ts';

export interface Workday {
  /** The open shift, or null (not checked in). */
  shift: Shift | null;
  /** Opens the shift panel: check in, EOD, check out, history. */
  open: () => void;
}
const WorkdayContext = createContext<Workday | null>(null);
export const useWorkday = () => useContext(WorkdayContext);

/** Shift review and timestamp adjustments (the server enforces the same roles). */
const MANAGER_ROLES: OrgRole[] = ['owner', 'admin', 'supervisor'];

// "View work without checking in", remembered for this tab and day only.
// A per-tab convenience, never attendance: the server still says nobody is checked in.
const skipKey = (org: string, user: string) => `tmhq.workday-skip:${org}:${user}:${new Date().toLocaleDateString('en-CA')}`;
const skipped = (org: string, user: string) => { try { return sessionStorage.getItem(skipKey(org, user)) === '1'; } catch { return false; } };
const rememberSkip = (org: string, user: string) => { try { sessionStorage.setItem(skipKey(org, user), '1'); } catch { /* this view only */ } };

export function WorkdayGate({ client, org, userId, email, role, backend, onSignOut, children }: {
  client: SupabaseClient; org: string; userId: string; email: string; role: OrgRole; backend: QuestBackend; onSignOut: () => void; children: ReactNode;
}) {
  const shifts = useMemo(() => liveShiftBackend(client, org, userId), [client, org, userId]);
  const canCheckIn = role !== 'reviewer';
  const manager = MANAGER_ROLES.includes(role);
  const [phase, setPhase] = useState<'checking' | 'gate' | 'work' | 'panel'>(canCheckIn ? 'checking' : 'work');
  const continueOffShift = () => { rememberSkip(org, userId); setPhase('work'); };
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [work, setWork] = useState<QuestState | null>(null);
  const [error, setError] = useState('');
  const wasOpen = useRef<boolean | null>(null);

  // Tasks and jobs for the SOD picker come from the same server-checked workspace load.
  useEffect(() => { if (canCheckIn) void backend.load().then(setWork).catch(() => setWork(null)); }, [backend, canCheckIn]);
  // First answer decides entry: an open shift goes straight to work; anything else stops at the gate.
  useEffect(() => {
    if (phase !== 'checking') return;
    shifts.load().then(snapshot => {
      const open = snapshot.shifts.find(item => item.employee === userId && (item.state === 'active' || item.state === 'checkout_pending')) ?? null;
      setStatus({ open, lateEodDue: snapshot.late_eod_due ?? null, snapshot });
      wasOpen.current = !!open;
      setPhase(entryPhase({ open: !!open, lateEodDue: !!snapshot.late_eod_due, viewingOffShift: skipped(org, userId) }));
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [phase, shifts, userId, org]);

  const onStatus = useCallback((next: ShiftStatus) => {
    setStatus(next);
    // A shift that just started opens My Work; a checkout keeps the panel showing its confirmation.
    if (wasOpen.current === false && next.open) { history.replaceState(null, '', '#/home'); setPhase('work'); }
    wasOpen.current = !!next.open;
  }, []);

  const context: ShiftContext = {
    org, actor: userId, manager, canCheckIn,
    tasks: work?.tasks ?? [], projects: work?.projects ?? [], events: work?.events ?? [],
  };
  const workday = useMemo<Workday>(() => ({ shift: status?.open ?? null, open: () => setPhase('panel') }), [status?.open]);

  // Shift status unavailable: never lock anyone out of their work.
  if (error) return <WorkdayPage><div className="shift-alert" role="alert"><p>Couldn’t confirm your shift: {error}</p><button className="btn" type="button" onClick={() => { setError(''); setPhase('checking'); }}>Try again</button><button className="btn" type="button" onClick={() => { setError(''); setPhase('work'); }}>View work without checking in</button><button className="btn" type="button" onClick={onSignOut}>Sign out</button></div></WorkdayPage>;
  if (phase === 'checking') return <WorkdayPage><p role="status">Checking your shift… Signing in doesn’t start one.</p></WorkdayPage>;
  if (phase === 'gate' || phase === 'panel') {
    const onShift = !!status?.open && !status.lateEodDue;
    return <WorkdayPage>
      <ShiftModule backend={shifts} context={context} onStatus={onStatus}
        name={phase === 'panel' ? 'Your shift' : status?.lateEodDue ? 'Before today’s shift' : 'Start your day'}
        actions={<span className="workday-actions">
          <button type="button" className={onShift ? 'btn btn-primary' : 'btn'} onClick={onShift ? () => setPhase('work') : continueOffShift}>{onShift ? 'Back to My Work' : 'View work without checking in'}</button>
          <button type="button" className="btn" onClick={onSignOut}>Sign out</button>
        </span>} />
      <p className="workday-identity">Signed in as <b>{email}</b>. Not you? Sign out; a badge never switches accounts.</p>
    </WorkdayPage>;
  }
  return <WorkdayContext.Provider value={canCheckIn ? workday : null}>{children}</WorkdayContext.Provider>;
}

function WorkdayPage({ children }: { children: ReactNode }) {
  return <div className="workday-page">{children}</div>;
}
