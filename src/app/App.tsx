// The Task-HQ shell: three zones with one consistent structure.
//   LEFT    Instrument Rail + expandable, resizable workspace panel (Sidebar.tsx).
//   CENTER  The adaptive working canvas for the selected activity.
//   RIGHT   Context & execution for the selected task, or operational signals
//           (ContextPanel.tsx). Docked beside the canvas when there is room, so
//           nothing ever covers the work; a drawer on smaller screens.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Section } from '../core/contract.ts';
import { SECTION_LABELS } from '../core/contract.ts';
import { decisionDesk } from '../core/executive.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { lensCounts } from '../core/registry.ts';
import { insights, insightsFor } from '../core/rules.ts';
import { activeGrant, activeLeads, canEnter, inFocus, leadBucket, myTasks, person, taskById } from '../core/selectors.ts';
import AgentWorkspace from '../AgentWorkspace.tsx';
import { LookSwitch, ModeChip, BrandMark, ToastBar, WorkingAs } from '../ui/components.tsx';
import { useQuest } from '../ui/useQuest.ts';
import type { Quest } from '../ui/useQuest.ts';
import { AllTasks } from './AllTasks.tsx';
import type { RegistryPreset } from './AllTasks.tsx';
import { CompanyWork } from './CompanyWork.tsx';
import { Signals, TaskContext, hasSignals } from './ContextPanel.tsx';
import { CreateTask } from './CreateTask.tsx';
import { ExecutiveDesk } from './ExecutiveDesk.tsx';
import { Activity, Settings } from './Settings.tsx';
import { MyWork } from './MyWork.tsx';
import { NeedsAttention } from './NeedsAttention.tsx';
import { People } from './People.tsx';
import { SpeedToLead } from './SpeedToLead.tsx';
import { CriticalFocus, GrantBar } from './UltraFocus.tsx';
import { FeedbackInbox, ReviewLayer, ReviewerWelcome } from './Review.tsx';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
import type { QuestBackend } from '../adapter/store.ts';
import { presetFor } from '../core/workspace.ts';
import { Sidebar, useSidebar } from './Sidebar.tsx';
import { notificationsFor } from './notifications.ts';
import type { Notification } from './notifications.ts';

export type View = 'my-work' | 'all-tasks' | 'company-work' | 'needs-attention' | 'leads' | 'executive' | 'people' | 'feedback' | 'activity' | 'settings' | 'agents';

// All Tasks shows company-wide work, so Critical Focus gates it exactly like Company Work.
const VIEW_SECTION: Record<View, Section | 'my-work' | 'never'> = {
  'my-work': 'my-work', 'all-tasks': 'company-work', 'company-work': 'company-work', 'needs-attention': 'needs-attention', leads: 'leads', feedback: 'my-work',
  executive: 'never', people: 'never', activity: 'never', settings: 'never', agents: 'never',
};

const VIEW_LABELS: Record<View, string> = {
  'my-work': 'My Work', 'all-tasks': 'All Tasks', 'company-work': 'Company Work', 'needs-attention': 'Needs Attention', leads: 'Speed to Lead',
  executive: 'Executive Desk', people: 'People & Roles', feedback: 'Feedback', activity: 'Activity', settings: 'Policy & data', agents: 'Agent pilot',
};

/** Views where operational signals are useful beside the canvas. */
const SIGNAL_VIEWS: View[] = ['my-work', 'all-tasks', 'company-work', 'needs-attention'];
const TASK_PANEL = 420;
const SIGNAL_PANEL = 288;
/** The canvas never gets narrower than this because of a docked panel. */
const MIN_CANVAS = 600;
const LENSES: Lens[] = ['all', 'mine', 'team', 'attention', 'completed'];

function parseHash(): { view: View; taskId: string | null; leadId: string | null; feedbackId: string | null; lens: Lens | null } {
  const [, first = '', second = ''] = location.hash.split('/');
  if (first === 'task' && second) return { view: 'all-tasks', taskId: decodeURIComponent(second), leadId: null, feedbackId: null, lens: null };
  const views = Object.keys(VIEW_LABELS) as View[];
  return {
    view: views.includes(first as View) ? first as View : 'my-work', taskId: null,
    leadId: first === 'leads' && second ? decodeURIComponent(second) : null,
    feedbackId: first === 'feedback' && second ? decodeURIComponent(second) : null,
    lens: first === 'all-tasks' && LENSES.includes(second as Lens) ? second as Lens : null,
  };
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/** 'auto' shows signals only when there is something to say; the person can pin it open or closed. */
type ContextPref = 'auto' | 'open' | 'closed';
function useContextPref(actor: string): [ContextPref, (next: ContextPref) => void] {
  const key = `quest.context.v1.${actor}`;
  const read = (): ContextPref => { try { const value = localStorage.getItem(key); return value === 'open' || value === 'closed' ? value : 'auto'; } catch { return 'auto'; } };
  const [pref, setPref] = useState<ContextPref>(read);
  const [owner, setOwner] = useState(actor);
  if (owner !== actor) { setOwner(actor); setPref(read()); }
  return [pref, next => { setPref(next); try { localStorage.setItem(key, next); } catch { /* this page only */ } }];
}

export default function App({ onExitDemo, backend }: { onExitDemo?: () => void; backend?: QuestBackend } = {}) {
  const quest = useQuest('app', backend);
  if (quest.loadError) return <LoadError message={quest.loadError} />;
  if (!quest.state || !quest.actor) return <div className="boot"><BrandMark size={42} /><span>Opening Task-HQ…</span></div>;
  return <Shell quest={quest as Quest} onExitDemo={onExitDemo} />;
}

function Shell({ quest, onExitDemo }: { quest: Quest; onExitDemo?: () => void }) {
  const { state, actor, now, dispatch } = quest;
  const live = useLive();
  const initial = parseHash();
  const [requested, setRequested] = useState<View>(initial.view);
  const [taskId, setTaskId] = useState<string | null>(initial.taskId);
  const [leadId, setLeadId] = useState<string | null>(initial.leadId);
  const [creating, setCreating] = useState(false);
  const [feedbackId, setFeedbackId] = useState<string | null>(initial.feedbackId);
  const [reviewRequest, setReviewRequest] = useState(0);
  const [preset, setPreset] = useState<RegistryPreset | null>(initial.lens ? { lens: initial.lens, nonce: 1 } : null);
  const clearPreset = useCallback(() => setPreset(null), []);
  const sidebar = useSidebar(actor);
  const collapseSidebar = sidebar.collapse;
  const width = useViewportWidth();
  const [contextPref, setContextPref] = useContextPref(actor);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      if (!next.taskId) setRequested(next.view);
      setTaskId(next.taskId);
      if (next.leadId) setLeadId(next.leadId);
      if (next.feedbackId) setFeedbackId(next.feedbackId);
      if (next.lens) setPreset(current => ({ lens: next.lens!, nonce: (current?.nonce ?? 0) + 1 }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setTaskId(null); setCreating(false); collapseSidebar(); }
      if (event.key === 'n' && !event.metaKey && !event.ctrlKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); setCreating(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapseSidebar]);

  const focused = inFocus(state, actor);
  const grant = activeGrant(state, actor, now);
  const allowed = (view: View) => {
    const section = VIEW_SECTION[view];
    if (section === 'never') return !focused;
    return canEnter(state, actor, section, now);
  };
  const me = person(state, actor)!;
  // Re-derived when state changes or each minute, not on every one-second clock tick.
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notifications = useMemo(() => notificationsFor(state, minute * 60000, actor), [state, minute, actor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decisions = useMemo(() => decisionDesk(state, minute * 60000, actor).length, [state, minute, actor]);
  const hasDesk = me.role === 'manager' || decisions > 0;
  const view: View = allowed(requested) && (requested !== 'executive' || hasDesk) ? requested : 'my-work';

  // When temporary access ends, close anything opened with it.
  useEffect(() => {
    if (!focused || !taskId) return;
    if (taskId !== state.focus?.taskId && !grant) setTaskId(null);
  }, [focused, grant, taskId, state.focus]);

  function go(next: View) {
    setRequested(next);
    setTaskId(null);
    history.replaceState(null, '', next === 'leads' && leadId ? `#/leads/${leadId}` : `#/${next}`);
  }
  function openTask(id: string) {
    setTaskId(id);
    history.replaceState(null, '', `#/task/${id}`);
  }
  function closeTask() {
    setTaskId(null);
    history.replaceState(null, '', `#/${view}`);
  }
  function openLead(id: string) {
    setLeadId(id); setRequested('leads'); setTaskId(null);
    history.replaceState(null, '', `#/leads/${id}`);
  }
  function openRegistry(lens: Lens, changes?: Partial<RegistryQuery>) {
    setPreset(current => ({ lens, changes, nonce: (current?.nonce ?? 0) + 1 }));
    go('all-tasks');
    history.replaceState(null, '', `#/all-tasks/${lens}`);
  }

  const mineCount = myTasks(state, actor, now).length;
  const attention = insights(state, now);
  const myAttention = insightsFor(state, now, actor).filter(item => item.severity !== 'normal').length;
  const leadAttention = activeLeads(state).filter(lead => leadBucket(state, lead, now) !== 'responded').length;
  const canCreate = me.role !== 'reviewer' && (!focused || grant?.section === 'create-task');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => lensCounts(state, actor, minute * 60000), [state, actor, minute]);
  const openCompany = state.tasks.filter(task => task.status !== 'done');
  const info: Partial<Record<View, string>> = {
    'my-work': mineCount ? `${mineCount} open ${mineCount === 1 ? 'task' : 'tasks'} on your plate.` : 'Nothing assigned right now.',
    'all-tasks': `${counts.all} open · ${counts.team} with others · ${counts.attention} need attention.`,
    'company-work': `${openCompany.length} open across ${new Set(openCompany.map(task => task.owner).filter(Boolean)).size} people.`,
    'needs-attention': `${myAttention} for you · ${attention.length} workspace-wide.`,
    leads: leadAttention ? `${leadAttention} ${leadAttention === 1 ? 'lead needs' : 'leads need'} a response or next step.` : 'Every active lead has a next step.',
    people: `${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}${live ? ` in ${live.org.name}` : ' · synthetic team'}.`,
    activity: 'Who did what, and when.',
    feedback: `${state.feedback.filter(item => item.status !== 'resolved').length} open.`,
    settings: 'Policy, workspace and backups.',
    executive: decisions ? `${decisions} ${decisions === 1 ? 'decision needs' : 'decisions need'} your authority.` : 'No decisions are waiting on you.',
  };
  function openNotification(note: Notification) {
    const { taskId: noteTask, leadId: noteLead, view: noteView } = note.target;
    if (noteTask) { if (!SIGNAL_VIEWS.includes(view) && view !== 'executive') go('all-tasks'); openTask(noteTask); return; }
    if (noteLead) { openLead(noteLead); return; }
    go(noteView ?? 'needs-attention');
  }

  const nav: { id: View; label: string; count?: number; hot?: boolean; icon: ReactNode }[] = [
    { id: 'my-work', label: 'My Work', count: mineCount, icon: <Icon d="M4 6h10M4 12h7M4 18h10M17 9l3 3-3 3" /> },
    { id: 'all-tasks', label: 'All Tasks', count: counts.all, hot: counts.attention > 0, icon: <Icon d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /> },
    { id: 'needs-attention', label: 'Needs Attention', count: attention.length, hot: myAttention > 0, icon: <Icon d="M12 4 21 20H3zM12 10v4M12 17v.5" /> },
    { id: 'leads', label: 'Speed to Lead', count: leadAttention, hot: leadAttention > 0, icon: <Icon d="M13 3 5 14h6l-1 7 8-11h-6z" /> },
    ...(hasDesk ? [{ id: 'executive' as View, label: 'Executive Desk', count: decisions, hot: decisions > 0, icon: <Icon d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" /> }] : []),
    { id: 'company-work', label: 'Company Work', count: openCompany.length, icon: <Icon d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" /> },
    { id: 'people', label: 'People & Roles', count: state.people.length, icon: <Icon d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" /> },
    { id: 'activity', label: 'Activity', icon: <Icon d="M4 12h4l3-7 3 14 3-7h3" /> },
    { id: 'feedback', label: 'Feedback', count: state.feedback.filter(item => item.status !== 'resolved').length, icon: <Icon d="M4 5h16v11H9l-5 4z" /> },
    { id: 'settings', label: 'Policy & data', icon: <Icon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3" /> },
    ...(state.policy.agentPilot ? [{ id: 'agents' as View, label: 'Agent pilot', icon: <Icon d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21a7 7 0 0 1 14 0" /> }] : []),
  ];

  const selected = taskId ? taskById(state, taskId) : undefined;
  const contextAllowed = selected && (!focused || selected.id === state.focus?.taskId || !!grant);

  // Right zone geometry: dock only when the canvas keeps at least MIN_CANVAS.
  const leftWidth = sidebar.isMobile ? 0 : 56 + (sidebar.open ? sidebar.width : 0);
  const signalsWanted = !selected && SIGNAL_VIEWS.includes(view) && !focused && me.role !== 'reviewer'
    && (contextPref === 'open' || (contextPref === 'auto' && hasSignals(quest, notifications)));
  const signalsFit = !sidebar.isMobile && width - leftWidth - SIGNAL_PANEL >= MIN_CANVAS;
  const showSignals = signalsWanted && signalsFit;
  const taskDocked = !!selected && !!contextAllowed && !sidebar.isMobile && width - leftWidth - TASK_PANEL >= MIN_CANVAS;
  const contextOffset = taskDocked ? TASK_PANEL : showSignals ? SIGNAL_PANEL : 0;
  const signalSeam = !selected && SIGNAL_VIEWS.includes(view) && signalsFit && !focused && me.role !== 'reviewer';

  return (
    <div className={`shell ${focused ? 'is-focus' : ''} ${live ? 'is-live' : 'is-demo'}`}
      style={{ ...sidebar.shellStyle, ['--context-offset' as string]: `${contextOffset}px` }}
      data-sidebar={sidebar.isMobile ? undefined : sidebar.open ? 'open' : 'closed'} data-context={contextOffset ? 'open' : 'closed'} data-resizing={sidebar.resizing || undefined}>
      <Sidebar
        control={sidebar}
        notifications={notifications}
        executive={hasDesk}
        executiveInfo={info.executive ?? ''}
        onOpenNotification={openNotification}
        brand={<a className="brand" href="#/my-work" aria-label="Task-HQ — My Work" onClick={event => { event.preventDefault(); go('my-work'); sidebar.afterNavigate(); }}><BrandMark /></a>}
        items={nav.map(item => ({ id: item.id, label: item.label, icon: item.icon, count: item.count, hot: item.hot, active: view === item.id, locked: !allowed(item.id), info: info[item.id] }))}
        onSelect={id => go(id as View)}
        create={{ enabled: canCreate, onCreate: () => setCreating(true) }}
        footer={live
          ? <><LookSwitch compact /><ModeChip quest={quest} /><p>Signed in as {live.email} · {ROLE_LABELS[live.role]}{live.isPlatformAdmin ? ' · platform admin (separate)' : ''}</p><button type="button" className="link exit-demo" onClick={live.onSignOut}>Sign out</button></>
          : <><LookSwitch compact /><ModeChip quest={quest} /><p><b>Task-HQ Demo</b> · synthetic people and data. Changes stay on this device; teammates are not notified.</p>{onExitDemo && <button type="button" className="link exit-demo" onClick={onExitDemo}>Leave demo · sign in</button>}</>}
      />
      {!sidebar.isMobile && (
        <button type="button" className="seam-toggle is-left" onClick={sidebar.toggle} aria-controls="quest-sidebar" aria-expanded={sidebar.open}
          aria-label={sidebar.open ? 'Collapse sidebar' : 'Expand sidebar'} title={sidebar.open ? 'Collapse sidebar' : 'Expand sidebar'}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={sidebar.open ? 'M14 7l-5 5 5 5' : 'M10 7l5 5-5 5'} /></svg>
        </button>
      )}

      <main className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open navigation" aria-controls="quest-sidebar" aria-expanded={sidebar.mobileOpen} onClick={sidebar.openMobile}><Icon d="M4 6h16M4 12h16M4 18h16" /></button>
          <span className="topbar-title">{VIEW_LABELS[view]}</span>
          <span className="workspace-chip" title={`${presetFor(state).label} workspace · tenant ${state.workspace.tenantId} · ${state.workspace.plan === 'local-demo' ? 'local demo' : state.workspace.plan}`}>{state.workspace.name}</span>
          {!live && <span className="demo-flag" title="Synthetic people and data on this device. Not company work.">Demo · synthetic</span>}
          <div className="topbar-right">
            {focused && <span className="focus-chip">Critical Focus</span>}
            {live ? <AccountChip /> : <><WorkingAs quest={quest} /><span className="me-role">{me.title}</span></>}
          </div>
        </header>

        {focused && grant && <GrantBar quest={quest} grant={grant} onReturn={() => { closeTask(); go('my-work'); }} />}

        <section className={`content view-${view}`}>
          {focused && !grant && view === 'my-work'
            ? <CriticalFocus quest={quest} onOpen={openTask} />
            : view === 'my-work' && me.role === 'reviewer' ? <ReviewerWelcome quest={quest} onOpenFeedback={() => setReviewRequest(value => value + 1)} go={next => go(next as View)} />
            : view === 'my-work' ? <MyWork quest={quest} onOpen={openTask} onCreate={() => setCreating(true)} />
            : view === 'all-tasks' ? <AllTasks quest={quest} selectedId={taskId} onSelect={openTask} onCreate={() => setCreating(true)} canCreate={canCreate} preset={preset} onPresetApplied={clearPreset} />
            : view === 'executive' ? <ExecutiveDesk quest={quest} onOpenTask={openTask} onOpenLead={openLead} />
            : view === 'people' ? <People quest={quest} />
            : view === 'feedback' ? <FeedbackInbox quest={quest} onOpen={id => { setFeedbackId(id); history.replaceState(null, '', `#/feedback/${id}`); }} />
            : view === 'company-work' ? <CompanyWork quest={quest} onOpen={openTask} />
            : view === 'needs-attention' ? <NeedsAttention quest={quest} onOpen={openTask} />
            : view === 'leads' ? <SpeedToLead quest={quest} onOpen={openTask} selectedLead={leadId} onSelectLead={id => { setLeadId(id); history.replaceState(null, '', id ? `#/leads/${id}` : '#/leads'); }} />
            : view === 'activity' ? <Activity quest={quest} onOpen={openTask} />
            : view === 'settings' ? <Settings quest={quest} onPeople={() => go('people')} />
            : <AgentWorkspace />}
        </section>

        <nav className="tabbar" aria-label="Task-HQ sections">
          {nav.slice(0, 4).map(item => (
            <button key={item.id} type="button" className={view === item.id ? 'is-active' : ''} disabled={!allowed(item.id)} onClick={() => go(item.id)}>
              {item.icon}<span>{item.label.replace('Speed to Lead', 'Leads').replace('Needs Attention', 'Attention').replace('All Tasks', 'Tasks')}</span>
              {item.hot && allowed(item.id) && <i className="tab-dot" />}
            </button>
          ))}
        </nav>
      </main>

      {selected && contextAllowed && <>
        {!taskDocked && <button className="scrim" aria-label="Close task" onClick={closeTask} />}
        <TaskContext key={selected.id} quest={quest} task={selected} docked={taskDocked} onClose={closeTask} onOpen={openTask} />
      </>}
      {selected && !contextAllowed && (
        <div className="locked-note" role="alert">“{selected.title}” is outside your Critical Focus. Request access to {SECTION_LABELS['company-work']} first. <button className="btn btn-ghost btn-sm" onClick={closeTask}>Close</button></div>
      )}
      {showSignals && <Signals quest={quest} notifications={notifications} onOpenNotification={openNotification} onClose={() => setContextPref('closed')}
        onLens={(lens, filter) => openRegistry(lens, filter === 'overdue' ? { due: 'overdue' } : filter === 'blocked' ? { status: 'blocked' } : filter === 'unowned' ? { owner: 'none' } : undefined)} />}
      {signalSeam && (
        <button type="button" className="seam-toggle is-right" onClick={() => setContextPref(showSignals ? 'closed' : 'open')} aria-expanded={showSignals}
          aria-label={showSignals ? 'Collapse signals' : 'Show operational signals'} title={showSignals ? 'Collapse signals' : 'Show operational signals'}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={showSignals ? 'M10 7l5 5-5 5' : 'M14 7l-5 5 5 5'} /></svg>
        </button>
      )}
      {creating && canCreate && <CreateTask quest={quest} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); openTask(id); }} />}
      <ReviewLayer quest={quest} openRequest={reviewRequest}
        screen={{ view: VIEW_LABELS[view], route: `#/${view}${view === 'leads' && leadId ? `/${leadId}` : ''}`, taskId: selected?.id ?? '', leadId: view === 'leads' && leadId ? leadId : '', deck: view === 'leads' && leadId ? 'lead' : selected ? 'task' : '' }}
        itemId={feedbackId} onItem={id => { setFeedbackId(id); if (!id && location.hash.startsWith('#/feedback/')) history.replaceState(null, '', '#/feedback'); }}
        onNavigate={target => {
          setFeedbackId(null);
          if (target.taskId) { openTask(target.taskId); return; }
          if (target.leadId) { openLead(target.leadId); return; }
          if (target.route) { location.hash = target.route; }
        }} />
      <ToastBar toast={quest.toast} onUndo={eventId => void dispatch({ type: 'undo', eventId })} onDismiss={quest.dismissToast} />
    </div>
  );
}

export function Icon({ d }: { d: string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

function AccountChip() {
  const live = useLive()!;
  return (
    <span className="account-chip" title={`${live.email} · ${ROLE_LABELS[live.role]} of ${live.org.name}`}>
      <b>{live.org.name}</b><small>{live.email} · {ROLE_LABELS[live.role]}</small>
      {live.canSwitch && <button type="button" className="btn btn-ghost btn-sm" onClick={live.onLeaveWorkspace}>{live.isPlatformAdmin ? 'Platform console' : 'Switch workspace'}</button>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={live.onSignOut}>Sign out</button>
    </span>
  );
}

/** A failed load never leaves a dead end: retry, switch workspace (live), or sign out. */
function LoadError({ message }: { message: string }) {
  const live = useLive();
  return (
    <div className="boot boot-error" role="alert">
      <p>Task-HQ could not load {live ? live.org.name : 'its data'}: {message}</p>
      <p className="boot-actions">
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
        {live?.canSwitch && <button type="button" className="btn btn-ghost" onClick={live.onLeaveWorkspace}>Switch workspace</button>}
        {live && <button type="button" className="btn btn-ghost" onClick={live.onSignOut}>Sign out</button>}
      </p>
    </div>
  );
}
