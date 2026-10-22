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
import { LEGACY_LENSES, LENSES, LENS_LABELS, lensCounts, queryTasks } from '../core/registry.ts';
import { canCreateTask } from '../core/permissions.ts';
import { insights, insightsFor } from '../core/rules.ts';
import { activeGrant, activeLeads, canEnter, inFocus, leadBucket, manages, myTasks, person, taskById } from '../core/selectors.ts';
import AgentWorkspace from '../AgentWorkspace.tsx';
import { LookSwitch, ModeChip, BrandMark, ToastBar } from '../ui/components.tsx';
import { useQuest } from '../ui/useQuest.ts';
import type { Quest } from '../ui/useQuest.ts';
import { AllTasks, useRegistryPrefs } from './AllTasks.tsx';
import type { RegistryPreset } from './AllTasks.tsx';
import { CompanyWork } from './CompanyWork.tsx';
import { CalendarPage, CalendarSidebar } from './ContextPanel.tsx';
import { TaskPage } from './TaskPage.tsx';
import type { DeckSection } from './ContextPanel.tsx';
import { CreateTask } from './CreateTask.tsx';
import { ExecutiveDesk } from './ExecutiveDesk.tsx';
import { Activity, Settings } from './Settings.tsx';
import { Home } from './Home.tsx';
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
import { PANEL_MIN, Sidebar, useSidebar } from './Sidebar.tsx';
import { Awareness } from './Awareness.tsx';
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
import { CLOSED, UNDER_CONSTRUCTION, canManage, canNavigate, isManageView } from '../core/navigation.ts';
import { panelLayout } from '../core/layout.ts';
import type { Notification } from './notifications.ts';

// Product feedback is archived: hidden for every account. Stored feedback is kept.
const FEEDBACK_ON = false;

export type View = 'home' | 'reports' | 'all-tasks' | 'inbox' | 'tools' | 'company-work' | 'needs-attention' | 'leads' | 'executive' | 'people' | 'feedback' | 'activity' | 'settings' | 'agents' | 'relationships' | 'calendar' | 'workbook';

// All Tasks shows company-wide work, so Critical Focus gates it exactly like Company Work.
const VIEW_SECTION: Record<View, Section | 'my-work' | 'never'> = {
  workbook: 'my-work', home: 'my-work', calendar: 'my-work', reports: 'never', relationships: 'leads', 'all-tasks': 'company-work', inbox: 'never', tools: 'never', 'company-work': 'company-work', 'needs-attention': 'needs-attention', leads: 'leads', feedback: 'my-work',
  executive: 'never', people: 'never', activity: 'never', settings: 'never', agents: 'never',
};

const VIEW_LABELS: Record<View, string> = {
  workbook: 'Operations Workbook · Preview', home: 'Home', calendar: 'Calendar', reports: 'Reports', relationships: 'Relationship Vault', 'all-tasks': 'All Tasks', inbox: 'Inbox', tools: 'Estimates & Proposals', 'company-work': 'Projects', 'needs-attention': 'Needs Attention', leads: 'First Response',
  executive: 'Executive Desk', people: 'Team', feedback: 'Feedback', activity: 'Activity', settings: 'Policy & data', agents: 'Agent pilot',
};

/** Views where the Instrument Deck (signals, calendar, insights) is useful beside the canvas. */
const SIGNAL_VIEWS: View[] = ['home', 'all-tasks', 'company-work', 'needs-attention'];
const SIGNAL_PANEL = 288;
/** The canvas never gets narrower than this because of a docked panel. */
const MIN_CANVAS = 600;
/** With the left panel open too, the canvas may narrow further before the right panel overlays. */
const MIN_CANVAS_BOTH = 480;

function parseHash(): { view: View; taskId: string | null; leadId: string | null; feedbackId: string | null; lens: { lens: Lens; changes?: Partial<RegistryQuery> } | null } {
  const [, first = '', second = ''] = location.hash.split('?')[0]!.split('/');
  if (first === 'task' && second) return { view: 'all-tasks', taskId: decodeURIComponent(second), leadId: null, feedbackId: null, lens: null };
  const views = Object.keys(VIEW_LABELS) as View[];
  return {
    view: views.includes(first as View) ? first as View : 'home', taskId: null,
    leadId: first === 'leads' && second ? decodeURIComponent(second) : null,
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

/** 'auto' shows signals only when there is something to say; the person can pin it open or closed. */
type ContextPref = 'auto' | 'open' | 'closed';
/** Which Instrument Deck section is showing; a per-viewer convenience on this device. */
function useDeckSection(actor: string): [DeckSection, (next: DeckSection) => void] {
  const key = `quest.deck-section.v1.${actor}`;
  const read = (): DeckSection => { try { const value = localStorage.getItem(key); return value === 'calendar' || value === 'insights' ? value : 'signals'; } catch { return 'signals'; } };
  const [section, setSection] = useState<DeckSection>(read);
  const [owner, setOwner] = useState(actor);
  if (owner !== actor) { setOwner(actor); setSection(read()); }
  return [section, next => { setSection(next); try { localStorage.setItem(key, next); } catch { /* this page only */ } }];
}

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
  return <FeedbackProvider feedback={quest.feedback}><ReferenceProvider scope={referenceScope(quest.state, quest.actor)} drafts={quest.referenceDrafts}><Shell quest={quest as Quest} onExitDemo={onExitDemo} /></ReferenceProvider></FeedbackProvider>;
}

function Shell({ quest, onExitDemo }: { quest: Quest; onExitDemo?: () => void }) {
  const { state, actor, now, dispatch } = quest;
  const live = useLive();
  const feedbackOn = FEEDBACK_ON;
  const initial = parseHash();
  const [requested, setRequested] = useState<View>(initial.view);
  const [taskId, setTaskId] = useState<string | null>(initial.taskId);
  const [leadId, setLeadId] = useState<string | null>(initial.leadId);
  const [creating, setCreating] = useState(false);
  const [attendanceDemo, setAttendanceDemo] = useState(false);
  // A due date chosen from the calendar, for the next task created.
  const [createDue, setCreateDue] = useState<string | undefined>();
  const createOn = (due: string) => { setCreateDue(due); setCreating(true); };
  const [askOpen, setAskOpen] = useState(false);
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
  const [contextPref, setContextPref] = useContextPref(actor);
  /** The deck as a drawer, when it was asked for but can't dock beside the canvas. */
  const [deckDrawer, setDeckDrawer] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      if (!next.taskId) setRequested(next.view);
      setTaskId(next.taskId);
      if (next.leadId) setLeadId(next.leadId);
      if (next.feedbackId) setFeedbackId(next.feedbackId);
      if (next.view === 'all-tasks') setPreset(current => ({ ...(next.lens ?? { lens: 'all' as Lens }), keep: !next.lens?.changes, nonce: (current?.nonce ?? 0) + 1 }));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setTaskId(null); setCreating(false); setDeckDrawer(false); collapseSidebar(); }
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
  // Team-wide panels and answers need the same access as Company Work.
  const company = me.role !== 'reviewer' && allowed('company-work');
  // Re-derived when state changes or each minute, not on every one-second clock tick.
  const minute = Math.floor(now / 60000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notifications = useMemo(() => notificationsFor(state, minute * 60000, actor), [state, minute, actor]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decisions = useMemo(() => decisionDesk(state, minute * 60000, actor).length, [state, minute, actor]);
  const hasDesk = manages(me) || decisions > 0;
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
  // The server's temporary navigation restrictions also apply to authenticated workspaces.
  const access = live?.navigation ?? CLOSED;
  // Work / Manage remains a role permission, separate from temporary navigation restrictions.
  const manager = canManage(live ? live.role : me.role === 'manager' ? 'owner' : me.role === 'coordinator' ? 'supervisor' : me.role);
  const open = (next: View) => (manager || !isManageView(next)) && (next !== 'tools' || me.role !== 'reviewer') && (next !== 'executive' || hasDesk) && canNavigate(access, next) && (next !== 'feedback' || feedbackOn);
  const underConstruction = () => quest.say(UNDER_CONSTRUCTION);
  const view: View = allowed(requested) && open(requested) && (requested !== 'executive' || hasDesk) ? requested : 'home';

  // A restricted address (typed, deep link, back button or a link inside a panel) lands on Home.
  useEffect(() => {
    if (open(requested)) return;
    setRequested('home');
    history.replaceState(null, '', '#/home');
  }, [requested, access]); // eslint-disable-line react-hooks/exhaustive-deps

  // When temporary access ends, close anything opened with it.
  useEffect(() => {
    if (!focused || !taskId) return;
    if (taskId !== state.focus?.taskId && !grant) setTaskId(null);
  }, [focused, grant, taskId, state.focus]);

  function go(next: View) {
    if (!open(next)) { underConstruction(); return; }
    setRequested(next);
    setTaskId(null);
    history.pushState(null, '', next === 'leads' && leadId ? `#/leads/${leadId}` : `#/${next}`);
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
    if (!open('leads')) { underConstruction(); return; }
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

  // Top-bar task views: each opens All Tasks on that view and changes nothing else.
  function openLens(lens: Lens) {
    if (!allowed('all-tasks')) return;
    setPreset(current => ({ lens, keep: true, nonce: (current?.nonce ?? 0) + 1 }));
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
  const topCounts = useMemo(() => Object.fromEntries(LENSES.map(lens => [lens, queryTasks(state, actor, minute * 60000, { ...registryView, lens }).length])) as Record<Lens, number>, [state, actor, minute, registryView]);
  const openCompany = state.tasks.filter(task => task.status !== 'done');
  const info: Partial<Record<View, string>> = {
    home: mineCount ? `${mineCount} open ${mineCount === 1 ? 'task' : 'tasks'} on your plate.` : 'Nothing assigned right now.',
    'all-tasks': `${counts.all} open · ${counts.urgent} urgent · ${counts.overdue} overdue.`,
    'company-work': `${openCompany.length} open across ${new Set(openCompany.map(task => task.owner).filter(Boolean)).size} people.`,
    'needs-attention': `${myAttention} for you · ${attention.length} workspace-wide.`,
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

  const navigation: { id: View; label: string; count?: number; hot?: boolean; icon: ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Icon d="M3 11l9-8 9 8M5 10v11h14V10M10 21v-7h4v7" /> },
    { id: 'all-tasks', label: 'All Tasks', count: counts.all, icon: <Icon d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /> },
    { id: 'calendar', label: 'Calendar', icon: <Icon d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /> },
    { id: 'inbox', label: 'Inbox', count: inboxUnread, hot: inboxUnread > 0, icon: <Icon d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z" /> },
    { id: 'workbook', label: 'Operations Workbook · Preview', icon: <Icon d="M3 4h18v16H3zM3 9h18M8 4v16M14 4v16" /> },
    { id: 'tools' as View, label: 'Estimates & Proposals', count: tools?.estimates.filter(item => item.status !== 'approved').length, icon: <Icon d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5" /> },
    { id: 'needs-attention', label: 'Needs Attention', count: attention.length, hot: myAttention > 0, icon: <Icon d="M12 4 21 20H3zM12 10v4M12 17v.5" /> },
    { id: 'leads', label: 'First Response', count: leadAttention, hot: leadAttention > 0, icon: <Icon d="M13 3 5 14h6l-1 7 8-11h-6z" /> },
    { id: 'executive' as View, label: 'Executive Desk', count: decisions, hot: decisions > 0, icon: <Icon d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" /> },
    { id: 'company-work', label: 'Projects', count: openCompany.length, icon: <Icon d="M3 8h18v12H3zM8 8V5h8v3M3 13h18" /> },
    { id: 'relationships', label: 'Relationship Vault', icon: <Icon d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4" /> },
    { id: 'people', label: 'Team', count: state.people.length, icon: <Icon d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" /> },
    { id: 'reports', label: 'Reports', icon: <Icon d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
    { id: 'activity', label: 'Activity', icon: <Icon d="M4 12h4l3-7 3 14 3-7h3" /> },
    ...(feedbackOn ? [{ id: 'feedback' as View, label: 'Feedback', count: state.feedback.filter(item => item.status !== 'resolved').length, icon: <Icon d="M4 5h16v11H9l-5 4z" /> }] : []),
    { id: 'settings', label: 'Policy & data', icon: <Icon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3" /> },
    ...(state.policy.agentPilot ? [{ id: 'agents' as View, label: 'Agent pilot', icon: <Icon d="M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 21a7 7 0 0 1 14 0" /> }] : []),
  ];

  const selected = taskId ? taskById(state, taskId) : undefined;
  const contextAllowed = selected && (!focused || selected.id === state.focus?.taskId || !!grant);

  // Left and right panels keep independent open state (core/layout.ts): opening one never closes the other.
  // Short on room, the left panel narrows first; a right panel that still can't dock becomes a drawer.
  const geometry = (rightOpen: boolean, rightWidth: number) => panelLayout({ viewport: width, mobile: sidebar.isMobile, leftOpen: sidebar.open, leftWidth: sidebar.width, leftMin: PANEL_MIN, rightOpen, rightWidth, minCanvas: MIN_CANVAS, minCanvasBoth: MIN_CANVAS_BOTH });
  // The deck shows team-wide counts, so Home needs the same access as Company Work.
  const deckAllowed = SIGNAL_VIEWS.includes(view) && !focused;
  const signalsWanted = !selected && deckAllowed
    && contextPref !== 'closed';
  const signalsFit = geometry(true, SIGNAL_PANEL).right === 'docked';
  const showSignals = signalsWanted && signalsFit;
  // A deck opened from the seam stays open: where it can't dock on desktop it shows as a drawer.
  const showDeckDrawer = !selected && deckAllowed && !signalsFit && (deckDrawer || (contextPref === 'open' && !sidebar.isMobile));
  /** Home's Calendar and Insights buttons: open the deck on that section, docked or as a drawer. */
  function openDeck(section: DeckSection) {
    if (signalsFit) setContextPref('open'); else setDeckDrawer(true);
  }
  // An open task is a full page in the canvas, so only the deck ever takes the right side.
  const contextOffset = showSignals ? SIGNAL_PANEL : 0;
  const leftReserved = geometry(showSignals, SIGNAL_PANEL).left;
  const deckOpen = showSignals || showDeckDrawer;
  const closeDeck = () => { setDeckDrawer(false); if (showSignals || contextPref === 'open') setContextPref('closed'); };
  const signalSeam = !selected && deckAllowed && !sidebar.isMobile;

  return (
    <div className={`shell ${focused ? 'is-focus' : ''} ${live ? 'is-live' : 'is-demo'}`}
      style={{ ...sidebar.shellStyle, ...(sidebar.isMobile ? {} : { ['--panel-offset' as string]: `${leftReserved}px` }), ['--context-offset' as string]: `${contextOffset}px` }}
      data-sidebar={sidebar.isMobile ? undefined : sidebar.open ? 'open' : 'closed'} data-context={contextOffset ? 'open' : 'closed'} data-resizing={sidebar.resizing || undefined}>
      <Sidebar
        control={leftReserved && leftReserved !== sidebar.width ? { ...sidebar, width: leftReserved } : sidebar}
        notifications={notifications}
        settings={close => <>
          <p className="menu-note"><b>Settings</b>{live ? '' : <><br />Task-HQ Demo · synthetic people and data</>}</p>
          <div className="rail-settings-look"><LookSwitch /></div>
          {open('people') && allowed('people') && <button type="button" role="menuitem" onClick={() => { close(); go('people'); }}>People &amp; access</button>}
          {open('settings') && allowed('settings') && <button type="button" role="menuitem" onClick={() => { close(); go('settings'); }}>Workspace settings<small>Policy &amp; data</small></button>}
          {!live && onExitDemo && <button type="button" role="menuitem" onClick={() => { close(); onExitDemo(); }}>Sign in to Task HQ</button>}
        </>}
        account={{ label: me.name && !me.name.includes('@') ? me.name : live?.email ?? me.name, detail: live ? ROLE_LABELS[live.role] : me.title, mark: <AccountMark quest={quest} />, menu: close => <AccountMenu quest={quest} close={close} /> }}
        awareness={<Awareness quest={quest} control={sidebar} inbox={inbox} attention={awareAttention}
          onOpenTask={id => { if (!SIGNAL_VIEWS.includes(view) && view !== 'executive' && view !== 'inbox') go('all-tasks'); openTask(id); }}
          onOpenLead={openLead} onOpenInbox={() => go('inbox')} onOpenAttention={() => go('needs-attention')} onOpenActivity={() => go('activity')} />}
        brand={<a className="brand" href="#/home" aria-label="Task-HQ — Home" onClick={event => { event.preventDefault(); go('home'); sidebar.afterNavigate(); }}><BrandMark /></a>}
        items={navigation.map(item => ({ id: item.id, label: item.label, icon: item.icon, count: item.count, hot: item.hot, active: view === item.id, locked: !allowed(item.id), restricted: !open(item.id), preview: PREVIEW_VIEWS.includes(item.id), info: info[item.id] }))}
        onSelect={id => go(id as View)}
        create={{ enabled: canCreate, onCreate: () => setCreating(true) }}
        footer={live
          ? <><LookSwitch compact /><ModeChip quest={quest} /><p>Signed in as {me.name && !me.name.includes('@') ? me.name : live.email} · {ROLE_LABELS[live.role]}{live.isPlatformAdmin ? ' · platform admin (separate)' : ''}</p><button type="button" className="link exit-demo" onClick={live.onSignOut}>Sign out</button></>
          : <><LookSwitch compact /><ModeChip quest={quest} /><p><b>Task-HQ Demo</b> · synthetic people and data. Changes stay on this device; teammates are not notified.</p>{onExitDemo && <button type="button" className="link exit-demo" onClick={onExitDemo}>Sign in to Task HQ</button>}</>}
      />
      {!sidebar.isMobile && (
        <button type="button" className="seam-toggle is-left" onClick={sidebar.toggle} aria-controls="quest-sidebar" aria-expanded={sidebar.open}
          aria-label={sidebar.open ? 'Collapse sidebar' : 'Expand sidebar'} title={sidebar.open ? 'Collapse sidebar' : 'Expand sidebar'}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={sidebar.open ? 'M14 7l-5 5 5 5' : 'M10 7l5 5-5 5'} /></svg>
        </button>
      )}

      <main className="main">
        {!live && onExitDemo && <aside className="demo-access" aria-label="Task HQ demo">
          <div><strong>Task HQ Demo</strong><span>Sample data · changes stay on this device</span></div>
          <button type="button" className="btn btn-primary" onClick={onExitDemo}>Sign in to Task HQ</button>
        </aside>}
        <TopBar quest={quest} demo={!live} focused={focused} unread={inboxUnread} askOpen={askOpen}
          tabs={LENSES.map(lens => ({ id: lens, label: lens === 'all' ? 'All Tasks' : LENS_LABELS[lens], count: topCounts[lens], hot: (lens === 'overdue' || lens === 'urgent') && topCounts[lens] > 0, active: view === 'all-tasks' && registryView.lens === lens, allowed: allowed('all-tasks') }))}
          onTab={id => { if (LENSES.includes(id as Lens)) openLens(id as Lens); else go(id as View); }} search={<TopSearch quest={quest} data={inboxData} tools={tools} open={canNavigate(access, 'search')} onOpen={openSearchResult} onBlocked={underConstruction} />} onAsk={() => setAskOpen(value => !value)} onBell={() => sidebar.showTab('inbox')}
          onMenu={sidebar.openMobile} menuOpen={sidebar.mobileOpen} />

        {quest.feedback.cue && <FeedbackBar quest={quest} preferences={feedbackOn} />}
        {focused && grant && <GrantBar quest={quest} grant={grant} onReturn={() => { closeTask(); go('home'); }} />}

        <section className={`content view-${selected && contextAllowed ? 'task' : view}`}>
          {!live && view === 'home' && !selected && <details className="demo-attendance" onToggle={event => setAttendanceDemo(event.currentTarget.open)}>
            <summary>Try attendance · sample data</summary>
            <p>Part of this demo. Use the account menu to try another demo person. No real attendance is recorded.</p>
            {attendanceDemo && <ShiftBridge quest={quest} />}
          </details>}
          {!(selected && contextAllowed) && PREVIEW_VIEWS.includes(view) && <PreviewNotice view={view} live={!!live} />}
          {selected && contextAllowed ? <TaskPage key={selected.id} quest={quest} task={selected} canCreate={canCreate} onClose={closeTask} onOpen={openTask} onCreate={() => setCreating(true)} />
            : focused && !grant && view === 'home'
            ? <CriticalFocus quest={quest} onOpen={openTask} />
            : view === 'home' ? <Home quest={quest} company={company} canCreate={canCreate} canDeck={deckAllowed}
                unseen={{ count: inboxUnread, latest: inbox.items.find(item => !sidebar.read.has(item.id))?.title }} onUnseen={() => sidebar.showTab('inbox')}
                mentions={mentions} read={sidebar.read}
                onOpen={openTask} onOpenLead={openLead} onCreate={() => setCreating(true)}
                onOpenMention={item => { if (!open('inbox')) { underConstruction(); return; } sidebar.markRead([item.id]); location.hash = `#/inbox/${encodeURIComponent(item.channelId ?? '')}/${encodeURIComponent(item.messageId ?? '')}`; }}
                onRegistry={openRegistry} onDeck={openDeck} onTeam={() => go('people')} onActivity={() => go('activity')} />
            : view === 'all-tasks' ? <AllTasks quest={quest} selectedId={taskId} onSelect={openTask} onCreate={() => setCreating(true)} canCreate={canCreate} preset={preset} onPresetApplied={clearPreset} registry={registry} />
            : view === 'reports' ? (hasDesk ? <ExecutiveDesk quest={quest} onOpenTask={openTask} onOpenLead={openLead} /> : <Activity quest={quest} onOpen={openTask} />)
            : view === 'inbox' ? <Inbox quest={quest} data={inboxData} notes={notifications} read={sidebar.read} markRead={sidebar.markRead} onOpenTask={openTask} onOpenLead={openLead} />
            : view === 'workbook' ? <OperationsWorkbook key={`${state.workspace.tenantId}:${actor}`} />
            : view === 'tools' ? <Tools quest={quest} store={toolsStore} tools={tools} onOpenTask={openTask} />
            : view === 'executive' ? <ExecutiveDesk quest={quest} onOpenTask={openTask} onOpenLead={openLead} />
            : view === 'relationships' ? <Relationships quest={quest} onOpen={openTask} />
            : view === 'people' ? <People quest={quest} />
            : view === 'calendar' ? <CalendarPage quest={quest} company={company} onOpenTask={openTask} onCreate={canCreate ? createOn : undefined} />
            : view === 'feedback' ? <FeedbackInbox quest={quest} onOpen={id => { setFeedbackId(id); history.replaceState(null, '', `#/feedback/${id}`); }} />
            : view === 'company-work' ? <CompanyWork quest={quest} onOpen={openTask} />
            : view === 'needs-attention' ? <NeedsAttention quest={quest} onOpen={openTask} />
            : view === 'leads' ? <SpeedToLead quest={quest} onOpen={openTask} selectedLead={leadId} onSelectLead={id => { setLeadId(id); history.replaceState(null, '', id ? `#/leads/${id}` : '#/leads'); }} />
            : view === 'activity' ? <Activity quest={quest} onOpen={openTask} />
            : view === 'settings' ? <Settings quest={quest} onPeople={() => go('people')} />
            : <AgentWorkspace />}
        </section>

        <nav className="tabbar" aria-label="Task-HQ sections">
          {[
            { id: 'home' as View, label: 'Home', hot: false, icon: <Icon d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /> },
            { id: 'all-tasks' as View, label: 'Tasks', hot: false, icon: <Icon d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v2H4z" /> },
            ...(['inbox', 'needs-attention', 'leads'] as View[]).map(id => navigation.find(item => item.id === id)).filter(item => !!item),
          ].map(item => {
            const restricted = !open(item.id);
            return (
              <button key={item.id} type="button" className={`${view === item.id ? 'is-active' : ''} ${restricted ? 'is-restricted' : ''}`} disabled={!allowed(item.id)}
                aria-disabled={restricted || undefined} title={restricted ? UNDER_CONSTRUCTION : undefined} onClick={() => (item.id === 'all-tasks' ? openLens(registryView.lens) : go(item.id))}>
                {item.icon}<span>{item.label.replace('Speed to Lead', 'Leads').replace('First Response', 'Leads').replace('Needs Attention', 'Attention').replace('All Tasks', 'Tasks')}</span>
                {restricted ? <span className="sr-only">, under construction</span> : item.hot && allowed(item.id) && <i className="tab-dot" />}
              </button>
            );
          })}
        </nav>
      </main>

      {selected && !contextAllowed && (
        <div className="locked-note" role="alert">“{selected.title}” is outside your Critical Focus. Request access to {SECTION_LABELS['company-work']} first. <button className="btn btn-ghost btn-sm" onClick={closeTask}>Close</button></div>
      )}
      {(showSignals || showDeckDrawer) && <>
        {showDeckDrawer && <button className="scrim" aria-label="Close instrument deck" onClick={closeDeck} />}
        <CalendarSidebar quest={quest} notifications={notifications} company={company} docked={showSignals}
          onOpenNotification={note => { setDeckDrawer(false); openNotification(note); }} onOpenTask={id => { setDeckDrawer(false); openTask(id); }}
          onClose={closeDeck} onExpandCalendar={() => { setDeckDrawer(false); go('calendar'); }}
          onCreate={canCreate ? due => { setDeckDrawer(false); createOn(due); } : undefined} />
      </>}
      {signalSeam && (
        <button type="button" className={`seam-toggle is-right ${showSignals ? '' : 'is-tab'}`} onClick={() => (deckOpen ? closeDeck() : setContextPref('open'))} aria-expanded={deckOpen}
          aria-label={deckOpen ? 'Collapse calendar and activity' : `Show instrument deck${notifications.length ? `, ${notifications.length} need you` : ''}`} title={deckOpen ? 'Collapse calendar and activity' : 'Show instrument deck'}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={deckOpen ? 'M10 7l5 5-5 5' : 'M14 7l-5 5 5 5'} /></svg>
          {!showSignals && <span className="seam-tab-label">Calendar</span>}
          {!showSignals && notifications.length > 0 && <span className="seam-tab-count">{notifications.length > 9 ? '9+' : notifications.length}</span>}
        </button>
      )}
      {askOpen && !focused && <AskTasks quest={quest} company={company} onClose={() => setAskOpen(false)} />}
      {creating && canCreate && <CreateTask quest={quest} due={createDue} onClose={() => { setCreating(false); setCreateDue(undefined); }} onCreated={id => { setCreating(false); setCreateDue(undefined); openTask(id); }} />}
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
