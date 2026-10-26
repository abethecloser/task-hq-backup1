import { Select } from '../ui/Select.tsx';
// People & Access — staging tools for owners/admins: add or edit a person (directory
// only), plan their work, and review invitations. Every write is a server function that
// re-checks the caller's role; nothing here creates an account, a membership or an
// invitation except the explicit "Prepare invitations" step, and nothing sends email.
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { localDate } from '../core/time.ts';
import { errorText } from '../live/LiveRoot.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { ROLE_LABELS } from './LiveContext.tsx';
import { plannedRolesFor } from './authority.ts';
import type { LiveAccount, OrgRole } from './LiveContext.tsx';

export interface Staged {
  id: string; key: string; full_name: string; email: string | null; phone: string | null; title: string | null; notes: string;
  provisional_role: OrgRole; provisional_work_role: string; reports_to_contact: string | null; reports_to_user: string | null;
  affiliation_confirmed: boolean; state: 'not-invited' | 'invited' | 'expired' | 'active'; member_user_id: string | null;
  invitation: { id: string; expires_at: string } | null;
  planned: { id: string; title: string; next_action: string; due: string | null; priority: 'normal' | 'high'; notes: string }[];
}
export interface ActiveMember { user_id: string; email: string; full_name: string | null }

const WORK = ['manager', 'coordinator', 'field', 'sales', 'estimator'] as const;
const WORK_LABEL: Record<string, string> = { manager: 'Manager', coordinator: 'Coordinator', field: 'Field', sales: 'Sales', estimator: 'Estimator', reviewer: 'Observer' };
/** Sentinel for a company that has no Task-HQ organization yet. Never saved anywhere. */
const NOT_SET_UP = '__not-set-up__';

export const invitationMessage = (org: string, email: string, role: OrgRole, work: string) =>
  `You’ve been invited to ${org} on Task-HQ as ${ROLE_LABELS[role]} (${WORK_LABEL[work] ?? work}). Sign in or create an account at ${location.origin} with ${email}, confirm your email, then accept the invitation. It expires in 14 days.`;

/** Add or edit a person in the directory. "Save person" never invites, notifies or grants access;
 * "Save & provision" saves, then hands the person to People & Access provisioning (setup link, or
 * account linking when their email already has a Task-HQ account). Nothing is sent. */
export function PersonForm({ live, person, staged, members, onClose, onSaved, onProvision }: {
  live: LiveAccount; person: Staged | null; staged: Staged[]; members: ActiveMember[];
  onClose: () => void; onSaved: (message: string, again: boolean) => void;
  /** Called after Save & provision with the saved person's id; the page provisions them. */
  onProvision: (id: string, message: string) => void;
}) {
  const [org, setOrg] = useState(live.org.id);
  const [name, setName] = useState(person?.full_name ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [title, setTitle] = useState(person?.title ?? '');
  const [role, setRole] = useState<OrgRole>(person?.provisional_role ?? 'member');
  const [work, setWork] = useState(person?.provisional_work_role ?? 'field');
  const [reportsTo, setReportsTo] = useState(person?.reports_to_contact ? `c:${person.reports_to_contact}` : person?.reports_to_user ? `u:${person.reports_to_user}` : '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const plannedRoles = plannedRolesFor(live.role);
  const otherOrg = org !== live.org.id && org !== NOT_SET_UP;

  // Save & send activation link applies to people who aren't active yet, and needs an email.
  const invitable = !person || person.state !== 'active';

  async function save(mode: 'save' | 'again' | 'invite') {
    setError('');
    if (org === NOT_SET_UP) { setError('This company isn’t set up in Task-HQ yet. Nothing was saved.'); return; }
    if (!name.trim()) { setError('Enter the person’s name.'); return; }
    if (mode === 'invite' && !email.trim()) { setError('Add their email to provision access.'); return; }
    setBusy(true);
    const workRole = role === 'reviewer' ? 'reviewer' : work;
    const { data: id, error: rpcError } = await live.client.rpc('save_staged_contact', {
      p_org: org, p_contact: person?.id ?? null, p_full_name: name, p_email: email, p_phone: phone, p_title: title,
      p_role: role, p_work_role: workRole,
      p_reports_to_contact: !otherOrg && reportsTo.startsWith('c:') ? reportsTo.slice(2) : null,
      p_reports_to_user: !otherOrg && reportsTo.startsWith('u:') ? reportsTo.slice(2) : null, p_notes: notes,
    });
    if (rpcError) { setBusy(false); setError(errorText(rpcError)); return; }
    const where = live.adminOrgs.find(item => item.id === org)?.name ?? live.org.name;
    if (mode === 'invite') {
      setBusy(false);
      const contact = (id as string | null) ?? person?.id ?? null;
      if (!contact) { onSaved(`${name.trim()} was saved to ${where}. Provision them from their row.`, false); return; }
      onProvision(contact, `${name.trim()} saved. Provisioning…`);
      return;
    }
    setBusy(false);
    onSaved(person ? `${name.trim()} updated. Still not invited.` : `${name.trim()} added to ${where} as Not invited. No account, access or email.`, mode === 'again');
    if (mode === 'again') { setName(''); setEmail(''); setPhone(''); setTitle(''); setNotes(''); setReportsTo(''); nameInput.current?.focus(); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save('save'); }

  return (
    <>
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal person-modal" role="dialog" aria-modal="true" aria-labelledby="person-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header className="modal-head"><div><span className="kicker">DIRECTORY ONLY · NO ACCESS</span><h2 id="person-title">{person ? `Edit ${person.full_name}` : 'Add person'}</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <form className="form" onSubmit={submit}>
          <div className="form-grid">
            <label className="field"><span>Full name</span><input ref={nameInput} autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="As they’re known at work" /></label>
            <label className="field"><span>Email</span><small className="field-hint">Needed later to invite. Optional now.</small><input type="email" maxLength={200} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" /></label>
            <label className="field"><span>Phone</span><input maxLength={40} value={phone} onChange={event => setPhone(event.target.value)} placeholder="Optional" /></label>
            <label className="field"><span>Title</span><input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Crew Lead" /></label>
            <label className="field"><span>Organization</span>
              <Select value={org} disabled={!!person} onChange={event => { setOrg(event.target.value); setReportsTo(''); }}>
                {(live.adminOrgs.length ? live.adminOrgs : [{ id: live.org.id, name: live.org.name }]).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                <option value={NOT_SET_UP}>Another company — not set up in Task-HQ yet</option>
              </Select>
              {org === NOT_SET_UP && <small className="field-hint is-warn">Their company needs its own organization first (ask the platform admin). People are never placed in {live.org.name} instead.</small>}
              {otherOrg && <small className="field-hint">Saved to that organization’s directory. Switch workspace to see it there.</small>}
            </label>
            <label className="field"><span>Reports to <em className="planned-tag">Planned</em></span>
              <Select value={reportsTo} disabled={otherOrg || org === NOT_SET_UP} onChange={event => setReportsTo(event.target.value)}>
                <option value="">Nobody yet</option>
                <optgroup label="Active members">{members.map(item => <option key={item.user_id} value={`u:${item.user_id}`}>{item.full_name || item.email}</option>)}</optgroup>
                <optgroup label="Not invited yet">{staged.filter(item => item.id !== person?.id && item.state !== 'active').map(item => <option key={item.id} value={`c:${item.id}`}>{item.full_name}</option>)}</optgroup>
              </Select>
            </label>
            <label className="field"><span>Organization role <em className="planned-tag">Planned</em></span>
              <Select value={role} onChange={event => setRole(event.target.value as OrgRole)}>{plannedRoles.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</Select>
            </label>
            <label className="field"><span>Work role <em className="planned-tag">Planned</em></span>
              <Select value={role === 'reviewer' ? 'reviewer' : work} disabled={role === 'reviewer'} onChange={event => setWork(event.target.value)}>
                {(role === 'reviewer' ? ['reviewer'] : WORK).map(value => <option key={value} value={value}>{WORK_LABEL[value]}</option>)}
              </Select>
            </label>
          </div>
          <label className="field"><span>Responsibilities / notes</span><textarea rows={2} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="What they’ll own, crews, territories…" /></label>
          <p className="boundary">{invitable
            ? <>{person ? 'Saving changes cancels any activation link already sent. ' : ''}<b>Save & invite</b> adds them and creates a personal setup link and QR code (works once, 7 days). They confirm their email with a six-digit code and join as {ROLE_LABELS[role]}; an existing Task-HQ account is linked, not duplicated. Nothing is sent — you share it. <b>Save person</b> only adds them to the directory.</>
            : 'Planned roles grant nothing. Saving changes the directory only — no account, no access, no email.'}</p>
          {error && <p className="auth-notice is-error form-error" role="alert">{error}</p>}
          <footer className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
            {!person && <button type="button" className="btn btn-ghost" disabled={busy || org === NOT_SET_UP} onClick={() => void save('again')}>Save & add another</button>}
            {/* Editing keeps Save changes primary: people waiting on an activation code (no account yet) shouldn't be nudged into an invitation. */}
            <button className={`btn ${person ? 'btn-primary' : 'btn-ghost'}`} disabled={busy || org === NOT_SET_UP}>{busy ? 'Saving…' : person ? 'Save changes' : 'Save person'}</button>
            {invitable && <button type="button" className={`btn ${person ? 'btn-ghost' : 'btn-primary'}`} disabled={busy || org === NOT_SET_UP || !email.trim()} title={email.trim() ? undefined : 'Add their email: it’s the address they’ll confirm'} onClick={() => void save('invite')}>{busy ? 'Working…' : 'Save & invite'}</button>}
          </footer>
        </form>
      </section>
    </>
  );
}

/** Planned work for one person. Planned — not assigned, until they're active and you convert it. */
export function PlanWork({ quest, live, person, onClose, onChanged }: { quest: Quest; live: LiveAccount; person: Staged; onClose: () => void; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState<Staged['planned'][number] | null>(null);
  const [title, setTitle] = useState('');
  const [next, setNext] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState<string | null>(null);
  const active = person.state === 'active' && !!person.member_user_id && quest.state.people.some(item => item.id === person.member_user_id);

  const reset = () => { setEditing(null); setTitle(''); setNext(''); setDue(''); setPriority('normal'); setNotes(''); };
  const edit = (plan: Staged['planned'][number]) => { setEditing(plan); setTitle(plan.title); setNext(plan.next_action); setDue(plan.due ?? ''); setPriority(plan.priority); setNotes(plan.notes); };
  async function call(name: string, args: Record<string, unknown>, success: string) {
    setBusy(true); setError('');
    const { error: rpcError } = await live.client.rpc(name, args);
    setBusy(false);
    if (rpcError) { setError(errorText(rpcError)); return false; }
    onChanged(success); return true;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await call('save_staged_assignment', { p_contact: person.id, p_assignment: editing?.id ?? null, p_title: title, p_next_action: next, p_due: due || null, p_priority: priority, p_notes: notes },
      `${editing ? 'Updated' : 'Planned'} “${title.trim()}” for ${person.full_name}. Not assigned.`)) reset();
  }
  // Conversion: the real task goes through the normal task engine (server-checked), then the plan is marked converted.
  async function convert(plan: Staged['planned'][number]) {
    setConfirmConvert(null);
    const result = await quest.dispatch({ type: 'task/create', task: { title: plan.title, nextAction: plan.next_action, due: plan.due ?? '', priority: plan.priority, description: plan.notes, owner: person.member_user_id! } });
    if (!result.ok) return;
    const task = result.state.tasks.find(item => item.title === plan.title.trim() && item.owner === person.member_user_id);
    if (task) await call('mark_staged_assignment_converted', { p_assignment: plan.id, p_task_id: task.id }, `“${plan.title}” is now a real task for ${person.full_name}.`);
  }

  return (
    <>
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header className="modal-head"><div><span className="kicker">{active ? 'ACTIVE — READY TO ASSIGN' : 'PLANNED — NOT ASSIGNED'}</span><h2 id="plan-title">Work for {person.full_name}</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="form">
          {person.planned.length === 0 ? <p className="muted">Nothing planned yet.</p> : (
            <ul className="people-list plan-list">{person.planned.map(plan => (
              <li key={plan.id}>
                <span><b>{plan.title}</b><small>{[plan.due ? `due ${plan.due}` : '', plan.priority === 'high' ? 'high priority' : '', plan.next_action ? `next: ${plan.next_action}` : ''].filter(Boolean).join(' · ') || 'No details yet'}</small>
                  <em className="planned-tag">{active ? 'Ready to assign' : 'Planned — not assigned'}</em></span>
                <span className="people-actions">
                  {active && (confirmConvert === plan.id
                    ? <><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void convert(plan)}>Create task for {person.full_name.split(' ')[0]}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmConvert(null)}>Cancel</button></>
                    : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmConvert(plan.id)}>Assign as task…</button>)}
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => edit(plan)}>Edit</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void call('remove_staged_assignment', { p_assignment: plan.id }, `Removed “${plan.title}”.`)}>Remove</button>
                </span>
              </li>
            ))}</ul>
          )}
          <form className="plan-form" onSubmit={event => void save(event)}>
            <h4 className="section-label">{editing ? `Edit “${editing.title}”` : 'Plan work'}</h4>
            <div className="form-grid">
              <label className="field"><span>What</span><input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Own the Monday safety briefing" /></label>
              <label className="field"><span>First step</span><input maxLength={200} value={next} onChange={event => setNext(event.target.value)} placeholder="Optional" /></label>
              <label className="field"><span>Target date</span><input type="date" min={localDate(quest.now)} value={due} onChange={event => setDue(event.target.value)} /></label>
              <label className="field"><span>Priority</span><Select value={priority} onChange={event => setPriority(event.target.value as 'normal' | 'high')}><option value="normal">Normal</option><option value="high">High</option></Select></label>
            </div>
            <label className="field"><span>Notes</span><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            {error && <p className="auth-notice is-error form-error" role="alert">{error}</p>}
            <footer className="form-actions">
              {editing && <button type="button" className="btn btn-ghost" onClick={reset}>Cancel edit</button>}
              <button className="btn btn-primary" disabled={busy || !title.trim()}>{editing ? 'Save plan' : 'Add to plan'}</button>
            </footer>
          </form>
          <p className="boundary">{active ? 'Assigning creates a real task through Task-HQ’s normal rules, one at a time, only when you click it.' : 'Planned work isn’t a task: it’s not in anyone’s My Work, owner pickers or notifications. It can become a task after this person accepts an invitation.'}</p>
        </div>
      </section>
    </>
  );
}

/** Review exactly who will be invited, then prepare (record) the invitations. Sends nothing. */
export function InviteReview({ live, people, onClose, onPrepared }: { live: LiveAccount; people: Staged[]; onClose: () => void; onPrepared: (messages: string) => void }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true); setError('');
    const { error: rpcError } = await live.client.rpc('invite_staged_contacts', { p_contacts: people.map(item => item.id), p_days: 14 });
    setBusy(false);
    if (rpcError) { setError(`${errorText(rpcError)} Nothing was prepared.`); return; }
    onPrepared(people.map(item => `To ${item.email}:\n${invitationMessage(live.org.name, item.email!, item.provisional_role, item.provisional_work_role)}`).join('\n\n'));
  }
  return (
    <>
      <button className="scrim scrim-modal" aria-label="Close" onClick={onClose} />
      <section className="modal invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-review-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
        <header className="modal-head"><div><span className="kicker">REVIEW BEFORE ANYTHING HAPPENS</span><h2 id="invite-review-title">Prepare {people.length} invitation{people.length === 1 ? '' : 's'}</h2></div><button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="form">
          <div className="people-table invite-table" role="table" aria-label="People to invite">
            <div className="people-row is-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Email</span><span role="columnheader">Organization</span><span role="columnheader">Will join as</span></div>
            {people.map(item => (
              <div key={item.id} className="people-row" role="row">
                <span role="cell"><b>{item.full_name}</b>{item.title && <small className="muted"> · {item.title}</small>}</span>
                <span role="cell">{item.email}</span>
                <span role="cell">{live.org.name}</span>
                <span role="cell">{ROLE_LABELS[item.provisional_role]} · {WORK_LABEL[item.provisional_work_role] ?? item.provisional_work_role}</span>
              </div>
            ))}
          </div>
          <label className="check-row confirm-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I’ve checked these emails, organizations and roles.</label>
          <ul className="truth-list">
            <li><b>Prepare</b> records an invitation for each person (14 days). Each person gets access only after they sign in with that exact email and accept.</li>
            <li><b>Nothing is sent.</b> Task-HQ has no email delivery set up. You’ll get the messages to send yourself.</li>
            <li>All or nothing: if any person can’t be invited, none are.</li>
          </ul>
          {error && <p className="auth-notice is-error form-error" role="alert">{error}</p>}
          <footer className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-ghost" disabled title="Email delivery isn’t set up in Task-HQ. Use Prepare, then send the messages yourself.">Send invitations · not available</button>
            <button type="button" className="btn btn-primary" disabled={!checked || busy} onClick={() => void prepare()}>{busy ? 'Preparing…' : `Prepare ${people.length} invitation${people.length === 1 ? '' : 's'}`}</button>
          </footer>
        </div>
      </section>
    </>
  );
}
