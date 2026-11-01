// The employee workday around the live app. Signing in opens the workspace directly; the shift
// panel (check in, EOD, check out, history) opens only when the person asks for it, from the
// account menu or a task. Authentication, attendance and authorization stay separate: being signed
// in never opens or closes a shift, and the server (shift_list / shift_command) decides every shift
// state. Reviewers never hold shifts.
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
/** Opens the shift panel on entry; used by the badge check-in hand-off. */
export const WORKDAY_ROUTE = '#/workday';

export function WorkdayGate({ client, org, userId, email, role, backend, onSignOut, children }: {
  client: SupabaseClient; org: string; userId: string; email: string; role: OrgRole; backend: QuestBackend; onSignOut: () => void; children: ReactNode;
}) {
  const shifts = useMemo(() => liveShiftBackend(client, org, userId), [client, org, userId]);
  const canCheckIn = role !== 'reviewer';
  const manager = MANAGER_ROLES.includes(role);
  // The workspace opens straight away. Shift status loads alongside it for the account menu and
  // task page; it never decides whether someone may enter.
  // A badge scan asks for the shift panel explicitly (#/workday); it is never shown otherwise.
  const [phase, setPhase] = useState<'work' | 'panel'>(() => (canCheckIn && location.hash === WORKDAY_ROUTE ? 'panel' : 'work'));
  const backToWork = () => { if (location.hash === WORKDAY_ROUTE) history.replaceState(null, '', '#/home'); setPhase('work'); };
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [work, setWork] = useState<QuestState | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const wasOpen = useRef<boolean | null>(null);

  // Tasks and jobs for the SOD picker come from the same server-checked workspace load.
  useEffect(() => { if (canCheckIn && phase === 'panel') void backend.load().then(setWork).catch(() => setWork(null)); }, [backend, canCheckIn, phase]);
  useEffect(() => {
    if (!canCheckIn) return;
    shifts.load().then(snapshot => {
      const open = snapshot.shifts.find(item => item.employee === userId && (item.state === 'active' || item.state === 'checkout_pending')) ?? null;
      setStatus({ open, lateEodDue: snapshot.late_eod_due ?? null, snapshot });
      wasOpen.current = !!open;
      setError('');
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [shifts, userId, canCheckIn, attempt]);

  const onStatus = useCallback((next: ShiftStatus) => {
    setStatus(next);
    // A shift that just started opens My Work; a checkout keeps the panel showing its confirmation.
    if (wasOpen.current === false && next.open) backToWork();
    wasOpen.current = !!next.open;
  }, []);

  const context: ShiftContext = {
    org, actor: userId, manager, canCheckIn,
    tasks: work?.tasks ?? [], projects: work?.projects ?? [], events: work?.events ?? [],
  };
  const workday = useMemo<Workday>(() => ({ shift: status?.open ?? null, open: () => setPhase('panel') }), [status?.open]);

  if (phase === 'panel') {
    const onShift = !!status?.open && !status.lateEodDue;
    return <WorkdayPage>
      {error && <div className="shift-alert" role="alert"><p>Couldn’t confirm your shift: {error}</p><button className="btn" type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>}
      <ShiftModule backend={shifts} context={context} onStatus={onStatus}
        name={status?.lateEodDue ? 'Before today’s shift' : status?.open ? 'Your shift' : 'Start your day'}
        actions={<span className="workday-actions">
          <button type="button" className={onShift ? 'btn btn-primary' : 'btn'} onClick={backToWork}>Back to My Work</button>
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
