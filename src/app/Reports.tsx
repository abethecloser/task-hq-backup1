// Reports: the in-depth view behind Home's Projects and Team Overview. Same records, a rolling
// Week / Month / Quarter range, and every number links back to the work it counts.
import { useMemo, useState } from 'react';
import { STATUS_LABELS } from '../core/contract.ts';
import type { TaskStatus } from '../core/contract.ts';
import { RANGE_DAYS, RANGE_LABELS, companyReport } from '../core/reports.ts';
import type { ReportRange } from '../core/reports.ts';
import type { Lens } from '../core/registry.ts';
import { firstName, isOverdue } from '../core/selectors.ts';
import { localDate, shortDate } from '../core/time.ts';
import type { Quest } from '../ui/useQuest.ts';

const RANGE_KEY = 'quest-reports-range';
/** Status order chosen so every neighboring pair stays distinguishable (validated for color-vision deficiency). */
const STATUS_ORDER: TaskStatus[] = ['done', 'working', 'ready', 'review', 'blocked'];

export function Reports({ quest, company, onOpenTask, onLens, onCompleted }: {
  quest: Quest; company: boolean; onOpenTask: (id: string) => void; onLens: (lens: Lens) => void; onCompleted: () => void;
}) {
  const { state, actor, now } = quest;
  const [range, setRangeState] = useState<ReportRange>(() => { try { const saved = localStorage.getItem(RANGE_KEY); return saved === 'week' || saved === 'quarter' ? saved : 'month'; } catch { return 'month'; } });
  const setRange = (next: ReportRange) => { setRangeState(next); try { localStorage.setItem(RANGE_KEY, next); } catch { /* storage unavailable */ } };
  const report = useMemo(() => companyReport(state, actor, now, range, company), [state, actor, now, range, company]);
  const today = localDate(now);
  const openTotal = report.byStatus.ready + report.byStatus.working + report.byStatus.review + report.byStatus.blocked;
  const maxPerson = Math.max(1, ...report.byPerson.map(item => item.count));

  return (
    <div className="view reports-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">{company ? `${state.workspace.name} · reports` : 'Your reports'}</p>
          <h1>{company ? 'Company reports' : 'Your reports'}</h1>
          <p className="lede">Scoped to your access · {report.total} tasks · last {RANGE_DAYS[range]} days for completions.</p>
        </div>
        <div className="seg rp-range" role="group" aria-label="Report range">
          {(['week', 'month', 'quarter'] as ReportRange[]).map(item => <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{RANGE_LABELS[item]}</button>)}
        </div>
      </header>

      <section className="rp-kpis" aria-label="Key measures">
        <Kpi label="Critical & High open" value={report.criticalOpen} note="open now" hot={report.criticalOpen > 0} onClick={() => onLens('urgent')} />
        <Kpi label="Overdue" value={report.overdue} note="past due" hot={report.overdue > 0} onClick={() => onLens('overdue')} />
        <Kpi label="Completed" value={report.completed} note="in range" onClick={onCompleted} />
        <Kpi label="On-time rate" value={report.onTimeRate == null ? '—' : `${report.onTimeRate}%`} note={report.onTimeBasis ? `of ${report.onTimeBasis} dated completions` : 'no dated completions'} />
        <Kpi label="Avg cycle time" value={report.avgCycleDays == null ? '—' : `${report.avgCycleDays}d`} note="created → done" />
      </section>

      <div className="rp-grid">
        <section className="rp-card rp-throughput" aria-labelledby="rp-tp">
          <header className="rp-head"><h2 id="rp-tp">Throughput</h2><small>completed per week · last 8 weeks</small></header>
          <Throughput weeks={report.throughput} />
        </section>

        <section className="rp-card" aria-labelledby="rp-person">
          <header className="rp-head"><h2 id="rp-person">Throughput by person</h2><small>in range</small></header>
          {report.byPerson.length === 0 ? <p className="hd-quiet">No completions in this range.</p> : <ul className="rp-bars">
            {report.byPerson.slice(0, 8).map(item => <li key={item.person}>
              <span className="rp-bar-name">{firstName(state, item.person, item.person)}</span>
              <span className="rp-bar-track" aria-hidden="true"><span style={{ width: `${(item.count / maxPerson) * 100}%` }} /></span>
              <b>{item.count}</b>
            </li>)}
          </ul>}
          <p className="hd-fine">Counts of completed tasks, not hours or effort.</p>
        </section>

        <section className="rp-card" aria-labelledby="rp-status">
          <header className="rp-head"><h2 id="rp-status">Work by status</h2><small>{openTotal} open · {report.byStatus.done} done</small></header>
          <div className="rp-stack" role="img" aria-label={STATUS_ORDER.map(key => `${STATUS_LABELS[key]} ${report.byStatus[key]}`).join(', ')}>
            {STATUS_ORDER.map(key => report.byStatus[key] > 0 && <span key={key} className={`rp-seg s-${key}`} style={{ flexGrow: report.byStatus[key] }} title={`${STATUS_LABELS[key]}: ${report.byStatus[key]}`} />)}
          </div>
          <ul className="rp-legend">
            {STATUS_ORDER.map(key => <li key={key}><i className={`rp-dot s-${key}`} aria-hidden="true" />{STATUS_LABELS[key]}<b>{report.byStatus[key]}</b></li>)}
          </ul>
        </section>

        <section className="rp-card rp-critical" aria-labelledby="rp-crit">
          <header className="rp-head"><h2 id="rp-crit">Critical & High {company ? '— company-wide' : ''}</h2><button type="button" className="hd-more" onClick={() => onLens('urgent')}>View all</button></header>
          {report.critical.length === 0 ? <p className="hd-quiet">No open Critical or High work.</p> : <ul className="rp-rows">
            {report.critical.slice(0, 8).map(task => <li key={task.id}><button type="button" onClick={() => onOpenTask(task.id)}>
              <i className={`rp-pri ${task.ultra ? 'is-ultra' : ''}`} aria-label={task.ultra ? 'Critical' : 'High'} />
              <strong>{task.title}</strong>
              <span className="rp-owner">{firstName(state, task.owner, 'Unassigned')}</span>
              <span className={`pill pill-${task.status}`}>{STATUS_LABELS[task.status]}</span>
              <time className={isOverdue(task, now) ? 'is-late' : ''}>{task.due ? shortDate(task.due, today) : '—'}</time>
            </button></li>)}
          </ul>}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, hot, onClick }: { label: string; value: number | string; note: string; hot?: boolean; onClick?: () => void }) {
  const body = <><span className="rp-kpi-label">{label}</span><b className={hot ? 'is-hot' : ''}>{value}</b><small>{note}</small></>;
  return onClick ? <button type="button" className="rp-kpi is-link" onClick={onClick}>{body}</button> : <div className="rp-kpi">{body}</div>;
}

/** One series: a 2px line with markers, a hover/focus tooltip per week, and a hidden table for screen readers. */
function Throughput({ weeks }: { weeks: { start: number; label: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = 180, P = { l: 28, r: 12, t: 16, b: 26 };
  const max = Math.max(2, ...weeks.map(week => week.count));
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (weeks.length - 1);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const path = weeks.map((week, i) => `${i ? 'L' : 'M'}${x(i)},${y(week.count)}`).join(' ');
  const shown = hover ?? weeks.length - 1;
  return <div className="rp-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Completed per week: ${weeks.map(week => `${week.label} ${week.count}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
      {[0, max].map(v => <g key={v}><line className="rp-grid-line" x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} /><text className="rp-axis" x={P.l - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      <path className="rp-line" d={path} />
      {hover != null && <line className="rp-cross" x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} />}
      {weeks.map((week, i) => <circle key={week.start} className={`rp-point ${i === shown ? 'is-on' : ''}`} cx={x(i)} cy={y(week.count)} r={i === shown ? 5 : 3.5} />)}
      {weeks.map((week, i) => <rect key={`h${week.start}`} className="rp-hit" x={x(i) - (W - P.l - P.r) / 14} y={0} width={(W - P.l - P.r) / 7} height={H} tabIndex={0}
        aria-label={`Week of ${week.label}: ${week.count} completed`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />)}
      <text className="rp-axis" x={x(0)} y={H - 6} textAnchor="start">{weeks[0]!.label}</text>
      <text className="rp-axis" x={x(weeks.length - 1)} y={H - 6} textAnchor="end">{weeks.at(-1)!.label}</text>
      <g className="rp-tip" transform={`translate(${Math.min(Math.max(x(shown), P.l + 50), W - P.r - 50)},${Math.max(y(weeks[shown]!.count) - 14, 12)})`}>
        <text textAnchor="middle"><tspan className="rp-tip-value">{weeks[shown]!.count}</tspan> done · wk of {weeks[shown]!.label}</text>
      </g>
    </svg>
  </div>;
}
