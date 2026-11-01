import { companyReport } from '../core/reports.ts';
import { useMomentum } from '../ui/useMomentum.ts';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { QuestEvent, QuestState } from '../core/contract.ts';
import { compose } from '../core/compose.ts';
import { ago, atRisk, homeMetrics, performance, recentActivity } from '../core/dashboard.ts';
import { DEFAULT_ITEMS } from '../core/dashboard-layout.ts';
import type { DashboardLayout } from '../core/dashboard-layout.ts';
import { Dashboard } from './dashboard/Dashboard.tsx';
import type { DashboardModule } from './dashboard/Dashboard.tsx';
import { HOME_PERIODS, HOME_PERIOD_LABELS, inHomePeriod, loadHomePeriod, riskInPeriod, saveHomePeriod } from '../core/home-period.ts';
import type { HomePeriod } from '../core/home-period.ts';
import { DEFAULT_QUERY, queryTasks } from '../core/registry.ts';
import type { CollabItem } from '../core/dashboard.ts';
import { CULTURE_CONTENT, CULTURE_SLOTS } from '../core/culture.ts';
import type { CultureItem, CultureSlot } from '../core/culture.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { firstName, projectName, taskById } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import { PRODUCT } from '../core/workspace.ts';
import { CtaArrow, MoveForward } from '../ui/components.tsx';
import { ProjectTeam } from './ProjectTeam.tsx';
import { BannerAdjust, BannerEditor, bannerLook, useBanner } from './HeroBanner.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { DeckSection } from './ContextPanel.tsx';

// Home: the day at a glance. Momentum greeting; Up next · At risk; Projects & team · Culture.
// The calendar lives in the left panel; comments, mentions and activity in the bottom dock (CollabDock).
// Everything is read from records; team-wide panels need the same access as Company Work.
export function Home({ quest, company, canCreate, canDeck, onOpen, onOpenLead, onCreate, onRegistry, onDeck, onTeam, culture = CULTURE_CONTENT, focusTaskId, onClearFocus, onReports }: {
  quest: Quest; company: boolean; canCreate: boolean;
  /** Whether the Instrument Deck (calendar, insights) is available to this viewer here. */
  canDeck: boolean;
  onOpen: (id: string) => void; onOpenLead: (id: string) => void; onCreate: () => void;
  onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void;
  onDeck: (section: DeckSection) => void; onTeam: () => void;
  /** The task the dock is reading, focused in the overview's Living view. */
  focusTaskId?: string | null; onClearFocus?: () => void;
  onReports?: () => void;
  culture?: CultureItem[];
}) {
  const { state, actor, now } = quest;
  const banner = useBanner(state.workspace.tenantId, actor);
  const minute = Math.floor(now / 60000) * 60000;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Today | This week: one scope for the performance strip, Up next and At risk (Today unless chosen otherwise).
  const [period, setPeriod] = useState<HomePeriod>(() => { try { return loadHomePeriod(localStorage); } catch { return 'today'; } });
  const choosePeriod = (next: HomePeriod) => { setPeriod(next); try { saveHomePeriod(localStorage, next); } catch { /* this page only */ } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fullQueue = useMemo(() => { const { primary, queue: rest } = compose(state, actor, minute); return [primary, ...rest].filter(item => item.taskId || item.leadId); }, [state, actor, minute]);
  const queue = fullQueue.filter(item => { const task = item.taskId ? taskById(state, item.taskId) : undefined; return !task || inHomePeriod(task, period, minute); });
  const metrics = homeMetrics(state, actor, minute);
  const allRisksInView = atRisk(state, actor, minute, company);
  const risks = allRisksInView.filter(item => riskInPeriod(item, period, minute));
  // Your performance: Completed from the period's completion log; the others count exactly what their link opens.
  const done = performance(state, actor, minute, period).completed;
  const count = (lens: 'all' | 'today', changes: Partial<typeof DEFAULT_QUERY>) => queryTasks(state, actor, minute, { ...DEFAULT_QUERY, lens, ...changes }).length;
  const openCount = count('all', { scope: 'mine' });
  const dueCount = count('all', { scope: 'mine', due: period === 'today' ? 'today' : 'week' });
  const blockedCount = count('all', { scope: 'mine', status: 'blocked' });
  const greeting = useMomentum(quest, company);
  const today = localDate(minute);
  const next = queue[0];
  const [allRisks, setAllRisks] = useState(false);
  const nextTask = next?.taskId ? taskById(state, next.taskId) : undefined;
  // These labels describe opening the situation, never performing its mutation.
  const nextLabel = next?.leadId ? 'Review next lead'
    : next?.kind === 'approval' ? 'Review approval'
    : next?.kind === 'help-request' ? 'Review help request'
    : nextTask?.status === 'blocked' ? 'Review blocker'
    : 'Open next task';

  const shown = (layout: DashboardLayout, id: string) => layout.items.some(item => item.id === id);
  // Home's sections as dashboard modules: the same components and data as before, now arrangeable.
  const modules: DashboardModule[] = [
    { id: 'welcome', name: 'Welcome', description: 'Greeting and your next step', sizes: ['l', 'xl'], defaultSize: 'xl', render: () => <>
      <Hero eyebrow={greeting.eyebrow} primary={greeting.primary} support={greeting.support} banner={banner}>
        {next && <button type="button" className="btn btn-primary btn-sm cta-fill" title={nextTask?.title || next.headline} onClick={() => next.taskId ? onOpen(next.taskId) : next.leadId && onOpenLead(next.leadId)}><span className="cta-fill-label">{nextLabel}</span><CtaArrow /></button>}
      </Hero>
    </> },
    { id: 'performance', name: 'Performance', description: 'Completed, open, due and blocked', sizes: ['m', 'l', 'xl'], defaultSize: 'xl', render: () => <>
      <section className="hd-perf" aria-labelledby="hd-perf-title">
        <div className="hd-perf-head">
          <h2 id="hd-perf-title">Your performance</h2>
          <div className="seg hd-period" role="group" aria-label="Dashboard period">
            {HOME_PERIODS.map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => choosePeriod(value)}>{HOME_PERIOD_LABELS[value]}</button>)}
          </div>
        </div>
        <div className="hd-perf-grid">
          <PerfMetric value={done} label={period === 'today' ? 'Completed today' : 'Completed this week'} tone="ok" onClick={() => onRegistry('all', { scope: 'mine', status: 'done', sort: 'updated' })} hint="Open your completed work" />
          <PerfMetric value={openCount} label="Open workload" tone="neutral" onClick={() => onRegistry('all', { scope: 'mine' })} hint="Open all your open work" />
          <PerfMetric value={dueCount} label={period === 'today' ? 'Due today' : 'Due this week'} sub={period === 'week' ? 'next 7 days' : undefined} tone="accent" onClick={() => onRegistry('all', { scope: 'mine', due: period === 'today' ? 'today' : 'week' })} hint="Open the work due in this period" />
          <PerfMetric value={blockedCount} label="Blocked" tone="stop" onClick={() => onRegistry('all', { scope: 'mine', status: 'blocked' })} hint="Open your blocked work" />
        </div>
      </section>
    </> },
    { id: 'up-next', name: 'Up next', description: 'Your queue by priority and due date', sizes: ['s', 'm', 'l', 'xl'], defaultSize: 'm', render: () => <>
        <section className="hd-panel" aria-labelledby="hd-next">
          <PanelHead id="hd-next" title="Up next" sub={`Your queue · ${period === 'today' ? 'today' : 'this week'} · by priority & due date`} tone="accent" icon={<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5" />}
            more={queue.length > 0 ? { label: `View all (${metrics.active})`, onClick: () => onRegistry('all', { scope: 'mine' }) } : undefined} />
          {queue.length === 0
            ? <div className="hd-empty">
                <span className="hd-empty-mark"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3" /></svg></span>
                <h3>{fullQueue.length ? `Nothing more ${period === 'today' ? 'today' : 'this week'}.` : 'Queue is clear.'}</h3>
                <p>{fullQueue.length ? <>Later work is waiting. <button type="button" className="link" onClick={() => choosePeriod('week')}>Show this week</button></> : 'Nothing is waiting on you right now.'}</p>
              </div>
            : <ul className="hd-list hd-queue">
                {queue.slice(0, 5).map(item => {
                  const task = item.taskId ? taskById(state, item.taskId) : undefined;
                  const due = task?.due ? shortDate(task.due, today) : '';
                  const late = !!task?.due && task.due < today;
                  return (
                    <li key={item.key} className={`hd-q ${task?.ultra ? 'is-ultra' : ''}`}>
                      {task && task.status !== 'done' ? <MoveForward quest={quest} task={task} compact /> : <span className="hd-q-dot" aria-hidden="true" />}
                      <button type="button" className="hd-row-main" onClick={() => (task ? onOpen(task.id) : item.leadId && onOpenLead(item.leadId))}>
                        <strong>{item.headline}</strong>
                        <small><em>{item.kicker}</em>{task ? ` · ${projectName(state, task.projectId) || item.detail}` : item.detail ? ` · ${item.detail}` : ''}</small>
                      </button>
                      {due && <span className={`hd-due ${late ? 'is-late' : due === 'Today' ? 'is-today' : ''}`}>{late ? `${due} · late` : due}{task?.dueTime && !late ? ` ${task.dueTime}` : ''}</span>}
                    </li>
                  );
                })}
              </ul>}
        </section>
    </> },
    { id: 'at-risk', name: 'At risk', description: 'Work that needs attention', sizes: ['s', 'm', 'l', 'xl'], defaultSize: 'm', render: () => <>
        <section className="hd-panel" aria-labelledby="hd-risk">
          <PanelHead id="hd-risk" title="At risk" sub={`Needs attention · ${period === 'today' ? 'today' : 'this week'}`} tone="stop" icon={<path d="M12 4 21 20H3zM12 10v4M12 17v.5" />}
            more={risks.length > 4 ? { label: allRisks ? 'Show fewer' : `View all (${risks.length})`, onClick: () => setAllRisks(value => !value) } : undefined} />
          {risks.length === 0
            ? <p className="hd-quiet">Nothing is at risk{company ? '' : ' on your work'}{allRisksInView.length ? ` ${period === 'today' ? 'today' : 'this week'}` : ''}.</p>
            : <ul className="hd-list">
                {(allRisks ? risks : risks.slice(0, 4)).map(({ task, reasons }) => (
                  <li key={task.id} className="hd-row is-risk">
                    <button type="button" className="hd-row-main" onClick={() => onOpen(task.id)}>
                      <strong>{task.title}</strong><small>{firstName(state, task.owner)} · {reasons.join(' · ')}</small>
                    </button>
                    <span className={`hd-badge ${task.ultra ? 'is-ultra' : ''}`}>{task.ultra ? 'ultra' : 'at risk'}</span>
                  </li>
                ))}
              </ul>}
        </section>
    </> },
    { id: 'projects', name: 'Projects and Team Overview', description: 'Progress by project and person', sizes: ['m', 'l', 'xl'], defaultSize: 'l',
      render: () => <ProjectTeam quest={quest} company={company} onOpen={onOpen} focusTaskId={focusTaskId} onClearFocus={onClearFocus}
        omit={{ people: true, needsHand: true, nextActions: true }} /> },
    { id: 'needs-hand', name: 'Needs a hand', description: 'Overdue and blocked work', sizes: ['s', 'm', 'l'], defaultSize: 's', render: () => <ProjectTeam quest={quest} company={company} onOpen={onOpen} only="needs-hand" /> },
    { id: 'next-actions', name: 'Next actions', description: 'Open work ready to move', sizes: ['s', 'm', 'l'], defaultSize: 's', render: () => <ProjectTeam quest={quest} company={company} onOpen={onOpen} only="next-actions" /> },
    { id: 'reports', name: 'Reports', description: 'Completion and delivery measures', sizes: ['s', 'm', 'l'], defaultSize: 'm',
      render: () => <ReportsModule quest={quest} company={company} onReports={onReports} /> },
    { id: 'culture', name: 'Quest Culture', description: 'Culture spotlight', sizes: ['s', 'm', 'l', 'xl'], defaultSize: 's',
      // Video and Team Moments are tabs here unless they're shown as their own modules.
      render: ({ layout }) => <CultureSpotlight items={culture} slots={CULTURE_SLOTS.map(slot => slot.id).filter(id => id === 'culture' || !shown(layout, id))} /> },
    { id: 'video', name: 'Video', description: 'Video of the week', sizes: ['s', 'm', 'l'], defaultSize: 's', render: () => <CultureSpotlight items={culture} slots={['video']} /> },
    { id: 'moments', name: 'Team Moments', description: 'Achievements and milestones', sizes: ['s', 'm', 'l'], defaultSize: 's', render: () => <CultureSpotlight items={culture} slots={['moments']} /> },
    { id: 'activity', name: 'Activity', description: 'Recent changes across your work', sizes: ['s', 'm', 'l'], defaultSize: 's', render: () => <ActivityModule quest={quest} company={company} onOpen={onOpen} /> },
  ];

  return (
    <div className="view home-dash">
      <Dashboard pageId="home" scope={state.workspace.tenantId} actor={actor} modules={modules} defaultItems={DEFAULT_ITEMS} />
    </div>
  );
}

/** Same scoped report model as the full Reports page. */
function ReportsModule({ quest, company, onReports }: { quest: Quest; company: boolean; onReports?: () => void }) {
  const report = companyReport(quest.state, quest.actor, quest.now, 'month', company);
  return <section className="hd-panel" aria-labelledby="hd-reports">
    <PanelHead id="hd-reports" title="Reports" sub={`${company ? 'Visible company work' : 'Your work'} · last 30 days for completions`} tone="neutral" icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />}
      more={onReports ? { label: 'Open reports', onClick: onReports } : undefined} />
    <dl className="hd-report-summary">
      <div><dt>Completed</dt><dd>{report.completed}</dd></div>
      <div><dt>Overdue now</dt><dd>{report.overdue}</dd></div>
      <div><dt>On-time rate</dt><dd>{report.onTimeRate == null ? 'No dated completions' : `${report.onTimeRate}%`}</dd></div>
    </dl>
  </section>;
}

/** Recent activity on the work you can see (the same feed the dock and Activity page read). */
function ActivityModule({ quest, company, onOpen }: { quest: Quest; company: boolean; onOpen: (id: string) => void }) {
  const events = recentActivity(quest.state, quest.actor, company, 6);
  return (
    <section className="hd-panel" aria-labelledby="hd-activity">
      <PanelHead id="hd-activity" title="Activity" sub="Recent changes" tone="neutral" icon={<path d="M4 12h4l3-7 3 14 3-7h3" />} />
      {events.length === 0 ? <p className="hd-quiet">No recent activity.</p> : <ul className="hd-list hd-feed">{events.map(event => <li key={event.id}><Recent event={event} quest={quest} onOpen={onOpen} /></li>)}</ul>}
    </section>
  );
}

export const COLLAB_VERB: Record<CollabItem['kind'], string> = { comment: 'commented on', mention: 'mentioned you in', reply: 'replied on' };

/** Momentum greeting with the architectural treatment, kept to a compact height. */
function Hero({ eyebrow, primary, support, banner, children }: { eyebrow: string; primary: string; support: string; banner: ReturnType<typeof useBanner>; children: ReactNode }) {
  const look = bannerLook(banner.banner);
  const [date, time] = eyebrow.split(' · ');
  const words = primary.split(' ');
  const split = words.length >= 4 ? words.length - 2 : words.length;
  return (
    <header className={`hd-hero ${look.className}`} style={look.style}>
      <div className="hd-hero-copy">
        <p className="hd-hero-eyebrow"><span>{date}</span>{time && <span className="hd-greet"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={time === 'Evening' ? 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' : 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'} /></svg>Good {time.toLowerCase()}</span>}</p>
        <h1>{words.slice(0, split).join(' ')}{split < words.length && <> <b>{words.slice(split).join(' ')}</b></>}</h1>
        <p className="momentum-support">{support.split(/(\d+\s+[\p{L}’'-]+)/u).map((part, index) => index % 2 ? <b key={index}>{part}</b> : part)}</p>
        <div className="hd-hero-actions">{children}</div>
      </div>
      <div className="hd-hero-art" aria-hidden="true">
        <svg viewBox="0 0 420 180" preserveAspectRatio="xMaxYMid slice">
          <defs>
            <linearGradient id="hd-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--hero-a)" /><stop offset="1" stopColor="var(--hero-b)" /></linearGradient>
            <linearGradient id="hd-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".55" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
          </defs>
          <rect width="420" height="180" fill="url(#hd-sky)" />
          <g transform="translate(0 34)">
          <path d="M60 98 300 58 420 70v14L300 74 60 112z" fill="var(--hero-roof)" />
          <path d="M60 112 300 74l120 10v6L300 82 60 118z" fill="url(#hd-glow)" />
          <path d="M96 118v62M150 110v70M204 101v79M258 92v88M312 84v96" stroke="var(--hero-line)" strokeWidth="1" />
          <path d="M100 124h300v56H100z" fill="var(--hero-wall)" />
          <path d="M120 132h40v48h-40zM176 132h40v48h-40zM232 132h40v48h-40zM288 132h40v48h-40z" fill="var(--hero-glass)" />
          <path d="M100 124h300" stroke="var(--accent)" strokeWidth="2" />
          </g>
        </svg>
        <p className="hd-hero-tag">{PRODUCT.tagline}</p>
      </div>
      {banner.adjusting ? <BannerAdjust {...banner} /> : <BannerEditor {...banner} />}
    </header>
  );
}

function PanelHead({ id, title, sub, tone, icon, more }: { id: string; title: string; sub: string; tone: 'accent' | 'stop' | 'act' | 'neutral'; icon: ReactNode; more?: { label: string; onClick: () => void } }) {
  return (
    <div className="hd-head">
      <Tile tone={tone}>{icon}</Tile>
      <div><h2 id={id}>{title}</h2><small>{sub}</small></div>
      {more && <button type="button" className="hd-more" onClick={more.onClick}>{more.label}<Chevron /></button>}
    </div>
  );
}

/** Culture, Video of the Week and Team Moments. Renders configured content only; otherwise an honest placeholder. */
function CultureSpotlight({ items, slots: allowed }: { items: CultureItem[]; slots?: CultureSlot[] }) {
  const SLOTS = allowed ? CULTURE_SLOTS.filter(entry => allowed.includes(entry.id)) : CULTURE_SLOTS;
  const [slot, setSlot] = useState<CultureSlot>(SLOTS[0]!.id);
  const [index, setIndex] = useState(0);
  const inSlot = items.filter(item => item.slot === slot);
  const item = inSlot[Math.min(index, inSlot.length - 1)];
  const meta = SLOTS.find(entry => entry.id === slot) ?? SLOTS[0]!;
  const choose = (next: CultureSlot) => { setSlot(next); setIndex(0); };
  // Arrows page through this tab's items, then move on to the next tab.
  const step = (dir: 1 | -1) => {
    const next = index + dir;
    if (next >= 0 && next < inSlot.length) { setIndex(next); return; }
    const at = SLOTS.findIndex(entry => entry.id === slot);
    const target = SLOTS[(at + dir + SLOTS.length) % SLOTS.length]!.id;
    setSlot(target);
    setIndex(dir === 1 ? 0 : Math.max(0, items.filter(entry => entry.slot === target).length - 1));
  };
  return (
    <section className="hd-panel hd-culture" aria-label="Quest Culture spotlight">
      <div className="hd-culture-head">
        <div className="hd-culture-tabs" role="tablist" aria-label="Spotlight">
          {SLOTS.map(entry => <button key={entry.id} type="button" role="tab" id={`cult-${entry.id}`} aria-selected={slot === entry.id} aria-controls="cult-panel" onClick={() => choose(entry.id)}>{entry.label}</button>)}
        </div>
        <span className="hd-culture-arrows">
          <button type="button" className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><Chevron left /></button>
          <button type="button" className="icon-btn" aria-label="Next" onClick={() => step(1)}><Chevron /></button>
        </span>
      </div>
      <div id="cult-panel" role="tabpanel" aria-labelledby={`cult-${slot}`} className={`hd-culture-frame ${item ? '' : 'is-empty'}`}>
        {item?.media?.type === 'video'
          ? <video controls preload="metadata" playsInline poster={item.media.poster} aria-label={item.media.alt}>
              <source src={item.media.src} />
              {item.media.captions && <track kind="captions" src={item.media.captions} srcLang="en" label="English" default />}
            </video>
          : item?.media?.type === 'image' ? <img src={item.media.src} alt={item.media.alt} /> : null}
        <div className="hd-culture-copy">
          {item
            ? <><small>{item.eyebrow}</small><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}{item.byline && <em>{item.byline}</em>}</>
            : <>
                <span className="hd-culture-mark" aria-hidden="true">
                  <svg className="icon" viewBox="0 0 24 24">{slot === 'video' ? <path d="M8 5v14l11-7z" /> : slot === 'moments' ? <path d="M4 7h4l2-3h4l2 3h4v13H4zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /> : <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" />}</svg>
                </span>
                <small>{meta.label}</small><strong>{meta.empty}</strong><p>{meta.hint}</p>
              </>}
        </div>
      </div>
      <div className="hd-dots" aria-hidden="true">{(inSlot.length ? inSlot : [null]).map((_, at) => <i key={at} className={at === Math.min(index, Math.max(0, inSlot.length - 1)) ? 'is-on' : ''} />)}</div>
    </section>
  );
}

/** One compact performance figure; it opens the matching task list. */
function PerfMetric({ value, label, sub, tone, onClick, hint }: { value: number; label: string; sub?: string; tone: 'ok' | 'neutral' | 'accent' | 'stop'; onClick: () => void; hint: string }) {
  return (
    <button type="button" className={`hd-perf-metric tone-${tone} ${value ? 'has-value' : ''}`} onClick={onClick} title={hint} aria-label={`${label}: ${value}. ${hint}.`}>
      <b>{value}</b><span>{label}{sub && <small>{sub}</small>}</span>
    </button>
  );
}

export function Chevron({ left = false }: { left?: boolean }) {
  return <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d={left ? 'M14 7l-5 5 5 5' : 'M10 7l5 5-5 5'} /></svg>;
}

function Tile({ tone, children }: { tone: 'accent' | 'stop' | 'act' | 'neutral'; children: ReactNode }) {
  return <span className={`hd-tile tone-${tone}`}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{children}</svg></span>;
}

const TINTS = ['t-accent', 't-ok', 't-act'];
export function Initial({ state, id }: { state: QuestState; id: string }) {
  const tint = TINTS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length];
  const name = state.people.find(item => item.id === id)?.name ?? firstName(state, id, '?');
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('');
  return <span className={`avatar avatar-md ${tint}`} aria-hidden="true">{initials || '?'}</span>;
}

/** Event text with quoted task titles set apart, like "Maya started · Order shingles". */
export function Recent({ event, quest, onOpen }: { event: QuestEvent; quest: Quest; onOpen: (id: string) => void }) {
  const parts = event.text.split(/(“[^”]*”)/);
  const task = event.taskId ? taskById(quest.state, event.taskId) : undefined;
  const where = task ? projectName(quest.state, task.projectId) : '';
  const body = <>
    {event.actor === 'system' ? <span className="avatar avatar-md" aria-hidden="true">·</span> : <Initial state={quest.state} id={event.actor} />}
    <span className="t">{parts.map((part, index) => part.startsWith('“') ? <span key={index} className="q">{part.slice(1, -1)}</span> : part)}{where && <small>{where}</small>}</span>
    <time dateTime={new Date(event.at).toISOString()}>{ago(event.at, quest.now)}</time>
  </>;
  return task ? <button type="button" className="hd-act" onClick={() => onOpen(task.id)}>{body}</button> : <div className="hd-act">{body}</div>;
}
