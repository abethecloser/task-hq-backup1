import { useMomentum } from '../ui/useMomentum.ts';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { QuestEvent, QuestState } from '../core/contract.ts';
import { compose } from '../core/compose.ts';
import { ago, atRisk, collaboration, homeMetrics, statusMix, teamActivity, teamWorkload, todayProgress } from '../core/dashboard.ts';
import type { CollabItem, MentionSource } from '../core/dashboard.ts';
import { CULTURE_CONTENT, CULTURE_SLOTS } from '../core/culture.ts';
import type { CultureItem, CultureSlot } from '../core/culture.ts';
import type { Lens, RegistryQuery } from '../core/registry.ts';
import { firstName, projectName, taskById } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import { PRODUCT } from '../core/workspace.ts';
import { MoveForward } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import type { DeckSection } from './ContextPanel.tsx';

// Home: the day at a glance. Momentum greeting; Comments & mentions beside the four plate
// metrics; Up next · At risk · Team workload; Projects overview · Team activity · Culture.
// Calendar, signals and insights live in the Instrument Deck on the right.
// Everything is read from records; team-wide panels need the same access as Company Work.
export function Home({ quest, company, canCreate, canDeck, unseen, mentions, read, onUnseen, onOpen, onOpenLead, onOpenMention, onCreate, onRegistry, onDeck, onTeam, onActivity, culture = CULTURE_CONTENT }: {
  quest: Quest; company: boolean; canCreate: boolean;
  /** Whether the Instrument Deck (calendar, insights) is available to this viewer here. */
  canDeck: boolean;
  /** Updates in the person's inbox they haven't opened yet (the same read set as the bell). */
  unseen: { count: number; latest?: string };
  /** Channel @mentions from the universal inbox, and its read set. */
  mentions: MentionSource[]; read: Set<string>;
  onUnseen: () => void;
  onOpen: (id: string) => void; onOpenLead: (id: string) => void; onOpenMention: (item: CollabItem) => void; onCreate: () => void;
  onRegistry: (lens: Lens, changes?: Partial<RegistryQuery>) => void;
  onDeck: (section: DeckSection) => void; onTeam: () => void; onActivity: () => void;
  culture?: CultureItem[];
}) {
  const { state, actor, now } = quest;
  const minute = Math.floor(now / 60000) * 60000;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queue = useMemo(() => { const { primary, queue: rest } = compose(state, actor, minute); return [primary, ...rest].filter(item => item.taskId || item.leadId); }, [state, actor, minute]);
  const metrics = homeMetrics(state, actor, minute);
  const progress = todayProgress(state, actor, minute);
  const risks = atRisk(state, actor, minute, company);
  const mix = statusMix(state, actor);
  const collab = collaboration(state, actor, company, mentions, read, 4);
  const workload = company ? teamWorkload(state, minute) : [];
  const activity = teamActivity(state, actor, company, 5);
  const greeting = useMomentum(quest, company);
  const today = localDate(minute);
  const scope = company ? 'company' : 'mine';

  return (
    <div className="view home-dash">
      <Hero eyebrow={greeting.eyebrow} primary={greeting.primary} support={greeting.support}>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canCreate} onClick={onCreate}>+ New task</button>
        {canDeck && <button type="button" className="btn btn-sm" onClick={() => onDeck('calendar')}>Calendar</button>}
      </Hero>

      <div className="hd-top">
        <section className="hd-panel hd-collab" aria-labelledby="hd-comments">
          <div className="hd-head">
            <Tile tone="accent"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></Tile>
            <div><h2 id="hd-comments">Comments &amp; mentions</h2><small>On your work</small></div>
            <button type="button" className={`hd-unread ${unseen.count ? 'has-unseen' : ''}`} onClick={onUnseen}
              aria-label={unseen.count ? `Inbox: ${unseen.count} unread across all updates — open inbox` : 'Inbox: all caught up — open inbox'} title={unseen.latest ? `Latest in your inbox: ${unseen.latest}` : 'Open inbox'}>
              {unseen.count ? <>Inbox · <b>{unseen.count > 99 ? '99+' : unseen.count}</b> unread</> : 'Inbox · caught up'}
              <Chevron />
            </button>
          </div>
          {collab.length === 0
            ? <p className="hd-quiet">No comments or mentions on your work yet. Comments on tasks you’re part of and @mentions of you land here.</p>
            : <ul className="hd-list hd-feed">
                {collab.map(item => (
                  <li key={item.id}>
                    <button type="button" className={`hd-act ${item.unread ? 'is-unread' : ''}`} onClick={() => (item.channelId ? onOpenMention(item) : item.taskId && onOpen(item.taskId))}>
                      <Initial state={state} id={item.from} />
                      <span className="t"><b>{firstName(state, item.from, 'Someone')}</b> {COLLAB_VERB[item.kind]} <span className="q">{item.context.replace(/^Mentioned you in /, '')}</span><small>{item.text}</small></span>
                      <time dateTime={new Date(item.at).toISOString()}>{ago(item.at, now)}</time>
                    </button>
                  </li>
                ))}
              </ul>}
        </section>

        <div className="hd-metrics" role="group" aria-label="Your plate">
          <Metric value={metrics.active} label="Active items" tone="accent" icon={<path d="M5 20v-6M10 20V9M15 20v-9M20 20V5" />} onClick={() => onRegistry('all', { scope: 'mine' })} />
          <Metric value={metrics.completedToday} label="Completed today" tone="ok" sub={progress.total ? `${progress.done} of ${progress.total} on today’s plate` : undefined}
            icon={<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />} onClick={() => onRegistry('all', { scope: 'mine', status: 'done' })} />
          <Metric value={metrics.overdue} label="Overdue" tone="stop" icon={<path d="M12 4 21 20H3zM12 10v4M12 17v.5" />} onClick={() => onRegistry('overdue', { scope: 'mine' })} />
          <Metric value={metrics.blocked} label="Blocked" tone="warn" sub="marked blocked" icon={<path d="M5 12h14" />} onClick={() => onRegistry('all', { scope: 'mine', status: 'blocked' })} />
        </div>
      </div>

      <div className="hd-row3">
        <section className="hd-panel" aria-labelledby="hd-next">
          <PanelHead id="hd-next" title="Up next" sub="Your queue · by priority & due date" tone="accent" icon={<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5" />}
            more={queue.length > 0 ? { label: `View all (${metrics.active})`, onClick: () => onRegistry('all', { scope: 'mine' }) } : undefined} />
          {queue.length === 0
            ? <div className="hd-empty">
                <span className="hd-empty-mark"><svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 11h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3" /></svg></span>
                <h3>Queue is clear.</h3><p>Nothing is waiting on you right now.</p>
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

        <section className="hd-panel" aria-labelledby="hd-risk">
          <PanelHead id="hd-risk" title="At risk" sub="Needs attention" tone="stop" icon={<path d="M12 4 21 20H3zM12 10v4M12 17v.5" />}
            more={risks.length > 0 ? { label: `View all (${risks.length})`, onClick: () => onRegistry('overdue', { scope }) } : undefined} />
          {risks.length === 0
            ? <p className="hd-quiet">Nothing is at risk{company ? '' : ' on your work'}.</p>
            : <ul className="hd-list">
                {risks.slice(0, 4).map(({ task, reasons }) => (
                  <li key={task.id} className="hd-row is-risk">
                    <button type="button" className="hd-row-main" onClick={() => onOpen(task.id)}>
                      <strong>{task.title}</strong><small>{firstName(state, task.owner)} · {reasons.join(' · ')}</small>
                    </button>
                    <span className="tag tag-overdue">{task.ultra ? 'ultra' : 'at risk'}</span>
                  </li>
                ))}
              </ul>}
        </section>

        <section className="hd-panel" aria-labelledby="hd-team">
          <PanelHead id="hd-team" title="Team workload" sub="Assigned work distribution" tone="act"
            icon={<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6" />}
            more={company ? { label: 'View team', onClick: onTeam } : undefined} />
          {!company
            ? <p className="hd-quiet">Team workload is hidden while your access is limited to your own work.</p>
            : workload.length === 0
              ? <p className="hd-quiet">Nobody has open work right now.</p>
              : <>
                  <ul className="hd-list">
                    {workload.slice(0, 5).map(item => {
                      const max = workload[0]!.open;
                      return (
                        <li key={item.person}>
                          <button type="button" className="hd-person" onClick={() => onRegistry('all', { scope: 'company', owner: item.person })}
                            aria-label={`${item.name}: ${item.open} open — ${item.byStatus.working} in progress, ${item.byStatus.review} in review, ${item.byStatus.ready} not started, ${item.byStatus.blocked} blocked${item.attention ? `; ${item.attention} need attention` : ''}`}>
                            <Initial state={state} id={item.person} /><b className="n">{item.name}</b>
                            <b className="cnt">{item.open}</b>
                            <span className="hd-dist" aria-hidden="true"><span style={{ width: `${Math.max(8, Math.round((item.open / max) * 100))}%` }}>
                              {(['working', 'review', 'ready', 'blocked'] as const).map(key => item.byStatus[key] > 0 && <i key={key} className={`s-${key}`} style={{ flexGrow: item.byStatus[key] }} />)}
                            </span></span>
                            {item.attention > 0 ? <span className="late" title="Overdue, blocked or waiting">{item.attention}!</span> : <span className="late" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="hd-legend" aria-hidden="true"><span><i className="s-working" />In progress</span><span><i className="s-review" />Review</span><span><i className="s-ready" />Not started</span><span><i className="s-blocked" />Blocked</span></p>
                  <p className="hd-fine">Open tasks per person. Task counts aren’t hours or capacity.</p>
                </>}
        </section>
      </div>

      <div className="hd-row3 is-bottom">
        <section className="hd-panel" aria-labelledby="hd-proj">
          <PanelHead id="hd-proj" title="Projects overview" sub="Your work" tone="act" icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />
          <div className="hd-proj">
            <div className="hd-donut" style={{ ['--done' as string]: `${pct(mix.done, mix.total)}%`, ['--working' as string]: `${pct(mix.done + mix.working, mix.total)}%` }} data-empty={mix.total === 0 || undefined}
              role="img" aria-label={`${mix.percent}% complete: ${mix.done} completed, ${mix.working} in progress, ${mix.notStarted} not started`}>
              <div><b>{mix.percent}<i>%</i></b><small>COMPLETE</small></div>
            </div>
            <div className="hd-proj-legend">
              {([['In progress', mix.working, 'var(--act)', ['working', 'blocked', 'review']], ['Completed', mix.done, 'var(--accent)', 'done'], ['Not started', mix.notStarted, '#c4c4c8', 'ready']] as const).map(([label, value, color, status]) => (
                <button key={label} type="button" className="hd-prog" onClick={() => onRegistry('all', { scope: 'mine', status: Array.isArray(status) ? [...status] : status as RegistryQuery['status'] })}>
                  <div><span><i style={{ background: color }} />{label}</span><b>{value}</b></div>
                  <div className="track"><span style={{ width: `${pct(value, mix.total)}%`, background: color }} /></div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="hd-panel" aria-labelledby="hd-activity">
          <PanelHead id="hd-activity" title="Team activity" sub={company ? 'Recent · all work you can see' : 'Recent · your work'} tone="neutral" icon={<path d="M3 12h4l3-8 4 16 3-8h4" />}
            more={{ label: 'View all', onClick: onActivity }} />
          {activity.length === 0
            ? <p className="hd-quiet">No activity yet. Task changes, handoffs and comments appear here as they happen.</p>
            : <ul className="hd-list hd-feed">
                {activity.map(event => <li key={event.id}><Recent event={event} quest={quest} onOpen={onOpen} /></li>)}
              </ul>}
        </section>

        <CultureSpotlight items={culture} />
      </div>
    </div>
  );
}

const COLLAB_VERB: Record<CollabItem['kind'], string> = { comment: 'commented on', mention: 'mentioned you in', reply: 'replied on' };

/** Momentum greeting with the architectural treatment, kept to a compact height. */
function Hero({ eyebrow, primary, support, children }: { eyebrow: string; primary: string; support: string; children: ReactNode }) {
  const [date, time] = eyebrow.split(' · ');
  const words = primary.split(' ');
  const split = words.length >= 4 ? words.length - 2 : words.length;
  return (
    <header className="hd-hero">
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

function Metric({ value, label, sub, tone, icon, onClick }: { value: number; label: string; sub?: string; tone: 'accent' | 'ok' | 'stop' | 'warn'; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={`hd-metric tone-${tone} ${value ? 'has-value' : ''}`} onClick={onClick}>
      <span className="hd-metric-top"><b>{value}</b><svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{icon}</svg></span>
      <span className="lbl">{label}</span>
      {sub && <span className="sub">{sub}</span>}
      <span className="bar" aria-hidden="true" />
    </button>
  );
}

/** Culture, Video of the Week and Team Moments. Renders configured content only; otherwise an honest placeholder. */
function CultureSpotlight({ items }: { items: CultureItem[] }) {
  const [slot, setSlot] = useState<CultureSlot>('culture');
  const [index, setIndex] = useState(0);
  const inSlot = items.filter(item => item.slot === slot);
  const item = inSlot[Math.min(index, inSlot.length - 1)];
  const meta = CULTURE_SLOTS.find(entry => entry.id === slot)!;
  const choose = (next: CultureSlot) => { setSlot(next); setIndex(0); };
  // Arrows page through this tab's items, then move on to the next tab.
  const step = (dir: 1 | -1) => {
    const next = index + dir;
    if (next >= 0 && next < inSlot.length) { setIndex(next); return; }
    const at = CULTURE_SLOTS.findIndex(entry => entry.id === slot);
    const target = CULTURE_SLOTS[(at + dir + CULTURE_SLOTS.length) % CULTURE_SLOTS.length]!.id;
    setSlot(target);
    setIndex(dir === 1 ? 0 : Math.max(0, items.filter(entry => entry.slot === target).length - 1));
  };
  return (
    <section className="hd-panel hd-culture" aria-label="Quest Culture spotlight">
      <div className="hd-culture-head">
        <div className="hd-culture-tabs" role="tablist" aria-label="Spotlight">
          {CULTURE_SLOTS.map(entry => <button key={entry.id} type="button" role="tab" id={`cult-${entry.id}`} aria-selected={slot === entry.id} aria-controls="cult-panel" onClick={() => choose(entry.id)}>{entry.label}</button>)}
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

function Chevron({ left = false }: { left?: boolean }) {
  return <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d={left ? 'M14 7l-5 5 5 5' : 'M10 7l5 5-5 5'} /></svg>;
}

function Tile({ tone, children }: { tone: 'accent' | 'stop' | 'act' | 'neutral'; children: ReactNode }) {
  return <span className={`hd-tile tone-${tone}`}><svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{children}</svg></span>;
}

const TINTS = ['t-accent', 't-ok', 't-act'];
function Initial({ state, id }: { state: QuestState; id: string }) {
  const tint = TINTS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length];
  const name = state.people.find(item => item.id === id)?.name ?? firstName(state, id, '?');
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('');
  return <span className={`avatar avatar-md ${tint}`} aria-hidden="true">{initials || '?'}</span>;
}

/** Event text with quoted task titles set apart, like "Maya started · Order shingles". */
function Recent({ event, quest, onOpen }: { event: QuestEvent; quest: Quest; onOpen: (id: string) => void }) {
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

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
