// The Task-HQ shell: three zones with one consistent structure.
//   LEFT    Instrument Rail + expandable, resizable workspace panel (Sidebar.tsx).
//   CENTER  The adaptive working canvas for the selected activity.
//   RIGHT   Context & execution for the selected task, or operational signals
//           (ContextPanel.tsx). Docked beside the canvas when there is room, so
//           nothing ever covers the work; a drawer on smaller screens.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { SECTION_LABELS } from '../core/contract.ts';
import { decisionDesk } from '../core/executive.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { LEGACY_LENSES, LENSES, LENS_LABELS, completedQuery, isCompletedQuery, lensCounts, queryTasks } from '../core/registry.ts';
import { canCreateTask } from '../core/permissions.ts';
import { insights, insightsFor } from '../core/rules.ts';
import { activeGrant, activeLeads, inFocus, leadBucket, myTasks, person, taskById, withoutLegacyArchived } from '../core/selectors.ts';
import { LookSwitch, ModeChip, BrandMark, ToastBar, CtaArrow } from '../ui/components.tsx';
import { useQuest } from '../ui/useQuest.ts';
import type { Quest } from '../ui/useQuest.ts';
import { AllTasks, useRegistryPrefs } from './AllTasks.tsx';
import type { RegistryPreset } from './AllTasks.tsx';
import { CompanyWork } from './CompanyWork.tsx';
import { CalendarPage, CalendarPullout } from './ContextPanel.tsx';
import { TaskPage } from './TaskPage.tsx';
import type { DeckSection } from './ContextPanel.tsx';
import { localDate } from '../core/time.ts';
import { EdgeDrawer } from '../ui/EdgeDrawer.tsx';
import { WorkNavigator } from './WorkNavigator.tsx';
import { ClientWorkspace } from './ClientWorkspace.tsx';
import { CreateProject, canCreateProject } from './CreateProject.tsx';
import { Reports } from './Reports.tsx';
import { ProjectRoom } from './ProjectRoom.tsx';
import { DraftTask, discardTaskDraft, hasTaskDraft } from './DraftTask.tsx';
import { ExecutiveDesk } from './ExecutiveDesk.tsx';
import { Activity, Settings } from './Settings.tsx';
import { Home } from './Home.tsx';
import { CollabDock } from './CollabDock.tsx';
import type { DockTab } from './CollabDock.tsx';
import { DOCK_DEFAULT_PREF, loadDockPreference, saveDockPreference, withSnap } from '../ui/dock-size.ts';
import type { DockPreference } from '../ui/dock-size.ts';
import { AskTasks } from './AskTasks.tsx';
import { AccountMark, AccountMenu, TopBar } from './TopBar.tsx';
import { NeedsAttention } from './NeedsAttention.tsx';
import { People } from './People.tsx';
import { FeedbackProvider, FeedbackBar } from '../ui/Feedback.tsx';
import { TopSearch } from './Search.tsx';
import type { SearchResult } from '../core/reference-index.ts';
import { ReferenceProvider } from '../ui/ReferenceEditor.tsx';
import { referenceScope } from '../core/references.ts';
import { Relationships } from './Relationships.tsx';
import { SpeedToLead } from './SpeedToLead.tsx';
import { CriticalFocus, GrantBar } from './UltraFocus.tsx';
import { FeedbackInbox, ReviewLayer, ReviewerWelcome } from './Review.tsx';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
import type { QuestBackend } from '../adapter/store.ts';
import { Sidebar, useSidebar } from './Sidebar.tsx';
import { NotificationDrawer } from './NotificationDrawer.tsx';
import { attentionFor } from '../core/awareness.ts';
import { Inbox, inboxFor } from './Inbox.tsx';
import type { InboxData } from './Inbox.tsx';
import { ShiftBridge } from '../shifts/ShiftBridge.tsx';
import { demoMessaging } from '../adapter/messaging.ts';
import { demoTools } from '../adapter/tools.ts';
import { Tools } from './Tools.tsx';
import { OperationsWorkbook } from './OperationsWorkbook.tsx';
import { CompanySignals } from './CompanySignals.tsx';
import { notificationsFor } from './notifications.ts';
import { PREVIEW_VIEWS, PreviewNotice } from './PreviewNotice.tsx';
import { ARCHIVED_PAGES, canonicalPage, pageStatus } from '../core/navigation.ts';
import type { AppPageId } from '../core/navigation.ts';
import { bothFit, closeTemporaryRight, openTemporaryRight, togglePullout } from '../core/layout.ts';
import type { PulloutRoom, Pullouts } from '../core/layout.ts';
import { splitFilters } from '../core/task-filters.ts';
import type { Notification } from './notifications.ts';

// Product feedback is archived: hidden for every account. Stored feedback is kept.
const FEEDBACK_ON = false;

export type View = AppPageId;

const VIEW_LABELS: Record<View, string> = {
  workbook: 'Operations Workbook · Preview', home: 'Home', calendar: 'Calendar', reports: 'Reports', relationships: 'Relationship Vault', 'all-tasks': 'Tasks', inbox: 'Inbox', tools: 'Estimates & Proposals', 'company-work': 'Projects', 'needs-attention': 'Needs Attention', leads: 'First Response',
  executive: 'Owner overview', people: 'People & Access', feedback: 'Feedback', activity: 'Activity', settings: 'Settings', agents: 'Agent pilot',
};

/** Views where the Instrument Deck (signals, calendar, insights) is useful beside the canvas. */
/** Primary routes that keep the collaboration dock. */
const DOCK_VIEWS: View[] = ['home', 'all-tasks', 'company-work', 'calendar', 'reports', 'inbox'];
const SIGNAL_VIEWS: View[] = ['home', 'all-tasks', 'company-work', 'needs-attention'];
/** The canvas never gets narrower than this because of a docked panel. */
const MIN_CANVAS = 600;
/** With the left panel open too, the canvas may narrow further before the right panel overlays. */
const MIN_CANVAS_BOTH = 480;

function parseHash(): { view: View; taskId: string | null; leadId: string | null; roomId: string | null; feedbackId: string | null; lens: { lens: Lens; changes?: Partial<RegistryQuery> } | null } {
  const [, first = '', second = ''] = location.hash.split('?')[0]!.split('/');
  if (first === 'task' && second) return { view: 'all-tasks', taskId: decodeURIComponent(second), leadId: null, roomId: null, feedbackId: null, lens: null };
  const views = Object.keys(VIEW_LABELS) as View[];
  return {
    view: views.includes(first as View) ? canonicalPage(first as View) : 'home', taskId: null,
    leadId: first === 'leads' && second ? decodeURIComponent(second) : null,
    roomId: first === 'company-work' && second ? decodeURIComponent(second) : null,
    feedbackId: first === 'feedback' && second ? decodeURIComponent(second) : null,
    lens: first !== 'all-tasks' ? null : LENSES.includes(second as Lens) ? { lens: second as Lens } : LEGACY_LENSES[second] ? { lens: LEGACY_LENSES[second]!.lens ?? 'all', changes: LEGACY_LENSES[second] } : null,
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

/** The client workspace route. Demo only: live Task HQ has no client grants yet, so the route is ignored there. */
function useClientRoute() {
  const read = () => /^#\/client(\/|$)/.test(location.hash);
  const [on, setOn] = useState(read);
  useEffect(() => { const update = () => setOn(read()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  return on;
}

export default function App({ onExitDemo, backend }: { onExitDemo?: () => void; backend?: QuestBackend } = {}) {
  const quest = useQuest('app', backend);
  const live = useLive();
  const client = useClientRoute();
  if (quest.loadError) return <LoadError message={quest.loadError} />;
  if (!quest.state || !quest.actor) return <div className="boot"><BrandMark size={42} /><span>Opening Task-HQ…</span></div>;
  if (client && !live) return <ClientWorkspace quest={quest as Quest} onExit={() => { location.hash = '#/home'; }} />;
  return <FeedbackProvider feedback={quest.feedback}><ReferenceProvider scope={referenceScope(quest.state, quest.actor)} drafts={quest.referenceDrafts}><Shell quest={quest as Quest} onExitDemo={onExitDemo} /></ReferenceProvider></FeedbackProvider>;
}

function Shell({ quest: whole, onExitDemo }: { quest: Quest; onExitDemo?: () => void }) {
  // Work archived as legacy keeps its status, so every active view (Home, Calendar, Reports, project
  // rooms, the dock, counts) reads the workspace without it. The task page, the Tasks registry (its
  // Archived filter), search and activity read the whole record.
  const quest = useMemo(() => ({ ...whole, state: withoutLegacyArchived(whole.state) }), [whole]);
  const { state, actor, now, dispatch } = quest;
  const live = useLive();
  const feedbackOn = FEEDBACK_ON;
  const initial = parseHash();
  const [requested, setRequested] = useState<View>(initial.view);
  const [taskId, setTaskId] = useState<string | null>(initial.taskId);
  const [leadId, setLeadId] = useState<string | null>(initial.leadId);
  // Project room open on Projects (#/company-work/<projectId>).
  const [roomId, setRoomId] = useState<string | null>(initial.roomId);
  // A draft left open before a reload reopens the dialog where it was.
  const [creating, setCreating] = useState(() => hasTaskDraft(state.workspace.tenantId, actor));
  const [creatingProject, setCreatingProject] = useState(false);
  // A project chosen for the next task created (from Projects → Add the first task).
  const [createProjectId, setCreateProjectId] = useState<string | undefined>();
  const [attendanceDemo, setAttendanceDemo] = useState(false);
  // A due date chosen from the calendar, for the next task created.
  const [createDue, setCreateDue] = useState<string | undefined>();
  const createOn = (due: string) => { setCreateDue(due); setCreating(true); };
  const [askOpen, setAskOpen] = useState(false);
  // The right edge toggle reopens whichever right mode was used last.
  const [askOpenLast, setAskOpenLast] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  // Which task view and scope All Tasks is showing, for the top-bar tabs.
  const registry = useRegistryPrefs(state.workspace.tenantId, actor);
  const registryView = registry.prefs.query;
  const [feedbackId, setFeedbackId] = useState<string | null>(initial.feedbackId);
  const [reviewRequest, setReviewRequest] = useState(0);
  // A plain view address (#/all-tasks/urgent) only picks the view; old addresses carry their filters.
  const [preset, setPreset] = useState<RegistryPreset | null>(initial.lens ? { ...initial.lens, keep: !initial.lens.changes, nonce: 1 } : null);
  const clearPreset = useCallback(() => setPreset(null), []);
  const sidebar = useSidebar(actor);
  const collapseSidebar = sidebar.collapse;
  const width = useViewportWidth();
  /** Bottom collaboration dock (Home). Remembered on this device, like the calendar pullout. */
  // Bottom dock size preference (`quest-dock-height`); storage can be unavailable, so this degrades to this page only.
  const [dock, setDock] = useState<DockPreference>(() => { try { return loadDockPreference(localStorage); } catch { return DOCK_DEFAULT_PREF; } });
  useEffect(() => { try { saveDockPreference(localStorage, dock); } catch { /* storage unavailable */ } }, [dock]);
  const dockOpen = dock.snap !== 'collapsed';
  /** The task the dock is reading, focused in the overview's Living view until cleared. */
  const [dockFocus, setDockFocus] = useState<string | null>(null);
  /** An explicit "Open in dock" request from a task page (nonce repeats a request for the same task). */
  const [dockTask, setDockTask] = useState<{ id: string; nonce: number } | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>('inbox');
  /** Notifications drawer (right). Session-only: it always starts closed. The calendar pullout (left) is `sidebar.open`. */
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      if (!next.taskId) setRequested(next.view);
      setTaskId(next.taskId);
      if (next.leadId) setLeadId(next.leadId);
      setRoomId(next.roomId);
      if (next.feedbackId) setFeedbackId(next.feedbackId);
      if (next.view === 'all-tasks') setPreset(current => ({ ...(next.lens ?? { lens: 'all' as Lens }), keep: !next.lens?.changes, nonce: (current?.nonce ?? 0) + 1 }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setTaskId(null); setCreating(open => { if (open) discardTaskDraft(state.workspace.tenantId, actor); return false; }); collapseSidebar(); }
      if (event.key === 'n' && !event.metaKey && !event.ctrlKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); setCreating(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [collapseSidebar, state.workspace.tenantId, actor]);

  const focused = inFocus(state, actor);
  const grant = activeGrant(state, actor, now);
  const me = person(state, actor)!;
  // Team-wide panels and answers need the same access as Company Work.
  const company = me.role !== 'reviewer';
  // Re-derived when state changes or each minute, not on every one-second clock tick.
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notifications = useMemo(() => notificationsFor(state, minute * 60000, actor), [state, minute, actor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decisions = useMemo(() => decisionDesk(state, minute * 60000, actor).length, [state, minute, actor]);
  // One inbox per person: demo channels (this browser) + the task notifications above.
  const messagingStore = useMemo(() => (live ? null : demoMessaging(state.people)), [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const [messaging, setMessaging] = useState(() => messagingStore?.load() ?? null);
  useEffect(() => messagingStore?.subscribe(setMessaging), [messagingStore]);
  const inboxData: InboxData = useMemo(() => ({
    messaging, store: messagingStore,
    current: live ? { id: live.org.id, name: live.org.name } : { id: 'demo-roofing', name: messaging?.workspaces.find(item => item.id === 'demo-roofing')?.name ?? state.workspace.name },
  }), [messaging, messagingStore, live, state.workspace.name]);
  // Operational tools: demo store per workspace; no live backend yet.
  const toolsStore = useMemo(() => (live ? null : demoTools(`demo-${state.workspace.tenantId}`, state.people)), [live, state.workspace.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tools, setTools] = useState(() => toolsStore?.load() ?? null);
  useEffect(() => { setTools(toolsStore?.load() ?? null); return toolsStore?.subscribe(setTools); }, [toolsStore]);
  const readKey = [...sidebar.read].join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inbox = useMemo(() => inboxFor(actor, inboxData, notifications, sidebar.read), [actor, inboxData, notifications, readKey]);
  const inboxUnread = inbox.unread;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mentions = useMemo(() => inbox.items.filter(item => item.kind === 'mention').map(item => ({ id: item.id, from: item.from, title: item.title, detail: item.detail, at: item.at, channelId: item.channelId, messageId: item.messageId, taskId: item.taskId })), [inbox]);
  const snoozeKey = sidebar.snoozes.map(item => `${item.id}:${item.until}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const awareAttention = useMemo(() => attentionFor(state, minute * 60000, actor, sidebar.snoozes), [state, minute, actor, snoozeKey]);
  const view: View = requested;

  // When temporary access ends, close anything opened with it.
  useEffect(() => {
    if (!focused || !taskId) return;
    if (taskId !== state.focus?.taskId && !grant) setTaskId(null);
  }, [focused, grant, taskId, state.focus]);

  function go(next: View) {
    next = canonicalPage(next) as View;
    setRequested(next);
    setTaskId(null);
    setRoomId(null);
    history.pushState(null, '', next === 'leads' && leadId ? `#/leads/${leadId}` : `#/${next}`);
  }
  /** Creating → created: the same workspace evolves into the task. Uses a view transition where the
   * browser supports it (and motion is allowed); otherwise the swap is immediate. */
  function evolve(change: () => void) {
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!doc.startViewTransition || still) { change(); return; }
    doc.startViewTransition(() => flushSync(change));
  }
  function openTask(id: string) {
    setTaskId(id);
    history.replaceState(null, '', `#/task/${id}`);
  }
  function closeTask() {
    setTaskId(null);
    history.replaceState(null, '', view === 'all-tasks' && isCompletedQuery(registryView) ? '#/all-tasks/completed' : `#/${view}`);
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

  function openSearchResult(result: SearchResult) {
    const t = result.target;
    const hash = t.view === 'inbox' ? `#/inbox/${encodeURIComponent(t.channelId ?? '')}/${encodeURIComponent(t.messageId ?? '')}` : `#/${t.view}/${encodeURIComponent(t.id)}`;
    if (live && result.workspaceId !== live.org.id) { live.onOpenWorkspace?.(result.workspaceId, hash); return; }
    location.hash = hash;
    if (t.view === 'task') openTask(t.id);
    else if (t.view === 'leads') openLead(t.id);
    else { setRequested((t.view === 'inbox' ? 'inbox' : t.view === 'feedback' ? 'feedback' : t.view === 'tools' ? 'tools' : 'activity')); if (t.view === 'feedback') setFeedbackId(t.id); }
  }

  function openCompleted(scope = registryView.scope) {
    setPreset(current => ({ lens: 'all', changes: completedQuery(scope), nonce: (current?.nonce ?? 0) + 1 }));
    setRequested('all-tasks'); setTaskId(null);
    if (location.hash !== '#/all-tasks/completed') history.pushState(null, '', '#/all-tasks/completed');
  }

  // Top-bar task views: each opens All Tasks on that view and changes nothing else.
  function openLens(lens: Lens) {
    setPreset(current => isCompletedQuery(registryView)
      ? { lens, changes: { ...registryView, lens, status: 'open' }, nonce: (current?.nonce ?? 0) + 1 }
      : { lens, keep: true, nonce: (current?.nonce ?? 0) + 1 });
    setRequested('all-tasks'); setTaskId(null);
    if (location.hash !== `#/all-tasks/${lens}`) history.pushState(null, '', `#/all-tasks/${lens}`);
  }

  const mineCount = myTasks(state, actor, now).length;
  const attention = insights(state, now);
  const myAttention = insightsFor(state, now, actor).filter(item => item.severity !== 'normal').length;
  const leadAttention = activeLeads(state).filter(lead => leadBucket(state, lead, now) !== 'responded').length;
  const canCreate = canCreateTask(state, actor, now);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const counts = useMemo(() => lensCounts(state, actor, minute * 60000), [state, actor, minute]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const topCounts = useMemo(() => Object.fromEntries(LENSES.map(lens => [lens, queryTasks(state, actor, minute * 60000, { ...registryView, lens, status: isCompletedQuery(registryView) ? 'open' : registryView.status }).length])) as Record<Lens, number>, [state, actor, minute, registryView]);
  const taskTabs = LENSES.map(lens => ({ id: lens as string, label: lens === 'all' ? 'All' : LENS_LABELS[lens], count: topCounts[lens], hot: (lens === 'overdue' || lens === 'urgent') && topCounts[lens] > 0, active: view === 'all-tasks' && !isCompletedQuery(registryView) && registryView.lens === lens }));
  taskTabs.splice(1, 0, { id: 'completed', label: 'Completed', count: queryTasks(state, actor, now, completedQuery(registryView.scope)).length, hot: false, active: view === 'all-tasks' && isCompletedQuery(registryView) });
  const openCompany = state.tasks.filter(task => task.status !== 'done');
  const info: Partial<Record<View, string>> = {
    home: mineCount ? `${mineCount} open ${mineCount === 1 ? 'task' : 'tasks'} on your plate.` : 'Nothing assigned right now.',
    'all-tasks': `${counts.all} open · ${counts.urgent} urgent · ${counts.overdue} overdue.`,
    'company-work': `${openCompany.length} open across ${new Set(openCompany.map(task => task.owner).filter(Boolean)).size} people.`,
    'needs-attention': `${myAttention} conditions for you · ${attention.length} conditions workspace-wide.`,
    leads: leadAttention ? `${leadAttention} ${leadAttention === 1 ? 'lead needs' : 'leads need'} a response or next step.` : 'Every active lead has a next step.',
    people: `${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}${live ? ` in ${live.org.name}` : ' · synthetic team'}.`,
    activity: 'Who did what, and when.',
    feedback: `${state.feedback.filter(item => item.status !== 'resolved').length} open.`,
    settings: 'Policy, workspace and backups.',
    tools: tools ? `${tools.estimates.length} estimates · ${tools.proposals.length} proposals · sample data.` : 'Not available in live workspaces yet.',
    inbox: inboxUnread ? `${inboxUnread} unread across your workspaces.` : 'All caught up.',
    executive: decisions ? `${decisions} ${decisions === 1 ? 'decision needs' : 'decisions need'} your authority.` : 'No decisions are waiting on you.',
  };
  function openNotification(note: Notification) {
    const { taskId: noteTask, leadId: noteLead, view: noteView } = note.target;
    if (noteTask) { if (!SIGNAL_VIEWS.includes(view) && view !== 'executive') go('all-tasks'); openTask(noteTask); return; }
    if (noteLead) { openLead(noteLead); return; }
    go(noteView ?? 'needs-attention');
  }

  const navigation: { id: View; label: string; count?: number; countLabel?: string; hot?: boolean; preview?: boolean; icon: ReactNode }[] = [
    // Everyday work. Reports (company measures) and Owner overview (decisions) are separate pages.
    { id: 'home', label: 'Home', icon: <Icon d="M3 11l9-8 9 8M5 10v11h14V10M10 21v-7h4v7" /> },
    { id: 'calendar', label: 'Calendar', icon: <Icon d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /> },
    { id: 'all-tasks', label: 'Tasks', count: counts.all, countLabel: 'open tasks', icon: <Icon d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /> },
    { id: 'inbox', label: 'Inbox', count: inboxUnread, countLabel: 'unread updates', hot: inboxUnread > 0, icon: <Icon d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z" /> },
    { id: 'reports', label: 'Reports', icon: <Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
    { id: 'needs-attention', label: 'Needs Attention', count: attention.length, countLabel: 'conditions', hot: myAttention > 0, icon: <Icon d="M12 4 21 20H3zM12 10v4M12 17v.5" /> },
    { id: 'company-work', label: 'Projects', count: openCompany.length, countLabel: 'open tasks', icon: <Icon d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" /> },
    { id: 'people', label: 'People & Access', count: state.people.length, countLabel: 'people', icon: <Icon d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" /> },
    // Oversight, not a place: the same eye the task page uses for Watch.
    { id: 'executive' as View, label: 'Owner overview', count: decisions, countLabel: decisions === 1 ? 'decision' : 'decisions', hot: decisions > 0, icon: <Icon d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /> },
    { id: 'activity', label: 'Activity', icon: <Icon d="M4 12h4l3-7 3 14 3-7h3" /> },
    { id: 'settings', label: 'Settings', icon: <Icon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3" /> },
    // Preview modules: still reachable, kept out of the everyday list (see the Previews group).
    { id: 'workbook', label: 'Operations Workbook', icon: <Icon d="M3 4h18v16H3zM3 9h18M8 4v16M14 4v16" /> },
    { id: 'tools' as View, label: 'Estimates & Proposals', count: tools?.estimates.filter(item => item.status !== 'approved').length, icon: <Icon d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5" /> },
    { id: 'leads', label: 'First Response', count: leadAttention, hot: leadAttention > 0, icon: <Icon d="M13 3 5 14h6l-1 7 8-11h-6z" /> },
    { id: 'relationships', label: 'Relationship Vault', icon: <Icon d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4" /> },
    { id: 'feedback' as View, label: 'Feedback', count: feedbackOn ? state.feedback.filter(item => item.status !== 'resolved').length : undefined, icon: <Icon d="M4 5h16v11H9l-5 4z" /> },
    { id: 'agents' as View, label: 'Agent pilot', icon: <Icon d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21a7 7 0 0 1 14 0" /> },
  ];
  for (const item of navigation) if (pageStatus(item.id) === 'preview') item.preview = true;
  // Archived modules leave navigation; their routes and data stay (see ARCHIVED_PAGES).
  for (let i = navigation.length - 1; i >= 0; i--) if (ARCHIVED_PAGES.includes(navigation[i]!.id as AppPageId)) navigation.splice(i, 1);

  const selected = taskId ? taskById(whole.state, taskId) : undefined;
  const contextAllowed = selected && (!focused || selected.id === state.focus?.taskId || !!grant);
  // The everyday sections sit in the top navigation on wide screens; the rail keeps the rest.
  // Phones keep the full list in the menu (the top navigation is hidden there).
  const topSections = (['home', 'all-tasks', 'company-work', 'calendar', 'reports', 'inbox'] as View[])
    .map(id => navigation.find(item => item.id === id)).filter(item => !!item)
    .map(item => ({ id: item.id, label: item.id === 'all-tasks' ? 'Tasks' : item.label, count: item.id === 'inbox' ? item.count : undefined, hot: item.hot, active: view === item.id && !(selected && contextAllowed) }));
  // Calendar stays in the rail on wide screens as the calendar quick view (the top bar's Calendar is the full page).
  const railItems = sidebar.isMobile ? navigation : navigation.filter(item => item.id === 'calendar' || !topSections.some(top => top.id === item.id));

  // Left and right panels keep independent open state (core/layout.ts): opening one never closes the other.
  // Short on room, the left panel narrows first; a right panel that still can't dock becomes a drawer.
  // The Home screen's Calendar button needs the same access as Company Work.
  const deckAllowed = SIGNAL_VIEWS.includes(view) && !focused;

  // Two pullouts. Left: the calendar quick view, opened by the rail's Calendar icon (not in Critical Focus).
  // Right: Notifications and Ask share an in-flow desktop pane; phones use a full-width panel.
  // Both start closed. On a phone opening notifications closes the navigation menu.
  const calendarAllowed = !focused;
  const rightPanelOpen = notifOpen || (askOpen && !focused);
  const restoreCalendar = useRef(false);
  useEffect(() => { restoreCalendar.current = false; }, [actor, state.workspace.tenantId]);
  const edgePanelOpen = rightPanelOpen || (sidebar.isMobile && mobileCalendarOpen);
  const panelScroll = useRef<{ x: number; y: number; route: string } | null>(null);
  useLayoutEffect(() => {
    if (edgePanelOpen) {
      panelScroll.current = { x: window.scrollX, y: window.scrollY, route: location.hash };
      return;
    }
    const saved = panelScroll.current;
    panelScroll.current = null;
    if (!saved || saved.route !== location.hash) return;
    const frame = requestAnimationFrame(() => {
      if (saved.route === location.hash) window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [edgePanelOpen]);
  // Calendar owns the persisted, clamped panel width; both right panes reuse it.
  // V5/V6 proportions: a 320px right panel on wide screens; narrower below 1280px so both panels still fit beside the center.
  const rightPanelWidth = width >= 1280 ? 320 : 272;
  const room: PulloutRoom = { viewport: width, mobile: sidebar.isMobile, calendarWidth: sidebar.width, notificationsWidth: rightPanelWidth, minCanvasBoth: MIN_CANVAS_BOTH, minCanvas: MIN_CANVAS };
  useEffect(() => {
    if (!sidebar.isMobile && rightPanelOpen && sidebar.open && !bothFit(room)) {
      restoreCalendar.current = true;
      sidebar.toggle();
    }
  }, [width, sidebar.width, sidebar.isMobile, rightPanelOpen, sidebar.open]);
  const pullouts: Pullouts = { calendar: !sidebar.isMobile && calendarAllowed && sidebar.open, notifications: rightPanelOpen };
  function showPullouts(next: Pullouts) {
    if (!next.notifications) { setNotifOpen(false); setAskOpen(false); }
    if (!sidebar.isMobile && next.calendar !== sidebar.open) sidebar.toggle();
  }
  function prepareRightPanel() {
    if (sidebar.isMobile) { sidebar.closeMobile(); return; }
    const opened = openTemporaryRight(pullouts, room);
    restoreCalendar.current ||= opened.restoreCalendar;
    showPullouts(opened.next);
  }
  function closeRightPanel() {
    const next = closeTemporaryRight(pullouts, restoreCalendar.current && calendarAllowed, room);
    restoreCalendar.current = false;
    showPullouts(next);
  }
  /** Home's Calendar and Insights entries open the calendar sheet. */
  function openDeck(_section: DeckSection) { openCalendar(); }
  /** Calendar quick view: the left panel on wide screens (opened from the rail's Calendar icon), a full-width panel on phones. */
  function openCalendar() {
    if (!calendarAllowed) { go('calendar'); return; }
    if (sidebar.isMobile) { setNotifOpen(false); setAskOpen(false); sidebar.closeMobile(); setMobileCalendarOpen(true); return; }
    if (!pullouts.calendar) toggleLeft();
  }
  /** One left panel: the calendar quick view on top, your work views below. */
  function toggleLeft() {
    restoreCalendar.current = false;
    showPullouts(togglePullout(pullouts, 'calendar', room));
  }
  /** The bell: Inbox in the right drawer. Pressing it again closes it. */
  function toggleNotifications() {
    if (notifOpen) { closeRightPanel(); return; }
    setAskOpen(false);
    prepareRightPanel();
    setNotifOpen(true);
    setAskOpenLast(false);
  }
  function toggleAsk() {
    if (askOpen) { closeRightPanel(); return; }
    prepareRightPanel();
    setNotifOpen(false);
    setAskOpen(true);
    setAskOpenLast(true);
  }
  const contextOffset = !sidebar.isMobile && rightPanelOpen ? rightPanelWidth : 0;
  // The full Calendar is the page's primary workspace: the left quick view (a second grid) steps aside there.
  const calendarPage = view === 'calendar' && !sidebar.isMobile;
  const leftReserved = pullouts.calendar && !calendarPage ? sidebar.width : 0;
  const today = localDate(now);
  const dueToday = state.tasks.filter(task => task.status !== 'done' && task.due === today && (company || task.owner === actor)).length;


  // Bottom dock: on every primary route (wide screens). The shell then holds the viewport and the center scrolls inside it.
  const hasDock = DOCK_VIEWS.includes(view) && !focused && !sidebar.isMobile;

  return (
    <div className={`shell ${focused ? 'is-focus' : ''} ${live ? 'is-live' : 'is-demo'} ${hasDock ? 'has-dock' : ''} ${calendarPage ? 'is-calendar-page' : ''}`}
      style={{ ...sidebar.shellStyle, ...(sidebar.isMobile ? {} : { ['--panel-offset' as string]: `${leftReserved}px` }), ['--context-offset' as string]: `${contextOffset}px` }}
      data-sidebar={sidebar.isMobile ? undefined : sidebar.open ? 'open' : 'closed'} data-context={contextOffset ? 'open' : 'closed'} data-dock={hasDock ? (dockOpen ? 'open' : 'closed') : undefined} data-resizing={sidebar.resizing || undefined}>
      <Sidebar
        control={sidebar}
        notifications={notifications}
        settings={close => <>
          <p className="menu-note"><b>Settings</b>{live ? '' : <><br />Task-HQ Demo · synthetic people and data</>}</p>
          <div className="rail-settings-look"><LookSwitch /></div>
          <button type="button" role="menuitem" onClick={() => { close(); go('people'); }}>People &amp; access</button>
          <button type="button" role="menuitem" onClick={() => { close(); go('settings'); }}>Workspace settings<small>People, work, policy and data</small></button>
          {!live && onExitDemo && <button type="button" role="menuitem" onClick={() => { close(); onExitDemo(); }}>Sign in to Task HQ</button>}
        </>}
        account={{ label: me.name && !me.name.includes('@') ? me.name : live?.email ?? me.name, detail: live ? ROLE_LABELS[live.role] : me.title, mark: <AccountMark quest={quest} />, menu: close => <AccountMenu quest={quest} close={close} /> }}
        pulloutTitle={calendarAllowed ? 'Calendar' : 'Your work'}
        pullout={<div className="left-stack">
          {calendarAllowed && view !== 'calendar' && <CalendarPullout quest={quest} company={company} dayList={false} onOpenTask={openTask} onExpandCalendar={() => go('calendar')} onCreate={canCreate ? due => createOn(due) : undefined} />}
          {view !== 'calendar' && <WorkNavigator lenses={taskTabs} projects={state.projects} onLens={id => { if (id === 'completed') openCompleted(); else openLens(id as Lens); }} onProjects={() => go('company-work')} />}
        </div>}
        brand={<a className="brand" href="#/home" aria-label="Task-HQ — Home" onClick={event => { event.preventDefault(); go('home'); sidebar.afterNavigate(); }}><BrandMark /></a>}
        items={railItems.map(item => ({ id: item.id, label: item.label, icon: item.icon, count: item.count, countLabel: item.countLabel, hot: item.hot, preview: item.preview, active: item.id === 'calendar' && !sidebar.isMobile ? pullouts.calendar : view === item.id, info: item.id === 'calendar' && !sidebar.isMobile ? 'Quick view · opens beside the page' : info[item.id] }))}
        onSelect={id => id === 'all-tasks' ? openLens(registryView.lens) : id === 'calendar' && !sidebar.isMobile ? (calendarAllowed ? toggleLeft() : go('calendar')) : go(id as View)}
        create={{ enabled: canCreate, onCreate: () => setCreating(true) }}
        footer={live
          ? <><ModeChip quest={quest} /><p>Signed in as {me.name && !me.name.includes('@') ? me.name : live.email} · {ROLE_LABELS[live.role]}{live.isPlatformAdmin ? ' · platform admin (separate)' : ''}</p><button type="button" className="link exit-demo" onClick={live.onSignOut}>Sign out</button></>
          : <><ModeChip quest={quest} /><p><b>Task-HQ Demo</b> · synthetic people and data. Changes stay on this device; teammates are not notified.</p>{onExitDemo && <button type="button" className="link exit-demo" onClick={onExitDemo}>Sign in to Task HQ</button>}</>}
      />
      <main className="main" inert={sidebar.isMobile && edgePanelOpen}>
        {!live && onExitDemo && <aside className="demo-access" aria-label="Task HQ demo">
          <div><strong>Task HQ Demo</strong><span>Sample data · changes stay on this device</span></div>
          <button type="button" className="btn btn-primary cta-fill" onClick={onExitDemo}><span className="cta-fill-label">Sign in to Task HQ</span><CtaArrow /></button>
        </aside>}
        <TopBar quest={quest} demo={!live} focused={focused} unread={inboxUnread} askOpen={askOpen} notifOpen={notifOpen}
          title={(VIEW_LABELS[view] ?? '').replace(' · Preview', '')}
          sections={topSections} onSection={id => id === 'all-tasks' ? openLens(registryView.lens) : go(id as View)}
          // No New task in the header: creating lives in the right panel's Task action (and N, and the phone's + button).
          search={<TopSearch quest={whole} data={inboxData} tools={tools} onOpen={openSearchResult} />} onAsk={toggleAsk} onBell={toggleNotifications}
          onMenu={() => {
            restoreCalendar.current = false; setMobileCalendarOpen(false);
            // Wide screens: the menu button opens and closes the left "Your work" panel.
            if (!sidebar.isMobile) { toggleLeft(); return; }
            setNotifOpen(false); setAskOpen(false); sidebar.openMobile();
          }} menuOpen={sidebar.isMobile ? sidebar.mobileOpen : pullouts.calendar} />



        {quest.feedback.cue && <FeedbackBar quest={quest} preferences={feedbackOn} onViewCompleted={() => { const task = state.tasks.find(task => task.id === quest.feedback.cue?.taskId); openCompleted(task?.owner === actor ? 'mine' : 'company'); }} />}
        {focused && grant && <GrantBar quest={quest} grant={grant} onReturn={() => { closeTask(); go('home'); }} />}

        <section className={`content view-${selected && contextAllowed ? 'task' : view}`}>
          {view === 'feedback' && !feedbackOn && <aside className="page-preview" role="status"><b>Preview</b><span>Feedback capture is archived. Existing records appear here only when available to this workspace account.</span></aside>}
          {!live && view === 'home' && !selected && <details className="demo-attendance" onToggle={event => setAttendanceDemo(event.currentTarget.open)}>
            <summary>Try attendance · sample data</summary>
            <p>Part of this demo. Use the account menu to try another demo person. No real attendance is recorded.</p>
            {attendanceDemo && <ShiftBridge quest={quest} />}
          </details>}
          {!(selected && contextAllowed) && PREVIEW_VIEWS.includes(view) && view !== 'agents' && <PreviewNotice view={view} live={!!live} />}
          {creating && canCreate ? <DraftTask key="draft-task" quest={whole} due={createDue} projectId={createProjectId}
              onCancel={() => { setCreating(false); setCreateDue(undefined); setCreateProjectId(undefined); }}
              onCreated={id => evolve(() => { setCreating(false); setCreateDue(undefined); setCreateProjectId(undefined); openTask(id); })} />
          : selected && contextAllowed ? <TaskPage key={selected.id} quest={whole} task={selected} canCreate={canCreate} onClose={closeTask} onOpen={openTask} onCreate={() => setCreating(true)}
            onOpenDock={hasDock ? id => { setDockTask({ id, nonce: Date.now() }); setDock(current => (current.snap === 'collapsed' ? withSnap(current, current.last) : current)); } : undefined} />
            : focused && !grant && view === 'home'
            ? <CriticalFocus quest={quest} onOpen={openTask} />
            : view === 'home' ? <Home quest={quest} company={company} canCreate={canCreate} canDeck={deckAllowed}
                onOpen={openTask} onOpenLead={openLead} onCreate={() => setCreating(true)}
                onRegistry={openRegistry} onDeck={openDeck} onTeam={() => go('people')} focusTaskId={dockFocus} onClearFocus={() => setDockFocus(null)} onReports={() => go('reports')} />
            : view === 'all-tasks' ? <AllTasks quest={whole} selectedId={taskId} onSelect={openTask} onCreate={() => setCreating(true)} canCreate={canCreate} preset={preset} onPresetApplied={clearPreset} registry={registry}
                lenses={taskTabs} onLens={id => { if (id === 'completed') openCompleted(); else if (LENSES.includes(id as Lens)) openLens(id as Lens); else go(id as View); }} />
            : view === 'inbox' ? <Inbox quest={quest} data={inboxData} notes={notifications} read={sidebar.read} markRead={sidebar.markRead} onOpenTask={openTask} onOpenLead={openLead} />
            : view === 'workbook' ? <OperationsWorkbook key={`${state.workspace.tenantId}:${actor}`} />
            : view === 'tools' ? <Tools quest={quest} store={toolsStore} tools={tools} onOpenTask={openTask} />
            : view === 'reports' ? <Reports quest={quest} company={company} onOpenTask={openTask} onLens={lens => openLens(lens)} onCompleted={() => openCompleted('company')} />
            : view === 'executive' ? <ExecutiveDesk quest={quest} onOpenTask={openTask} onOpenLead={openLead} />
            : view === 'relationships' ? <Relationships quest={quest} onOpen={openTask} />
            : view === 'people' ? <People quest={quest} />
            : view === 'calendar' ? <CalendarPage quest={quest} company={company} onOpenTask={openTask} onCreate={canCreate ? createOn : undefined}
                filters={taskTabs} projects={state.projects.length} onProjects={() => go('company-work')} />
            : view === 'feedback' ? <FeedbackInbox quest={quest} onOpen={id => { setFeedbackId(id); history.replaceState(null, '', `#/feedback/${id}`); }} />
            : view === 'company-work' && roomId ? <ProjectRoom quest={quest} projectId={roomId} company={company} onBack={() => { location.hash = '#/company-work'; }} onOpenTask={openTask}
                onAddTask={canCreate ? projectId => { setCreateProjectId(projectId); setCreating(true); } : undefined} />
            : view === 'company-work' ? <CompanyWork quest={quest} onOpen={openTask} onOpenRoom={id => { location.hash = `#/company-work/${encodeURIComponent(id)}`; }}
                onCreateProject={canCreateProject(state, actor) ? () => setCreatingProject(true) : undefined}
                onAddTask={canCreate ? projectId => { setCreateProjectId(projectId); setCreating(true); } : undefined} />
            : view === 'needs-attention' ? <NeedsAttention quest={quest} onOpen={openTask} />
            : view === 'leads' ? <SpeedToLead quest={quest} onOpen={openTask} selectedLead={leadId} onSelectLead={id => { setLeadId(id); history.replaceState(null, '', id ? `#/leads/${id}` : '#/leads'); }} />
            : view === 'activity' ? <Activity quest={whole} onOpen={openTask} />
            : view === 'settings' ? <Settings quest={quest} onPeople={() => go('people')} />
            : <PagePreview title="Agent pilot" detail="This pilot is not connected to an agent service or workspace data. No tasks are sent and no outcomes are generated here." />}
        </section>

        {/* Bottom collaboration dock: in the main column, so expanding it takes height from the center. */}
        {hasDock && <CollabDock quest={quest} company={company} snap={dock.snap} onSnap={snap => setDock(current => withSnap(current, snap))}
          onToggle={() => setDock(current => withSnap(current, current.snap === 'collapsed' ? current.last : 'collapsed'))} tab={dockTab} onTab={setDockTab}
          inbox={inbox} data={inboxData} read={sidebar.read} markRead={sidebar.markRead} mentions={mentions}
          onOpen={openTask} onOpenLead={openLead} onActivity={() => go('activity')} onOpenInboxPage={() => go('inbox')} onFocusTask={setDockFocus}
          contextTaskId={selected && contextAllowed ? selected.id : null} openTask={dockTask} />}

        <nav className="tabbar" aria-label="Task-HQ sections">
          {[
            { id: 'home' as View, label: 'Home', hot: false, icon: <Icon d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /> },
            { id: 'all-tasks' as View, label: 'Tasks', hot: false, icon: <Icon d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /> },
            ...(calendarAllowed ? [{ id: 'calendar' as View, label: 'Calendar', hot: false, icon: <Icon d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /> }] : []),
            ...(['inbox', 'needs-attention'] as View[]).map(id => navigation.find(item => item.id === id)).filter(item => !!item),
          ].map(item => {
            return (
              <button key={item.id} type="button" className={`${view === item.id || (item.id === 'calendar' && mobileCalendarOpen) ? 'is-active' : ''}`}
                onClick={() => (item.id === 'all-tasks' ? openLens(registryView.lens) : item.id === 'calendar' ? openCalendar() : go(item.id))}>
                {item.icon}<span>{item.label.replace('Owner overview', 'Overview')}</span>
                {item.hot && <i className="tab-dot" />}
              </button>
            );
          })}
        </nav>
      </main>

      {selected && !contextAllowed && (
        <div className="locked-note" role="alert">“{selected.title}” is outside your Critical Focus. Request access to {SECTION_LABELS['company-work']} first. <button className="btn btn-ghost btn-sm" onClick={closeTask}>Close</button></div>
      )}
      {/* One right panel, under the top-right bell and Ask. Switching between them swaps the content in
          place (both stay mounted, so an open thread or an Ask conversation survives); only closing slides it away. */}
      <div className="notification-edge">
        <EdgeDrawer id="right-edge-drawer" open={rightPanelOpen} label={askOpen && !focused ? 'Ask your tasks' : 'Notifications'} className="right-edge" onClose={closeRightPanel} modal={sidebar.isMobile}>
          <div className="right-slot" hidden={askOpen && !focused}>
            <NotificationDrawer key={`${state.workspace.tenantId}:${actor}`} embedded quest={quest} control={sidebar} inbox={inbox} attention={awareAttention} data={inboxData} detailsAllowed={!focused || !!grant} open={notifOpen}
              threadAllowed={id => !focused || id === state.focus?.taskId || !!grant}
              onClose={closeRightPanel}
              onOpenTask={id => { if (!SIGNAL_VIEWS.includes(view) && view !== 'executive' && view !== 'inbox') go('all-tasks'); openTask(id); }}
              onOpenLead={openLead} onOpenInbox={() => go('inbox')} onOpenAttention={() => go('needs-attention')} onOpenActivity={() => go('activity')}
              context={sidebar.isMobile || focused ? undefined : {
                company, onOpenProjects: () => go('company-work'), onOpenCalendar: calendarAllowed ? () => go('calendar') : undefined, onCreate: canCreate ? () => setCreating(true) : undefined,
                onOpenAttention: () => go('needs-attention'), onOpenNextAll: () => openLens('all'), onOpenActivity: () => go('activity'),
                onOpenTask: id => { if (!SIGNAL_VIEWS.includes(view) && view !== 'executive' && view !== 'inbox') go('all-tasks'); openTask(id); },
              }} />
          </div>
          {!focused && <div className="right-slot" hidden={!askOpen}>
            <AskTasks key={`ask:${state.workspace.tenantId}:${actor}`} embedded quest={quest} company={company} open={askOpen} onClose={closeRightPanel} />
          </div>}
        </EdgeDrawer>
      </div>
      {/* Edge toggles sit on each panel's inner border and stay visible when it's collapsed. */}
      {!sidebar.isMobile && <>
        {!calendarPage && <button type="button" className="seam seam-left" aria-controls="quest-sidebar" aria-expanded={pullouts.calendar}
          aria-label={pullouts.calendar ? 'Close the calendar panel' : 'Open the calendar panel'}
          title={pullouts.calendar ? 'Close panel' : 'Calendar and your work'} onClick={toggleLeft}>
          <Icon d={pullouts.calendar ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
        </button>}
        <button type="button" className="seam seam-right" aria-controls="right-edge-drawer" aria-expanded={rightPanelOpen}
          aria-label={rightPanelOpen ? 'Close the right panel' : 'Open notifications'} title={rightPanelOpen ? 'Close panel' : 'Notifications'}
          onClick={() => (rightPanelOpen ? closeRightPanel() : askOpenLast && !focused ? toggleAsk() : toggleNotifications())}>
          <Icon d={rightPanelOpen ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </button>
      </>}
      {sidebar.isMobile && <div className="notification-edge calendar-edge">
        <EdgeDrawer id="calendar-quick-drawer" label="Calendar quick view" className="calendar-mobile-drawer" open={mobileCalendarOpen && calendarAllowed} onClose={() => setMobileCalendarOpen(false)}>
          <header className="context-head"><span className="context-label">Calendar</span><button type="button" className="icon-btn" aria-label="Close Calendar quick view" onClick={() => setMobileCalendarOpen(false)}>×</button></header>
          <div className="context-body"><CalendarPullout quest={quest} company={company} onOpenTask={id => { setMobileCalendarOpen(false); openTask(id); }}
            onExpandCalendar={() => { setMobileCalendarOpen(false); go('calendar'); }} onCreate={canCreate ? due => { setMobileCalendarOpen(false); createOn(due); } : undefined} /></div>
        </EdgeDrawer>
      </div>}
      {canCreate && !focused && !creating && <button type="button" className="fab-create" aria-label="New task" title="New task" onClick={() => setCreating(true)}><Icon d="M12 5v14M5 12h14" /></button>}
      {creatingProject && <CreateProject quest={quest} onClose={() => setCreatingProject(false)} onCreated={(projectId, addTask) => {
        setCreatingProject(false);
        if (addTask && canCreate) { setCreateProjectId(projectId); setCreating(true); }
      }} />}
      {feedbackOn && <ReviewLayer quest={quest} openRequest={reviewRequest}
        screen={{ view: VIEW_LABELS[view], route: `#/${view}${view === 'leads' && leadId ? `/${leadId}` : ''}`, taskId: selected?.id ?? '', leadId: view === 'leads' && leadId ? leadId : '', deck: view === 'leads' && leadId ? 'lead' : selected ? 'task' : '' }}
        itemId={feedbackId} onItem={id => { setFeedbackId(id); if (!id && location.hash.startsWith('#/feedback/')) history.replaceState(null, '', '#/feedback'); }}
        onNavigate={target => {
          setFeedbackId(null);
          if (target.taskId) { openTask(target.taskId); return; }
          if (target.leadId) { openLead(target.leadId); return; }
          if (target.route) { location.hash = target.route; }
        }} />}
      <ToastBar toast={quest.feedback.cue?.text === quest.toast?.text ? null : quest.toast} onUndo={eventId => void dispatch({ type: 'undo', eventId })} onDismiss={quest.dismissToast} />
    </div>
  );
}

export function Icon({ d }: { d: string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
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

function PagePreview({ title, detail }: { title: string; detail: string }) {
  return <div className="view page-preview-view"><header className="view-head"><div><p className="eyebrow">Preview</p><h1>{title}</h1><p className="lede">{detail}</p></div></header></div>;
}
