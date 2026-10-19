import { Select } from '../ui/Select.tsx';
import { indexToolChanges } from '../core/tools/references.ts';
import { referenceScope } from '../core/references.ts';
import { ReferenceInput, ReferenceTextarea } from '../ui/ReferenceEditor.tsx';
// Operational tools: takeoff → underwriting → proposal, one record that travels.
//
// Every change goes through applyTool() (src/core/tools/estimating.ts), which holds the rules
// and the approval gate. Tasks a step needs are created through the task engine, never here
// (runTaskHooks). Demo only: records stay in this browser with synthetic sample values; nothing
// is sent to a client, no public link exists, and the pricing formula is the company's call.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Person } from '../core/contract.ts';
import { OPERATIONAL_ROLES, STATUS_LABELS } from '../core/contract.ts';
import { localDate } from '../core/time.ts';
import type { Estimate, Proposal, ScopeItem, ToolAction, ToolsConfig, ToolsState } from '../core/tools/estimating.ts';
import {
  ESTIMATE_STATUS_LABELS, PROPOSAL_STATUS_LABELS, applyTool, approveEstimateBlocker, approveProposalBlocker, approvalCurrent, canEditEstimate,
  canPrepare, eligibleApprovers, estimateNext, estimateNumbers, money, proposalStale,
} from '../core/tools/estimating.ts';
import { runTaskHooks } from '../core/tools/hooks.ts';
import { DECISION_LABELS, FORMULA_LABELS } from '../core/tools/pricing.ts';
import type { PricingResult } from '../core/tools/pricing.ts';
import { MEASURES, wasteFor, withWasteLabel } from '../core/tools/takeoff.ts';
import type { MeasureKey, TakeoffLine } from '../core/tools/takeoff.ts';
import type { ToolsStore } from '../adapter/tools.ts';
import type { Quest } from '../ui/useQuest.ts';

type Tab = 'estimates' | 'proposals' | 'settings';
type Selection = { kind: 'estimate' | 'proposal'; id: string } | null;

const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
const nameIn = (people: Person[], id: string, fallback = '—') => people.find(item => item.id === id)?.name ?? fallback;
const when = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Tools({ quest, store, tools, onOpenTask }: { quest: Quest; store: ToolsStore | null; tools: ToolsState | null; onOpenTask: (id: string) => void }) {
  const { state, actor, now, dispatch } = quest;
  const [tab, setTab] = useState<Tab>('estimates');
  const [selected, setSelected] = useState<Selection>(() => { const part = decodeURIComponent(location.hash.split('/')[2] ?? ''); const [kind, id] = part.split(':'); return id && (kind === 'estimate' || kind === 'proposal') ? { kind, id } as Selection : null; });
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string; extra?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const people = state.people;
  const me = people.find(item => item.id === actor);

  if (!store || !tools) {
    return (
      <div className="view tools-view">
        <header className="view-head"><div><p className="eyebrow">Operational tools</p><h1>Estimates & Proposals</h1>
          <p className="lede">Takeoff, underwriting and proposals aren’t available in live workspaces yet. They run in the demo with synthetic sample data while pricing policy and storage are approved.</p></div></header>
      </div>
    );
  }

  /** One tool step: the reducer decides; requested tasks go through the task engine. */
  async function act(action: ToolAction): Promise<boolean> {
    if (!tools || !store) return false;
    const ctx = { actor, now: Date.now(), people, newId: () => crypto.randomUUID(), today: localDate(Date.now()), taskOpen: (id: string) => state.tasks.some(task => task.id === id && task.status !== 'done') };
    const res = applyTool(tools, action, ctx);
    if (!res.ok) { setNotice({ tone: 'error', text: res.error }); return false; }
    const indexed = indexToolChanges(tools, res.state, referenceScope(state, actor), quest.referenceDrafts.documents());
    if (indexed.tags.length) { const saved = await dispatch({ type: 'taxonomy/register-tags', tags: indexed.tags }); if (!saved.ok) { setNotice({ tone: 'error', text: saved.error }); return false; } }
    let next: ToolsState = indexed.state;
    store.save(next);
    if (res.tasks.length || res.close.length) {
      setBusy(true);
      const hooks = await runTaskHooks(res.tasks, res.close, async engineAction => {
        const out = await dispatch(engineAction);
        return out.ok ? { ok: true as const, state: out.state, eventId: out.eventId } : { ok: false as const, error: out.error };
      });
      for (const link of hooks.links) { const linked = applyTool(next, link, ctx); if (linked.ok) next = linked.state; }
      store.save(next);
      setBusy(false);
      const extra = [...hooks.created.map(item => `Task created: “${item.title}”.`), ...(hooks.closed.length ? [`${hooks.closed.length} linked task${hooks.closed.length === 1 ? '' : 's'} finished.`] : []), ...hooks.problems];
      setNotice({ tone: hooks.problems.length ? 'error' : 'ok', text: res.message, extra });
    } else {
      setNotice({ tone: 'ok', text: res.message });
    }
    return true;
  }

  const estimate = selected?.kind === 'estimate' ? tools.estimates.find(item => item.id === selected.id) ?? null : null;
  const proposal = selected?.kind === 'proposal' ? tools.proposals.find(item => item.id === selected.id) ?? null : null;
  const policy = tools.config.policy;

  return (
    <div className="view tools-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Operational tools · demo · sample values</p>
          <h1>Estimates & Proposals</h1>
          <p className="lede">Measurements → priced estimate → approved price → proposal, without retyping. Each step creates real tasks with real owners.</p>
        </div>
      </header>

      <PolicyBanner tools={tools} me={me} people={people} act={act} />

      <div className="lens-bar tools-tabs" role="tablist">
        {(['estimates', 'proposals', 'settings'] as Tab[]).map(value => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={`lens ${tab === value ? 'is-active' : ''}`} onClick={() => { setTab(value); setSelected(null); }}>
            {value === 'estimates' ? 'Estimates' : value === 'proposals' ? 'Proposals' : 'Settings'}
            {value !== 'settings' && <span>{value === 'estimates' ? tools.estimates.length : tools.proposals.length}</span>}
          </button>
        ))}
        {busy && <em className="muted tools-busy">Updating tasks…</em>}
      </div>

      {notice && (
        <div className={`tools-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <b>{notice.text}</b>{notice.extra?.map(line => <span key={line}>{line}</span>)}
          <button type="button" className="link" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {tab === 'settings' ? <ToolSettings tools={tools} me={me} act={act} onReset={() => { store.reset(); setSelected(null); setNotice({ tone: 'ok', text: 'Sample tools data reset.' }); }} />
        : estimate ? <EstimateDetail key={estimate.id} tools={tools} estimate={estimate} quest={quest} act={act} onBack={() => setSelected(null)} onOpenTask={onOpenTask} onOpenProposal={id => { setTab('proposals'); setSelected({ kind: 'proposal', id }); }} />
        : proposal ? <ProposalDetail key={proposal.id} tools={tools} proposal={proposal} quest={quest} act={act} onBack={() => setSelected(null)} onOpenTask={onOpenTask} onOpenEstimate={id => { setTab('estimates'); setSelected({ kind: 'estimate', id }); }} />
        : tab === 'estimates' ? <EstimateList tools={tools} people={people} canStart={canPrepare(people, actor)} act={act} onOpen={id => setSelected({ kind: 'estimate', id })} newest={() => tools.estimates[0]?.id} />
        : <ProposalList tools={tools} people={people} onOpen={id => setSelected({ kind: 'proposal', id })} />}

      <p className="boundary tools-boundary">
        Demo only: records stay in this browser. Measurements are typed in — there’s no measurement-report integration. Proposals are never sent from Task-HQ, have no client link and collect no signatures.
        {policy.formula === 'undecided' ? ' The pricing formula is undecided, so no price can be approved.' : policy.demo ? ' The pricing formula in use was chosen for this demo only.' : ''}
      </p>
    </div>
  );
}

// ── Pricing policy ─────────────────────────────────────────────────────────

function PolicyBanner({ tools, me, people, act }: { tools: ToolsState; me: Person | undefined; people: Person[]; act: (a: ToolAction) => Promise<boolean> }) {
  const policy = tools.config.policy;
  const manager = me?.role === 'manager';
  if (policy.formula === 'undecided') {
    return (
      <section className="tools-policy is-undecided" aria-label="Pricing formula">
        <div>
          <b>Pricing formula: not decided.</b>
          <span>The legacy tools disagree: one counts overhead, commission and contingency as a share of price; the other counts commission only. Every estimate shows both until the company chooses. Approvals are blocked until then.</span>
        </div>
        {manager
          ? <div className="tools-policy-actions">
              <button type="button" className="btn btn-sm" onClick={() => void act({ type: 'policy/decide', formula: 'full-burden', note: 'Chosen to exercise the demo.', demo: true })}>Use full burden for this demo</button>
              <button type="button" className="btn btn-sm" onClick={() => void act({ type: 'policy/decide', formula: 'commission-only', note: 'Chosen to exercise the demo.', demo: true })}>Use commission only for this demo</button>
            </div>
          : <span className="muted">A manager decides.</span>}
      </section>
    );
  }
  return (
    <section className={`tools-policy ${policy.demo ? 'is-demo' : ''}`} aria-label="Pricing formula">
      <div>
        <b>Pricing formula: {FORMULA_LABELS[policy.formula]}{policy.demo ? ' — demo only' : ''}.</b>
        <span>Chosen by {nameIn(people, policy.decidedBy)}{policy.decidedAt ? ` · ${when(policy.decidedAt)}` : ''}. {policy.demo ? 'This is not company policy.' : ''} Changing it voids existing approvals.</span>
      </div>
      {manager && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act({ type: 'policy/reset' })}>Set back to “not decided”</button>}
    </section>
  );
}

// ── Lists ──────────────────────────────────────────────────────────────────

const statusTone = (status: string) => (status === 'approved' || status === 'accepted' ? 'is-good' : status === 'reprice' || status === 'declined' ? 'is-bad' : status === 'needs-review' || status === 'in-review' || status === 'ready' ? 'is-wait' : '');

function EstimateList({ tools, people, canStart, act, onOpen, newest }: { tools: ToolsState; people: Person[]; canStart: boolean; act: (a: ToolAction) => Promise<boolean>; onOpen: (id: string) => void; newest: () => string | undefined }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', name: '', address: '', trade: 'Roofing', fromLibrary: true });
  async function create() {
    const done = await act({ type: 'estimate/create', title: form.title, customer: { name: form.name, phone: '', email: '' }, address: form.address, trade: form.trade, fromLibrary: form.fromLibrary });
    if (done) { setCreating(false); setForm({ title: '', name: '', address: '', trade: 'Roofing', fromLibrary: true }); const id = newest(); if (id) onOpen(id); }
  }
  return (
    <section className="tools-list" aria-label="Estimates">
      <div className="tools-list-head">
        <h2 className="section-label">Estimates</h2>
        {canStart && !creating && <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>New estimate</button>}
      </div>
      {creating && (
        <form className="panel tools-new" onSubmit={event => { event.preventDefault(); void create(); }}>
          <label className="field"><span>Job name</span><input autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Oak Ct re-roof" /></label>
          <label className="field"><span>Customer</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Property address</span><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
          <label className="field"><span>Trade</span><Select value={form.trade} onChange={e => setForm({ ...form, trade: e.target.value })}>{['Roofing', 'Gutters', 'Framing', 'Other'].map(item => <option key={item}>{item}</option>)}</Select></label>
          <label className="check"><input type="checkbox" checked={form.fromLibrary} onChange={e => setForm({ ...form, fromLibrary: e.target.checked })} /> Start from the line library</label>
          <div className="tools-form-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={!form.title.trim()}>Create</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}
      <div className="tools-table">
        <div className="tools-row is-head"><span>Estimate</span><span>Status</span><span>Price</span><span>Margin</span><span>Next</span></div>
        {tools.estimates.map(item => {
          const numbers = estimateNumbers(item, tools.config);
          const r = numbers.decided ?? numbers.results[0]!;
          return (
            <button key={item.id} type="button" className="tools-row" onClick={() => onOpen(item.id)}>
              <span className="tools-cell-main"><b>{item.title}</b><small>{item.number} · {item.address || 'No address'} · {nameIn(people, item.preparedBy)}</small></span>
              <span><i className={`tools-status ${statusTone(item.status)}`}>{ESTIMATE_STATUS_LABELS[item.status]}</i></span>
              <span className="num">{money(item.price)}</span>
              <span className="num">{numbers.decided ? pct(r.margin) : r.margin === null ? '—' : <>{pct(numbers.results[0]!.margin)} / {pct(numbers.results[1]!.margin)}</>}</span>
              <span className="muted">{estimateNext(item, tools)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ProposalList({ tools, people, onOpen }: { tools: ToolsState; people: Person[]; onOpen: (id: string) => void }) {
  return (
    <section className="tools-list" aria-label="Proposals">
      <div className="tools-list-head"><h2 className="section-label">Proposals</h2></div>
      {!tools.proposals.length && <p className="muted tools-empty">No proposals yet. A proposal starts from an approved estimate.</p>}
      {tools.proposals.length > 0 && (
        <div className="tools-table">
          <div className="tools-row is-head"><span>Proposal</span><span>Status</span><span>Price</span><span>Valid through</span><span>Prepared by</span></div>
          {tools.proposals.map(item => (
            <button key={item.id} type="button" className="tools-row" onClick={() => onOpen(item.id)}>
              <span className="tools-cell-main"><b>{item.snapshot.title}</b><small>{item.number} · {item.snapshot.customer.name || 'No customer'}</small></span>
              <span><i className={`tools-status ${proposalStale(item, tools) && !['accepted', 'declined', 'withdrawn'].includes(item.status) ? 'is-bad' : statusTone(item.status)}`}>{proposalStale(item, tools) && !['accepted', 'declined', 'withdrawn'].includes(item.status) ? 'On hold — price changed' : PROPOSAL_STATUS_LABELS[item.status]}</i></span>
              <span className="num">{money(item.snapshot.price)}</span>
              <span>{item.validThrough}</span>
              <span>{nameIn(people, item.preparedBy)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Estimate ───────────────────────────────────────────────────────────────

/** A number input that commits valid numbers as you type and keeps your text while it's incomplete. */
function NumberField({ label, value, onCommit, disabled, suffix, allowEmpty, hint }: { label: string; value: number | null | undefined; onCommit: (v: number | null) => void; disabled?: boolean; suffix?: string; allowEmpty?: boolean; hint?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => { setText(current => (Number(current) === value || (current === '' && (value === null || value === undefined)) ? current : value === null || value === undefined ? '' : String(value))); }, [value]);
  const bad = text.trim() !== '' && (!Number.isFinite(Number(text)) || Number(text) < 0);
  return (
    <label className={`field tools-num ${bad ? 'is-bad' : ''}`}>
      <span>{label}{suffix ? <em>{suffix}</em> : null}</span>
      <input inputMode="decimal" value={text} disabled={disabled} aria-invalid={bad}
        onChange={event => {
          const raw = event.target.value; setText(raw);
          if (raw.trim() === '') { if (allowEmpty) onCommit(null); return; }
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) onCommit(n);
        }} />
      {bad ? <small className="text-danger">Enter a number, zero or more.</small> : hint ? <small className="field-hint">{hint}</small> : null}
    </label>
  );
}

function EstimateDetail({ tools, estimate, quest, act, onBack, onOpenTask, onOpenProposal }: {
  tools: ToolsState; estimate: Estimate; quest: Quest; act: (a: ToolAction) => Promise<boolean>; onBack: () => void; onOpenTask: (id: string) => void; onOpenProposal: (id: string) => void;
}) {
  const { state, actor } = quest;
  const people = state.people;
  const config = tools.config;
  const numbers = useMemo(() => estimateNumbers(estimate, config), [estimate, config]);
  const editable = canEditEstimate(people, estimate, actor);
  const [unlocked, setUnlocked] = useState(false);
  const locked = !editable || (!['draft', 'reprice'].includes(estimate.status) && !unlocked);
  const [note, setNote] = useState('');
  const [askTo, setAskTo] = useState('');
  const [template, setTemplate] = useState(config.proposal.templates[0]?.id ?? '');
  const update = (changes: Parameters<typeof act>[0] extends infer A ? A extends { type: 'estimate/update'; changes: infer C } ? C : never : never) => void act({ type: 'estimate/update', id: estimate.id, changes });
  const takeoff = estimate.takeoff;
  const setTakeoff = (changes: Partial<typeof takeoff>) => update({ takeoff: { ...takeoff, ...changes } });
  const setLine = (id: string, changes: Partial<TakeoffLine>) => setTakeoff({ lines: takeoff.lines.map(line => (line.id === id ? { ...line, ...changes } : line)) });
  const approvers = eligibleApprovers(people, config, estimate.preparedBy);
  const approveBlocker = approveEstimateBlocker(tools, estimate, actor, people);
  const proposals = tools.proposals.filter(item => item.estimateId === estimate.id);
  const current = approvalCurrent(estimate, config);
  const canSendBack = ['ready', 'needs-review', 'approved'].includes(estimate.status) && (estimate.approver === actor || people.find(p => p.id === actor)?.role === 'manager');
  const lineNames = [...MEASURES.flatMap(m => [m.label, withWasteLabel(m.label)]), ...takeoff.lines.map(line => line.name)];
  const exceptionNeeded = (numbers.decided?.decision === 'review') || numbers.tier?.needsSignoff;

  return (
    <article className="tools-detail" aria-label={`Estimate ${estimate.number}`}>
      <div className="tools-detail-head">
        <button type="button" className="link" onClick={onBack}>← All estimates</button>
        <div className="tools-title">
          <p className="eyebrow">{estimate.number} · {estimate.trade} · prepared by {nameIn(people, estimate.preparedBy)}</p>
          <h2>{estimate.title}</h2>
          <p className="muted">{estimate.customer.name || 'No customer yet'} · {estimate.address || 'No address yet'}</p>
        </div>
        <div className="tools-state">
          <i className={`tools-status ${statusTone(estimate.status)}`}>{ESTIMATE_STATUS_LABELS[estimate.status]}</i>
          <span className="tools-next">Next: {estimateNext(estimate, tools)}</span>
        </div>
      </div>

      {locked && editable && (
        <div className="tools-lock">
          <span>{estimate.status === 'approved' ? 'Approved numbers are locked. Changing anything voids the approval and puts proposals on hold.' : 'Submitted numbers are locked. Changing anything returns the estimate to Draft.'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnlocked(true)}>Edit anyway</button>
        </div>
      )}
      {!editable && <p className="boundary">You can view this estimate. Only the person preparing it, an estimator or a manager can change it.</p>}

      <div className="tools-grid">
        <div className="tools-main">
          <Section title="Customer & property">
            <div className="tools-fields">
              <TextField label="Job name" value={estimate.title} disabled={locked} onCommit={v => update({ title: v })} />
              <TextField label="Customer" value={estimate.customer.name} disabled={locked} onCommit={v => update({ customer: { ...estimate.customer, name: v } })} />
              <TextField label="Phone" value={estimate.customer.phone} disabled={locked} onCommit={v => update({ customer: { ...estimate.customer, phone: v } })} />
              <TextField label="Email" value={estimate.customer.email} disabled={locked} onCommit={v => update({ customer: { ...estimate.customer, email: v } })} />
              <TextField label="Property address" value={estimate.address} disabled={locked} onCommit={v => update({ address: v })} wide />
            </div>
          </Section>

          <Section title="Measurements" aside={<span className="muted">Typed from a measurement report or a field measure</span>}>
            <div className="tools-fields is-measures">
              {MEASURES.map(m => (
                <div key={m.key} className="tools-measure">
                  <NumberField label={m.label} suffix={m.unit} value={takeoff.measurements[m.key] ?? null} allowEmpty disabled={locked}
                    onCommit={v => setTakeoff({ measurements: { ...takeoff.measurements, [m.key]: v } })} />
                  <small className="muted">+ {wasteFor(takeoff, m.key)}% → {numbers.takeoff.base[withWasteLabel(m.label)] ?? '—'}</small>
                </div>
              ))}
            </div>
            <div className="tools-fields">
              <NumberField label="Waste for the job" suffix="%" value={takeoff.wastePct} disabled={locked} onCommit={v => setTakeoff({ wastePct: v ?? 0 })} hint="Applies to every measurement unless overridden." />
              <label className="field"><span>Override for</span>
                <Select disabled={locked} value="" onChange={e => { const key = e.target.value as MeasureKey; if (key) setTakeoff({ overrides: { ...takeoff.overrides, [key]: takeoff.wastePct } }); }}>
                  <option value="">Add an override…</option>
                  {MEASURES.filter(m => takeoff.overrides[m.key] === undefined).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </Select>
              </label>
              {Object.entries(takeoff.overrides).map(([key, value]) => (
                <div key={key} className="tools-override">
                  <NumberField label={`${MEASURES.find(m => m.key === key)?.label} waste`} suffix="%" value={value ?? 0} disabled={locked} onCommit={v => setTakeoff({ overrides: { ...takeoff.overrides, [key]: v ?? 0 } })} />
                  {!locked && <button type="button" className="link" onClick={() => { const next = { ...takeoff.overrides }; delete next[key as MeasureKey]; setTakeoff({ overrides: next }); }}>Remove</button>}
                </div>
              ))}
              <TextField label="Predominant pitch" value={takeoff.pitch} disabled={locked} onCommit={v => setTakeoff({ pitch: v })} hint="Recorded only. It never changes waste by itself." />
              <label className="field"><span>Source</span>
                <Select disabled={locked} value={takeoff.source} onChange={e => setTakeoff({ source: e.target.value as typeof takeoff.source })}>
                  <option value="">Not recorded</option><option value="report">Measurement report</option><option value="field">Field measure</option>
                </Select>
              </label>
            </div>
            <div className="tools-reports">
              <h4 className="section-label">Measurement reports</h4>
              {takeoff.reports.map(report => (
                <div key={report.id} className="tools-report">
                  <span><b>{report.name}</b> <small className="muted">{Math.max(1, Math.round(report.size / 1024))} KB · {nameIn(people, report.addedBy)} · {when(report.addedAt)} · file not uploaded</small></span>
                  {!locked && <button type="button" className="link" onClick={() => void act({ type: 'estimate/remove-report', id: estimate.id, reportId: report.id })}>Remove</button>}
                </div>
              ))}
              {editable && (
                <label className="btn btn-ghost btn-sm tools-file">
                  Record a report file
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.xml,.esx" onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void act({ type: 'estimate/attach-report', id: estimate.id, report: { name: file.name, size: file.size, type: file.type } });
                    event.target.value = '';
                  }} />
                </label>
              )}
              <p className="boundary">Only the file’s name and size are recorded. Uploading the file to shared storage needs approval first.</p>
              {editable && numbers.takeoff.missing.includes('totalSq') && (
                <div className="tools-ask">
                  <Select value={askTo} onChange={e => setAskTo(e.target.value)} aria-label="Who should measure">
                    <option value="">Ask someone to measure…</option>
                    {people.filter(p => OPERATIONAL_ROLES.includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}
                  </Select>
                  <button type="button" className="btn btn-sm" disabled={!askTo} onClick={() => void act({ type: 'estimate/request-measurements', id: estimate.id, to: askTo, note: '' })}>Create task</button>
                </div>
              )}
            </div>
          </Section>

          <Section title="Takeoff lines" aside={<span className="muted">Quantities: type a number or a formula like ROUNDUP({'{'}Total SQ + waste{'}'} * 3)</span>}>
            <datalist id={`refs-${estimate.id}`}>{lineNames.map(name => <option key={name} value={`{${name}}`} />)}</datalist>
            <div className="tools-lines">
              <div className="tools-line is-head"><span>Line</span><span>Quantity</span><span>Qty</span><span>Unit cost</span><span>Amount</span><span /></div>
              {takeoff.lines.map(line => {
                const result = numbers.takeoff.lines.find(item => item.id === line.id)!;
                const problem = numbers.takeoff.problems.find(item => item.id === line.id);
                return (
                  <div key={line.id} className={`tools-line ${problem ? 'has-problem' : ''}`}>
                    <span className="tools-line-name">
                      <Select disabled={locked} value={line.group} onChange={e => setLine(line.id, { group: e.target.value as TakeoffLine['group'] })} aria-label="Group"><option value="material">Material</option><option value="labor">Labor</option></Select>
                      <TextField label="Name" bare value={line.name} disabled={locked} onCommit={v => setLine(line.id, { name: v })} />
                      <TextField label="Unit" bare value={line.unit} disabled={locked} onCommit={v => setLine(line.id, { unit: v })} small />
                    </span>
                    <span><FormulaField line={line} disabled={locked} list={`refs-${estimate.id}`} onCommit={(formula, typed) => setLine(line.id, { formula, typed })} /></span>
                    <span className="num">{result.value ?? '—'}</span>
                    <span><NumberField label="Unit cost" value={line.unitCost} disabled={locked} onCommit={v => setLine(line.id, { unitCost: v ?? 0 })} /></span>
                    <span className="num">{money(result.amount)}</span>
                    <span>{!locked && <button type="button" className="link" aria-label={`Remove ${line.name}`} onClick={() => setTakeoff({ lines: takeoff.lines.filter(item => item.id !== line.id) })}>Remove</button>}</span>
                    {(problem || (result.error && result.error !== 'No quantity yet.')) && <small className="text-danger tools-line-error">{problem?.error ?? result.error}</small>}
                  </div>
                );
              })}
              {!locked && (
                <div className="tools-line-add">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTakeoff({ lines: [...takeoff.lines, { id: crypto.randomUUID(), group: 'material', name: `New line ${takeoff.lines.length + 1}`, unit: 'ea', formula: '', typed: 1, unitCost: 0 }] })}>Add line</button>
                  {!takeoff.lines.length && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTakeoff({ lines: config.library.map(item => ({ ...item, id: crypto.randomUUID() })) })}>Use the line library</button>}
                  <label className="check"><input type="checkbox" checked={!!takeoff.crew} onChange={e => setTakeoff({ crew: e.target.checked ? { size: 3, days: 1, hours: 8, rate: 0 } : null })} /> Add crew labor (crew × days × hours × rate)</label>
                </div>
              )}
              {takeoff.crew && (
                <div className="tools-fields">
                  <NumberField label="Crew size" value={takeoff.crew.size} disabled={locked} onCommit={v => setTakeoff({ crew: { ...takeoff.crew!, size: v ?? 0 } })} />
                  <NumberField label="Days" value={takeoff.crew.days} disabled={locked} onCommit={v => setTakeoff({ crew: { ...takeoff.crew!, days: v ?? 0 } })} />
                  <NumberField label="Hours per day" value={takeoff.crew.hours} disabled={locked} onCommit={v => setTakeoff({ crew: { ...takeoff.crew!, hours: v ?? 0 } })} />
                  <NumberField label="Rate per hour" suffix="$" value={takeoff.crew.rate} disabled={locked} onCommit={v => setTakeoff({ crew: { ...takeoff.crew!, rate: v ?? 0 } })} />
                  <p className="muted">{numbers.takeoff.manHours} man-hours · {money(numbers.takeoff.crewLabor)}</p>
                </div>
              )}
            </div>
          </Section>

          <Section title="Pricing">
            <div className="tools-fields">
              <NumberField label="Permits" suffix="$" value={estimate.extra.permits} disabled={locked} onCommit={v => update({ extra: { ...estimate.extra, permits: v ?? 0 } })} />
              <NumberField label="Disposal" suffix="$" value={estimate.extra.disposal} disabled={locked} onCommit={v => update({ extra: { ...estimate.extra, disposal: v ?? 0 } })} />
              <NumberField label="Other direct" suffix="$" value={estimate.extra.other} disabled={locked} onCommit={v => update({ extra: { ...estimate.extra, other: v ?? 0 } })} />
              <NumberField label="Tax" suffix="%" value={estimate.taxPct} disabled={locked} onCommit={v => update({ taxPct: v ?? 0 })} />
              <label className="field"><span>Tax applies to</span>
                <Select disabled={locked} value={estimate.taxBase} onChange={e => update({ taxBase: e.target.value as Estimate['taxBase'] })}><option value="material">Material only</option><option value="all">Material and labor</option></Select>
              </label>
              <NumberField label="Overhead" suffix="% of price" value={estimate.rates.overhead} disabled={locked} onCommit={v => update({ rates: { ...estimate.rates, overhead: v ?? 0 } })} />
              <NumberField label="Commission" suffix="% of price" value={estimate.rates.commission} disabled={locked} onCommit={v => update({ rates: { ...estimate.rates, commission: v ?? 0 } })} />
              <NumberField label="Contingency" suffix="% of price" value={estimate.rates.contingency} disabled={locked} onCommit={v => update({ rates: { ...estimate.rates, contingency: v ?? 0 } })} />
              <label className="field"><span>Margin tier</span>
                <Select disabled={locked} value={estimate.tierId} onChange={e => update({ tierId: e.target.value })}>
                  {config.tiers.map(tier => <option key={tier.id} value={tier.id}>{tier.label} · {tier.target}%</option>)}
                </Select>
              </label>
              <NumberField label="Target margin" suffix="%" value={estimate.target} disabled={locked || !numbers.tier?.needsSignoff} onCommit={v => update({ target: v ?? 0 })} hint={numbers.tier?.needsSignoff ? 'Sign-off tier: approval needs a written reason.' : 'Set by the tier.'} />
            </div>
            <div className="tools-price-row">
              <NumberField label="Selling price" suffix="$" value={estimate.price} allowEmpty disabled={locked} onCommit={v => update({ price: v })} />
              {!locked && numbers.results.map(r => r.priceAtTarget !== null && (
                <button key={r.formula} type="button" className="btn btn-ghost btn-sm" onClick={() => update({ price: Math.ceil(r.priceAtTarget!) })}>
                  Use {money(Math.ceil(r.priceAtTarget))}{numbers.results.length > 1 ? ` (${r.formula === 'full-burden' ? 'full burden' : 'commission only'})` : ''}
                </button>
              ))}
            </div>
            <div className={`tools-results ${numbers.results.length > 1 ? 'is-split' : ''}`}>
              {numbers.results.map(r => <ResultCard key={r.formula} result={r} undecided={numbers.results.length > 1} directParts={numbers.direct} />)}
            </div>
          </Section>
        </div>

        <aside className="tools-side" aria-label="Approval and tasks">
          <Section title="Approval">
            <label className="field"><span>Approver</span>
              <Select disabled={locked} value={estimate.approver} onChange={e => update({ approver: e.target.value })}>
                <option value="">Choose…</option>
                {approvers.map(p => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}
              </Select>
              {!config.allowSelfApproval && <small className="field-hint">The person who prepared a price can’t approve it.</small>}
            </label>
            {editable && ['draft', 'reprice'].includes(estimate.status) && (
              <button type="button" className="btn btn-primary wide" onClick={() => void act({ type: 'estimate/submit', id: estimate.id })}>Submit for approval</button>
            )}
            {['ready', 'needs-review'].includes(estimate.status) && (
              <div className="tools-approve">
                {exceptionNeeded && !approveBlocker && <p className="muted">{numbers.tier?.needsSignoff ? `The ${numbers.tier.label} tier needs sign-off.` : 'Below target, within the review band.'} Write why you’re approving it.</p>}
                {(!approveBlocker || canSendBack) && <ReferenceTextarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={approveBlocker ? 'What needs to change?' : 'Reason (required for exceptions)'} aria-label="Approval note" />}
                {!approveBlocker && <button type="button" className="btn btn-dark wide" onClick={() => void act({ type: 'estimate/approve', id: estimate.id, note }).then(ok => ok && setNote(''))}>Approve price</button>}
                {approveBlocker && <p className="boundary">{approveBlocker}</p>}
              </div>
            )}
            {canSendBack && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act({ type: 'estimate/send-back', id: estimate.id, note }).then(ok => ok && setNote(''))}>Send back to reprice</button>}
            {estimate.approval && (
              <div className={`tools-approval ${current ? '' : 'is-void'}`}>
                <b>{current ? 'Approved' : 'Approval no longer applies'}</b>
                <span>{nameIn(people, estimate.approval.by)} · {when(estimate.approval.at)} · {money(estimate.approval.price)} at {pct(estimate.approval.margin)} ({estimate.approval.formula === 'full-burden' ? 'full burden' : 'commission only'})</span>
                {estimate.approval.note && <q>{estimate.approval.note}</q>}
              </div>
            )}
            {estimate.voided.length > 0 && <p className="muted">{estimate.voided.length} earlier approval{estimate.voided.length === 1 ? '' : 's'} voided by later changes.</p>}
          </Section>

          {config.modules.proposals && (
            <Section title="Proposal">
              {proposals.map(item => (
                <button key={item.id} type="button" className="tools-linked" onClick={() => onOpenProposal(item.id)}>
                  <b>{item.number}</b><span>{proposalStale(item, tools) && !['accepted', 'declined', 'withdrawn'].includes(item.status) ? 'On hold — price changed' : PROPOSAL_STATUS_LABELS[item.status]}</span>
                </button>
              ))}
              {current && canPrepare(people, actor) && !proposals.some(item => item.basedOn === estimate.approval?.inputsHash && ['draft', 'in-review', 'approved'].includes(item.status)) && (
                <div className="tools-ask">
                  <Select value={template} onChange={e => setTemplate(e.target.value)} aria-label="Template">{config.proposal.templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void act({ type: 'proposal/create', estimateId: estimate.id, templateId: template }).then(ok => { if (ok) { const made = tools.proposals[0]; void made; } })}>Create proposal</button>
                </div>
              )}
              {!current && !proposals.length && <p className="muted">Available once the price is approved.</p>}
            </Section>
          )}

          <LinkedTasks tasks={estimate.tasks} quest={quest} onOpenTask={onOpenTask} />
          <History entries={estimate.history} people={people} />
        </aside>
      </div>
    </article>
  );
}

function ResultCard({ result, undecided, directParts }: { result: PricingResult; undecided: boolean; directParts: ReturnType<typeof estimateNumbers>['direct'] }) {
  const rows: [string, ReactNode][] = [
    ['Material', money(directParts.material)], ['Tax', money(directParts.tax)], ['Labor', money(directParts.labor)],
    ['Permits, disposal, other', money(directParts.permits + directParts.disposal + directParts.other)],
    ['Direct cost', <b key="d">{money(result.directTotal)}</b>],
    [`Price-based costs (${result.variableRate}%)`, money(result.variableCost)], ['Total cost', <b key="t">{money(result.totalCost)}</b>],
    ['Gross profit', money(result.grossProfit)], ['Margin', <b key="m">{pct(result.margin)}</b>], ['vs target', result.marginGap === null ? '—' : `${result.marginGap > 0 ? '+' : ''}${result.marginGap.toFixed(2)} pts`],
    ['Price at target', money(result.priceAtTarget)], ['Break-even price', money(result.breakEven)], ['Direct-cost headroom', money(result.directHeadroom)],
  ];
  return (
    <div className={`tools-result is-${result.decision}`}>
      <p className="section-label">{undecided ? FORMULA_LABELS[result.formula] : 'Result'}</p>
      <strong className="tools-decision">{DECISION_LABELS[result.decision]}</strong>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {result.problems.filter(item => !item.startsWith('No ')).map(item => <p key={item} className="text-danger">{item}</p>)}
    </div>
  );
}

function FormulaField({ line, disabled, list, onCommit }: { line: TakeoffLine; disabled: boolean; list: string; onCommit: (formula: string, typed: number | null) => void }) {
  const initial = line.formula || (line.typed ?? '').toString();
  const [text, setText] = useState(initial);
  useEffect(() => { setText(line.formula || (line.typed ?? '').toString()); }, [line.formula, line.typed]);
  function commit(value: string) {
    const trimmed = value.trim();
    if (trimmed === '') { onCommit('', null); return; }
    const n = Number(trimmed);
    if (Number.isFinite(n) && /^[\d.]+$/.test(trimmed)) onCommit('', n);
    else onCommit(trimmed, null);
  }
  return <input className="tools-formula" list={list} value={text} disabled={disabled} aria-label={`Quantity for ${line.name}`} onChange={e => setText(e.target.value)} onBlur={e => { if (e.target.value !== initial) commit(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />;
}

function TextField({ label, value, onCommit, disabled, wide, bare, small, hint }: { label: string; value: string; onCommit: (v: string) => void; disabled?: boolean; wide?: boolean; bare?: boolean; small?: boolean; hint?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const input = <ReferenceInput value={text} disabled={disabled} aria-label={bare ? label : undefined} className={small ? 'is-small' : undefined} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== value) onCommit(text); }} onKeyDown={e => { if (e.key === 'Enter' && text !== value) onCommit(text); }} />;
  if (bare) return input;
  return <label className={`field ${wide ? 'is-wide' : ''}`}><span>{label}</span>{input}{hint && <small className="field-hint">{hint}</small>}</label>;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="panel tools-section"><header><h3 className="section-label">{title}</h3>{aside}</header>{children}</section>;
}

function LinkedTasks({ tasks, quest, onOpenTask }: { tasks: Record<string, string>; quest: Quest; onOpenTask: (id: string) => void }) {
  const entries = Object.entries(tasks).map(([key, id]) => ({ key, task: quest.state.tasks.find(item => item.id === id) })).filter(item => item.task);
  return (
    <section className="panel tools-section">
      <header><h3 className="section-label">Tasks</h3></header>
      {!entries.length && <p className="muted">Steps here create tasks with real owners. None yet.</p>}
      {entries.map(({ key, task }) => (
        <button key={key} type="button" className="tools-linked" onClick={() => onOpenTask(task!.id)}>
          <b>{task!.title}</b><span>{STATUS_LABELS[task!.status]} · {nameIn(quest.state.people, task!.owner, 'unassigned')}</span>
        </button>
      ))}
    </section>
  );
}

function History({ entries, people }: { entries: { at: number; by: string; text: string }[]; people: Person[] }) {
  return (
    <section className="panel tools-section">
      <header><h3 className="section-label">History</h3></header>
      <ol className="tools-history">{entries.slice(0, 12).map((entry, i) => <li key={i}><span>{entry.text}</span><small className="muted">{when(entry.at)}{entry.by ? ` · ${nameIn(people, entry.by)}` : ''}</small></li>)}</ol>
    </section>
  );
}

// ── Proposal ───────────────────────────────────────────────────────────────

function ProposalDetail({ tools, proposal, quest, act, onBack, onOpenTask, onOpenEstimate }: {
  tools: ToolsState; proposal: Proposal; quest: Quest; act: (a: ToolAction) => Promise<boolean>; onBack: () => void; onOpenTask: (id: string) => void; onOpenEstimate: (id: string) => void;
}) {
  const { state, actor } = quest;
  const people = state.people;
  const me = people.find(item => item.id === actor);
  const config = tools.config;
  const stale = proposalStale(proposal, tools);
  const decided = ['accepted', 'declined', 'withdrawn'].includes(proposal.status);
  const editable = !decided && canPrepare(people, actor) && (proposal.preparedBy === actor || me?.role === 'manager' || me?.role === 'estimator');
  const approveBlocker = approveProposalBlocker(tools, proposal, actor, people);
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState({ outcome: 'accepted' as 'accepted' | 'declined', signer: '', note: '', handoffTo: '' });
  const update = (changes: Extract<ToolAction, { type: 'proposal/update' }>['changes']) => void act({ type: 'proposal/update', id: proposal.id, changes });
  const setScope = (scope: ScopeItem[]) => update({ scope });
  const deposit = Math.round(proposal.snapshot.price * proposal.depositPct) / 100;

  function print() {
    document.body.classList.add('printing-proposal');
    const done = () => { document.body.classList.remove('printing-proposal'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  return (
    <article className="tools-detail" aria-label={`Proposal ${proposal.number}`}>
      <div className="tools-detail-head">
        <button type="button" className="link" onClick={onBack}>← All proposals</button>
        <div className="tools-title">
          <p className="eyebrow">{proposal.number} · from <button type="button" className="link" onClick={() => onOpenEstimate(proposal.estimateId)}>estimate</button> · prepared by {nameIn(people, proposal.preparedBy)}</p>
          <h2>{proposal.snapshot.title}</h2>
          <p className="muted">{proposal.snapshot.customer.name || 'No customer'} · {money(proposal.snapshot.price)} approved by {nameIn(people, proposal.snapshot.approvedBy)}</p>
        </div>
        <div className="tools-state">
          <i className={`tools-status ${stale && !decided ? 'is-bad' : statusTone(proposal.status)}`}>{stale && !decided ? 'On hold — price changed' : PROPOSAL_STATUS_LABELS[proposal.status]}</i>
        </div>
      </div>
      {stale && !decided && <div className="tools-lock is-bad"><span>The estimate behind this proposal changed or lost its approval. It can’t be approved or accepted until the price is approved again; then create a new proposal from it.</span></div>}

      <div className="tools-grid is-proposal">
        <div className="tools-main">
          <Section title="Scope">
            {proposal.scope.map((item, index) => (
              <div key={item.id} className="tools-scope">
                <TextField label="Service" bare value={item.service} disabled={!editable} onCommit={v => setScope(proposal.scope.map(s => (s.id === item.id ? { ...s, service: v } : s)))} />
                <TextField label="Description" bare value={item.description} disabled={!editable} onCommit={v => setScope(proposal.scope.map(s => (s.id === item.id ? { ...s, description: v } : s)))} />
                <label className="check"><input type="checkbox" disabled={!editable} checked={item.highlight} onChange={e => setScope(proposal.scope.map(s => (s.id === item.id ? { ...s, highlight: e.target.checked } : s)))} /> Highlight</label>
                {editable && <button type="button" className="link" onClick={() => setScope(proposal.scope.filter((_, i) => i !== index))}>Remove</button>}
              </div>
            ))}
            {editable && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScope([...proposal.scope, { id: crypto.randomUUID(), service: 'New item', description: '', highlight: false }])}>Add scope line</button>}
          </Section>
          <Section title="Terms">
            <div className="tools-fields">
              <NumberField label="Deposit" suffix="%" value={proposal.depositPct} disabled={!editable} onCommit={v => update({ depositPct: v ?? 0 })} />
              <label className="field"><span>Valid through</span><input type="date" disabled={!editable} value={proposal.validThrough} onChange={e => e.target.value && update({ validThrough: e.target.value })} /></label>
              <TextField label="Payment" value={proposal.payment} disabled={!editable} wide onCommit={v => update({ payment: v })} />
            </div>
            {proposal.sections.map(section => (
              <label key={section.id} className="field">
                <span>{section.title}</span>
                <SectionText value={section.body} disabled={!editable} onCommit={body => update({ sections: proposal.sections.map(s => (s.id === section.id ? { ...s, body } : s)) })} />
              </label>
            ))}
            {!config.proposal.wordingApproved && <p className="boundary">Sample wording. The company’s approved warranty and terms replace it in Tools → Settings.</p>}
          </Section>
          <ProposalSheet proposal={proposal} config={config} deposit={deposit} />
        </div>

        <aside className="tools-side">
          <Section title="Review & delivery">
            {editable && proposal.status === 'draft' && <>
              <label className="field"><span>Approver</span>
                <Select value={proposal.approver} onChange={e => update({ approver: e.target.value })}>
                  {eligibleApprovers(people, config, proposal.preparedBy).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </label>
              <button type="button" className="btn btn-primary wide" disabled={stale} onClick={() => void act({ type: 'proposal/submit', id: proposal.id })}>Send for review</button>
            </>}
            {proposal.status === 'in-review' && <>
              <ReferenceTextarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Note" aria-label="Review note" />
              {!approveBlocker && <button type="button" className="btn btn-dark wide" onClick={() => void act({ type: 'proposal/approve', id: proposal.id, note }).then(ok => ok && setNote(''))}>Approve to deliver</button>}
              {approveBlocker && <p className="boundary">{approveBlocker}</p>}
              {(proposal.approver === actor || me?.role === 'manager') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act({ type: 'proposal/return', id: proposal.id, note }).then(ok => ok && setNote(''))}>Return with changes</button>}
            </>}
            <button type="button" className="btn wide" onClick={print}>Export PDF (print)</button>
            <div className="tools-unavailable">
              <span><b>Send to client</b> — not available. Deliver the PDF yourself.</span>
              <span><b>Client approval link</b> — not available. Prepared for later activation; needs approval before any public link exists.</span>
            </div>
            {proposal.status === 'approved' && me?.role === 'manager' && !stale && (
              <form className="tools-decision-form" onSubmit={event => { event.preventDefault(); void act({ type: 'proposal/record-decision', id: proposal.id, ...decision }); }}>
                <p className="section-label">Record the client’s decision</p>
                <p className="muted">Recorded manually from a paper or verbal decision. Task-HQ collects no signatures.</p>
                <div className="segmented">{(['accepted', 'declined'] as const).map(value => <button key={value} type="button" className={decision.outcome === value ? 'is-on' : ''} onClick={() => setDecision({ ...decision, outcome: value })}>{value === 'accepted' ? 'Accepted' : 'Declined'}</button>)}</div>
                <label className="field"><span>Who decided for the client</span><input value={decision.signer} onChange={e => setDecision({ ...decision, signer: e.target.value })} /></label>
                {decision.outcome === 'accepted' && <label className="field"><span>Job handoff to</span>
                  <Select value={decision.handoffTo} onChange={e => setDecision({ ...decision, handoffTo: e.target.value })}><option value="">Choose…</option>{people.filter(p => OPERATIONAL_ROLES.includes(p.role)).map(p => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}</Select>
                </label>}
                <label className="field"><span>Note</span><ReferenceInput value={decision.note} onChange={e => setDecision({ ...decision, note: e.target.value })} /></label>
                <button type="submit" className="btn btn-dark btn-sm">Record decision</button>
              </form>
            )}
            {proposal.decision && <div className="tools-approval"><b>Client {proposal.decision.outcome}</b><span>{proposal.decision.signer} · recorded by {nameIn(people, proposal.decision.recordedBy)} · {when(proposal.decision.at)}</span></div>}
            {!decided && (proposal.preparedBy === actor || me?.role === 'manager') && <button type="button" className="link" onClick={() => void act({ type: 'proposal/withdraw', id: proposal.id, note: '' })}>Withdraw proposal</button>}
          </Section>
          {proposal.versions.length > 0 && (
            <section className="panel tools-section"><header><h3 className="section-label">Approved versions</h3></header>
              <ol className="tools-history">{proposal.versions.map(v => <li key={v.n}><span>Version {v.n} · {nameIn(people, v.by)}{v.note ? ` — “${v.note}”` : ''}</span><small className="muted">{when(v.at)} · #{v.digest}</small></li>)}</ol>
            </section>
          )}
          <LinkedTasks tasks={proposal.tasks} quest={quest} onOpenTask={onOpenTask} />
          <History entries={proposal.history} people={people} />
        </aside>
      </div>
    </article>
  );
}

function SectionText({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <ReferenceTextarea rows={3} value={text} disabled={disabled} onChange={e => setText(e.target.value)} onBlur={() => { if (text !== value) onCommit(text); }} />;
}

/** The printable proposal. Printing hides everything else on the page. */
function ProposalSheet({ proposal, config, deposit }: { proposal: Proposal; config: ToolsConfig; deposit: number }) {
  const p = config.proposal;
  return (
    <section className="proposal-sheet" aria-label="Proposal preview">
      {!p.wordingApproved && <div className="proposal-watermark">Sample wording — not approved contract language</div>}
      <header className="proposal-top">
        <div><h2>{p.companyName}</h2><p>{p.companyDetails}</p></div>
        <div className="proposal-meta"><b>Proposal {proposal.number}</b><span>Issued {proposal.issuedOn}</span><span>Valid through {proposal.validThrough}</span>{proposal.status !== 'approved' && proposal.status !== 'accepted' && <span className="proposal-draft">{PROPOSAL_STATUS_LABELS[proposal.status]} — not approved to deliver</span>}</div>
      </header>
      <div className="proposal-client">
        <div><small>Prepared for</small><b>{proposal.snapshot.customer.name || '—'}</b><span>{proposal.snapshot.address}</span><span>{[proposal.snapshot.customer.phone, proposal.snapshot.customer.email].filter(Boolean).join(' · ')}</span></div>
        <div><small>Project</small><b>{proposal.snapshot.title}</b><span>{proposal.snapshot.trade}</span></div>
      </div>
      <h3>Scope of work</h3>
      <ol className="proposal-scope">{proposal.scope.map(item => <li key={item.id} className={item.highlight ? 'is-highlight' : ''}><b>{item.service}</b>{item.description && <span>{item.description}</span>}</li>)}</ol>
      {proposal.sections.map(section => <div key={section.id} className="proposal-block"><h3>{section.title}</h3><p>{section.body}</p></div>)}
      <div className="proposal-total">
        <div><small>Total investment</small><b>{money(proposal.snapshot.price)}</b></div>
        <div><small>Deposit ({proposal.depositPct}%)</small><b>{money(deposit)}</b></div>
        <p>{proposal.payment}</p>
      </div>
      <footer className="proposal-sign"><span>Client acceptance</span><span>Name</span><span>Date</span></footer>
    </section>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

function ToolSettings({ tools, me, act, onReset }: { tools: ToolsState; me: Person | undefined; act: (a: ToolAction) => Promise<boolean>; onReset: () => void }) {
  const config = tools.config;
  const manager = me?.role === 'manager';
  const d = config.defaults;
  const p = config.proposal;
  return (
    <div className="tools-settings">
      {!manager && <p className="boundary">Only a manager can change these settings.</p>}
      {config.sample && <p className="boundary">These are sample values for the demo, not anyone’s real pricing. A company sets its own.</p>}
      <Section title="Modules">
        <div className="tools-checks">
          {(['takeoff', 'underwriting', 'proposals'] as const).map(key => (
            <label key={key} className="check"><input type="checkbox" disabled={!manager} checked={config.modules[key]} onChange={e => void act({ type: 'config/update', changes: { modules: { ...config.modules, [key]: e.target.checked } } })} /> {key === 'takeoff' ? 'Roof takeoff' : key === 'underwriting' ? 'Underwriting & pricing' : 'Proposals'}</label>
          ))}
        </div>
      </Section>
      <Section title="Approval policy">
        <div className="tools-fields">
          <NumberField label="Review band" suffix="points below target" value={config.reviewBand} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { reviewBand: v ?? 0 } })} hint="Within this many points below target: review. Further below: reprice." />
          <label className="check"><input type="checkbox" disabled={!manager} checked={config.allowSelfApproval} onChange={e => void act({ type: 'config/update', changes: { allowSelfApproval: e.target.checked } })} /> Let the person who prepared a price approve it</label>
        </div>
        <div className="tools-checks">
          <span className="muted">Who approves prices and proposals:</span>
          {OPERATIONAL_ROLES.map(role => (
            <label key={role} className="check"><input type="checkbox" disabled={!manager} checked={config.approverRoles.includes(role)}
              onChange={e => void act({ type: 'config/update', changes: { approverRoles: e.target.checked ? [...config.approverRoles, role] : config.approverRoles.filter(r => r !== role) } })} /> {role[0]!.toUpperCase() + role.slice(1)}</label>
          ))}
        </div>
      </Section>
      <Section title="Margin tiers">
        <div className="tools-tiers">
          {config.tiers.map(tier => (
            <div key={tier.id} className="tools-tier">
              <b>{tier.label}</b><span>{tier.target}% target</span>{tier.needsSignoff && <em className="planned-tag">sign-off</em>}
            </div>
          ))}
        </div>
      </Section>
      <Section title="Defaults for new estimates">
        <div className="tools-fields">
          <NumberField label="Overhead" suffix="%" value={d.overhead} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { defaults: { ...d, overhead: v ?? 0 } } })} />
          <NumberField label="Commission" suffix="%" value={d.commission} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { defaults: { ...d, commission: v ?? 0 } } })} />
          <NumberField label="Contingency" suffix="%" value={d.contingency} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { defaults: { ...d, contingency: v ?? 0 } } })} />
          <NumberField label="Waste" suffix="%" value={d.wastePct} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { defaults: { ...d, wastePct: v ?? 0 } } })} />
          <NumberField label="Tax" suffix="%" value={d.taxPct} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { defaults: { ...d, taxPct: v ?? 0 } } })} />
        </div>
      </Section>
      <Section title="Proposals">
        <div className="tools-fields">
          <TextField label="Company name" value={p.companyName} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { proposal: { ...p, companyName: v } } })} />
          <TextField label="Company details" value={p.companyDetails} disabled={!manager} wide onCommit={v => void act({ type: 'config/update', changes: { proposal: { ...p, companyDetails: v } } })} />
          <TextField label="Number prefix" value={p.numberPrefix} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { proposal: { ...p, numberPrefix: v.toUpperCase() } } })} />
          <NumberField label="Valid for" suffix="days" value={p.validDays} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { proposal: { ...p, validDays: v ?? 1 } } })} />
          <NumberField label="Deposit" suffix="%" value={p.depositPct} disabled={!manager} onCommit={v => void act({ type: 'config/update', changes: { proposal: { ...p, depositPct: v ?? 0 } } })} />
        </div>
        <p className="muted">Templates: {p.templates.map(t => t.label).join(' · ')}. Wording is sample text until the company approves its own.</p>
      </Section>
      <Section title="Line library">
        <div className="tools-library">{config.library.map(line => <div key={line.id}><b>{line.name}</b><span>{line.group} · {line.unit}</span><code>{line.formula || line.typed}</code><span className="num">{money(line.unitCost)}</span></div>)}</div>
      </Section>
      {tools.log.length > 0 && <History entries={tools.log} people={[]} />}
      {manager && <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>Reset sample tools data</button>}
    </div>
  );
}
