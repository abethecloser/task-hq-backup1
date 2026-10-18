// People & Roles. Live: the organization's real members, requests and invitations.
// Every change is a server RPC that re-checks the caller's role and is audited;
// this screen only renders what the server returns. Demo: the synthetic team,
// clearly labeled, with no production identity or privilege.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { isOpen } from '../core/selectors.ts';
import { errorText } from '../live/LiveRoot.tsx';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
import type { LiveAccount, OrgRole } from './LiveContext.tsx';

interface Overview {
  members: { user_id: string; email: string; full_name: string | null; role: OrgRole; work_role: string; since: string }[];
  requests: { id: string; email: string; full_name: string | null; message: string; created_at: string }[];
  invitations: { id: string; email: string; role: OrgRole; work_role: string; expires_at: string }[];
}

/** A person staged before being invited (org_staging_overview). Planning data, not access. */
interface Staged {
  id: string; key: string; full_name: string; email: string | null; phone: string | null; title: string | null;
  provisional_role: OrgRole; provisional_work_role: string; reports_to_contact: string | null; reports_to_user: string | null;
  affiliation_confirmed: boolean; state: 'not-invited' | 'invited' | 'expired' | 'active';
  invitation: { id: string; expires_at: string } | null;
  planned: { id: string; title: string; next_action: string; due: string | null; priority: string }[];
}
const STAGED_STATE: Record<Staged['state'], string> = { 'not-invited': 'Not invited', invited: 'Invited', expired: 'Invitation expired', active: 'Active' };

const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'supervisor', 'member', 'reviewer'];
const WORK_ROLES = ['manager', 'coordinator', 'field', 'sales', 'estimator'] as const;
export const WORK_LABELS: Record<string, string> = { manager: 'Manager', coordinator: 'Coordinator', field: 'Field', sales: 'Sales', estimator: 'Estimator', reviewer: 'Reviewer' };
const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Full administration, including owners and admins. At least one is required.',
  admin: 'Invites people, approves requests and changes roles below admin.',
  supervisor: 'Operational member; can run attention checks. No member administration.',
  member: 'Operational member. What they can do with work comes from their work role.',
  reviewer: 'Views and leaves feedback. Never owns or changes operational work.',
};
const WORK_ROLE_HELP: Record<string, string> = {
  manager: 'Approves, decides access, delegates, activates Ultra Priority.',
  coordinator: 'Resolves blockers, hands off and assigns work.',
  field: 'Owns and executes assigned work.',
  sales: 'Owns leads and customer follow-up.',
  estimator: 'Owns inspections and estimates.',
};
const defaultWork = (role: OrgRole) => (role === 'owner' || role === 'admin' ? 'manager' : role === 'supervisor' ? 'coordinator' : role === 'reviewer' ? 'reviewer' : 'field');
/** Changing administration never silently changes someone's work authority. */
const keepWork = (current: string, next: OrgRole) => (next === 'reviewer' ? 'reviewer' : current === 'reviewer' ? defaultWork(next) : current);

export function People({ quest }: { quest: Quest }) {
  const live = useLive();
  return live ? <LivePeople quest={quest} live={live} /> : <DemoPeople quest={quest} />;
}

function RoleLegend() {
  return (
    <details className="panel role-legend">
      <summary>How roles work: organization role vs. work role</summary>
      <div className="legend-cols">
        <div><h4>Organization role · administration</h4><dl>{ORG_ROLES.map(role => <div key={role}><dt>{ROLE_LABELS[role]}</dt><dd>{ORG_ROLE_HELP[role]}</dd></div>)}</dl></div>
        <div><h4>Work role · authority over tasks</h4><dl>{WORK_ROLES.map(role => <div key={role}><dt>{WORK_LABELS[role]}</dt><dd>{WORK_ROLE_HELP[role]}</dd></div>)}</dl></div>
      </div>
      <p className="muted">Owning the organization doesn’t make someone the owner of every task: work is delegated to the person who does it. Platform administration of Task-HQ is separate again and grants no access to an organization’s work.</p>
    </details>
  );
}

function LivePeople({ quest, live }: { quest: Quest; live: LiveAccount }) {
  const { state } = quest;
  const isAdmin = live.role === 'owner' || live.role === 'admin';
  const isOwner = live.role === 'owner';
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ email: string; message: string } | null>(null);
  // null = staging isn't available here (migration not applied, or not an admin).
  const [staged, setStaged] = useState<Staged[] | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [{ data: overview, error }, staging] = await Promise.all([
      live.client.rpc('org_admin_overview', { p_org: live.org.id }),
      live.client.rpc('org_staging_overview', { p_org: live.org.id }),
    ]);
    if (error) setNotice({ tone: 'error', text: errorText(error) }); else setData(overview as Overview);
    // Staging is optional: a database without the staging migration simply shows no staged people.
    setStaged(staging.error ? null : (staging.data as Staged[]));
  }, [isAdmin, live.client, live.org.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => PromiseLike<{ error: unknown }>, success: string) {
    setBusy(true); setNotice(null);
    const { error } = await work();
    setBusy(false);
    setNotice(error ? { tone: 'error', text: errorText(error) } : { tone: 'info', text: success });
    await load();
    return !error;
  }

  const openWork = (id: string) => state.tasks.filter(task => isOpen(task) && task.owner === id).length;
  const me = state.people.find(item => item.id === live.userId);
  const assignable = (orgRole: OrgRole, work: string) => orgRole !== 'reviewer' && work !== 'reviewer';
  const grantable = ORG_ROLES.filter(role => isOwner || (role !== 'owner' && role !== 'admin'));

  // Members everyone can see (names and roles come from the server-built roster); emails only for admins.
  const pending = (staged ?? []).filter(item => item.state !== 'active');
  const stagedName = (id: string | null) => (staged ?? []).find(item => item.id === id)?.full_name;
  const memberName = (id: string | null) => (data?.members ?? []).find(item => item.user_id === id);
  const inviteMessage = (email: string, role: OrgRole, work: string) => `You’ve been invited to ${live.org.name} on Task-HQ as ${ROLE_LABELS[role]} (${WORK_LABELS[work]}). Sign in or create an account at ${location.origin} with ${email}, confirm your email, then accept the invitation. It expires in 14 days.`;
  const rows = data?.members ?? state.people.map(item => ({ user_id: item.id, email: '', full_name: item.name, role: (Object.keys(ROLE_LABELS) as OrgRole[]).find(role => ROLE_LABELS[role] === item.title) ?? 'member', work_role: item.role, since: '' }));

  return (
    <div className="view people-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">{live.org.name} · team</p>
          <h1>People & Roles</h1>
          <p className="lede">{rows.length} {rows.length === 1 ? 'member' : 'members'}{pending.length ? ` · ${pending.length} staged, not yet active` : ''}{data ? ` · ${data.invitations.length} open invitation${data.invitations.length === 1 ? '' : 's'} · ${data.requests.length} waiting for approval` : ''}. Roles are enforced on the server for every change.</p>
        </div>
      </header>

      {notice && <p className={`console-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      <ProfileCard live={live} workRole={me?.role ?? ''} />

      {isAdmin && data && data.requests.length > 0 && (
        <section className="panel" aria-labelledby="requests-title">
          <h3 id="requests-title" className="section-label">Waiting for approval <span>{data.requests.length}</span></h3>
          <p className="muted">These accounts asked to join {live.org.name}. Nothing changes until you approve. Approving adds them with the roles you choose.</p>
          <ul className="people-list">{data.requests.map(item => <RequestRow key={item.id} item={item} grantable={grantable} busy={busy} onDecide={(approve, role, work) => void run(() => live.client.rpc('decide_access_request', { p_request: item.id, p_approve: approve, p_role: role, p_work_role: work }), approve ? `${item.email} added as ${ROLE_LABELS[role]} · ${WORK_LABELS[work]}.` : `Request from ${item.email} declined.`)} />)}</ul>
        </section>
      )}

      <section className="panel" aria-labelledby="directory-title">
        <h3 id="directory-title" className="section-label">Directory</h3>
        <div className="people-table" role="table" aria-label="Members">
          <div className="people-row is-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Organization role</span><span role="columnheader">Work role</span><span role="columnheader">Status</span><span role="columnheader">Assignment</span><span role="columnheader">Open work</span><span role="columnheader"><span className="sr-only">Actions</span></span></div>
          {rows.map(item => {
            const self = item.user_id === live.userId;
            const canEdit = isAdmin && !self && (isOwner || (item.role !== 'owner' && item.role !== 'admin'));
            return (
              <div key={item.user_id} className="people-row" role="row">
                <span role="cell" className="person-cell"><Avatar state={state} id={item.user_id} size="md" /><span><b>{item.full_name || item.email || 'Member'}{self && ' (you)'}</b>{item.email && <small>{item.email}</small>}<small>Reports to: not configured</small></span></span>
                <span role="cell">{canEdit
                  ? <select aria-label={`Organization role for ${item.email}`} value={item.role} disabled={busy} onChange={event => { const next = event.target.value as OrgRole; void run(() => live.client.rpc('set_member_role', { p_org: live.org.id, p_user: item.user_id, p_role: next, p_work_role: keepWork(item.work_role, next) }), `${item.email} is now ${ROLE_LABELS[next]}.`); }}>
                      {grantable.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                    </select>
                  : <span className={`role-chip role-${item.role}`}>{ROLE_LABELS[item.role]}</span>}</span>
                <span role="cell">{canEdit && item.role !== 'reviewer'
                  ? <select aria-label={`Work role for ${item.email}`} value={item.work_role} disabled={busy} onChange={event => void run(() => live.client.rpc('set_member_role', { p_org: live.org.id, p_user: item.user_id, p_role: item.role, p_work_role: event.target.value }), `${item.email} now works as ${WORK_LABELS[event.target.value]}.`)}>
                      {WORK_ROLES.map(role => <option key={role} value={role}>{WORK_LABELS[role]}</option>)}
                    </select>
                  : <span className="role-chip">{WORK_LABELS[item.work_role] ?? item.work_role}</span>}</span>
                <span role="cell"><span className="status-chip is-active">Active</span>{item.since && <small className="muted"> since {new Date(item.since).toLocaleDateString()}</small>}</span>
                <span role="cell">{assignable(item.role, item.work_role) ? 'Can own work' : 'Feedback only'}</span>
                <span role="cell" className="num">{openWork(item.user_id)}</span>
                <span role="cell" className="people-actions">{canEdit && (confirmRemove === item.user_id
                  ? <><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setConfirmRemove(null); void run(() => live.client.rpc('remove_member', { p_org: live.org.id, p_user: item.user_id }), `${item.email} no longer has access. Their past work and history stay.`); }}>Remove access</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(null)}>Keep</button></>
                  : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmRemove(item.user_id)}>Remove…</button>)}</span>
              </div>
            );
          })}
          {pending.map(item => {
            const reportsTo = stagedName(item.reports_to_contact) ?? (() => { const m = memberName(item.reports_to_user); return m ? m.full_name || m.email : undefined; })();
            return (
              <div key={item.id} className="people-row is-staged" role="row">
                <span role="cell" className="person-cell"><span className="avatar avatar-md avatar-empty" aria-hidden="true">{item.full_name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                  <span><b>{item.full_name}</b><small>{[item.title, item.email ?? 'no email yet', item.phone].filter(Boolean).join(' · ')}</small><small>Reports to: {reportsTo ?? 'not set'} (planned)</small></span></span>
                <span role="cell"><span className="role-chip is-provisional" title="Provisional: used to pre-fill the invitation. Grants nothing.">{ROLE_LABELS[item.provisional_role]} · planned</span></span>
                <span role="cell"><span className="role-chip is-provisional" title="Provisional: grants nothing until the person accepts an invitation.">{WORK_LABELS[item.provisional_work_role] ?? item.provisional_work_role} · planned</span></span>
                <span role="cell"><span className={`status-chip is-${item.state}`}>{STAGED_STATE[item.state]}</span>{!item.affiliation_confirmed && <small className="muted"> · affiliation unconfirmed</small>}</span>
                <span role="cell">Not assignable until active</span>
                <span role="cell" className="num" title="Planned work, kept apart from real tasks">{item.planned.length ? `${item.planned.length} planned` : '—'}</span>
                <span role="cell" className="people-actions">
                  {item.state === 'not-invited' || item.state === 'expired'
                    ? !item.affiliation_confirmed
                      ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy} title={`Confirm ${item.full_name} works for ${live.org.name}`} onClick={() => void run(() => live.client.rpc('confirm_staged_affiliation', { p_contact: item.id, p_confirmed: true }), `${item.full_name} confirmed as part of ${live.org.name}. Nothing was sent.`)}>Confirm affiliation</button>
                      : item.email
                        ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await run(() => live.client.rpc('invite_staged_contact', { p_contact: item.id, p_days: 14 }), `Invitation for ${item.email} recorded. Nothing was sent.`)) setPrepared({ email: item.email!, message: inviteMessage(item.email!, item.provisional_role, item.provisional_work_role) }); }}>Prepare invitation</button>
                        : <small className="muted">Add an email to invite</small>
                    : item.invitation && <small className="muted">expires {new Date(item.invitation.expires_at).toLocaleDateString()}</small>}
                </span>
              </div>
            );
          })}
        </div>
        {pending.some(item => item.planned.length) && (
          <details className="staged-plans">
            <summary>Planned work for staged people ({pending.reduce((sum, item) => sum + item.planned.length, 0)})</summary>
            <ul className="people-list">{pending.flatMap(item => item.planned.map(plan => (
              <li key={plan.id}><span><b>{plan.title}</b><small>For {item.full_name}{plan.due ? ` · due ${plan.due}` : ''}{plan.priority === 'high' ? ' · high' : ''}{plan.next_action ? ` · next: ${plan.next_action}` : ''}</small></span></li>
            )))}</ul>
            <p className="muted">Planned only. Tasks can be owned only by active members, so these become real tasks after the person accepts.</p>
          </details>
        )}
        {pending.length > 0 && <p className="muted">Staged people are visible only to owners and admins. They have no account, membership or access until they accept an invitation; provisional roles and reporting lines grant nothing.</p>}
        {!isAdmin && <p className="muted">You’re a {ROLE_LABELS[live.role]} of {live.org.name}. Owners and admins manage who has access and see email addresses.</p>}
        <p className="muted">{staged ? 'Reporting lines are planning data for staged people. ' : 'Reporting lines and temporary deactivation aren’t configured in this workspace yet. '}Removing access deletes the membership (history stays); the person can be invited again.</p>
      </section>

      {isAdmin && data && (
        <section className="panel" aria-labelledby="invite-title">
          <h3 id="invite-title" className="section-label">Invitations</h3>
          {data.invitations.length > 0 && (
            <ul className="people-list">{data.invitations.map(item => (
              <li key={item.id}><span><b>{item.email}</b><small>{ROLE_LABELS[item.role]} · {WORK_LABELS[item.work_role] ?? item.work_role} · pending · expires {new Date(item.expires_at).toLocaleDateString()}</small></span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => live.client.rpc('revoke_invitation', { p_invitation: item.id }), `Invitation for ${item.email} revoked.`)}>Revoke</button></li>
            ))}</ul>
          )}
          <InviteForm grantable={grantable} busy={busy} onInvite={async (email, role, work) => {
            const ok = await run(() => live.client.rpc('create_invitation', { p_org: live.org.id, p_email: email, p_role: role, p_work_role: work, p_days: 14 }), `Invitation for ${email} recorded. Nothing was sent.`);
            if (ok) setPrepared({ email, message: inviteMessage(email, role, work) });
            return ok;
          }} />
          {prepared && (
            <div className="prepared" role="status">
              <p><b>Ready for you to send.</b> Task-HQ doesn’t email anyone. Copy this to {prepared.email} yourself:</p>
              <textarea readOnly rows={3} value={prepared.message} onFocus={event => event.currentTarget.select()} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(prepared.message); }}>Copy message</button>
            </div>
          )}
          <p className="muted">Only the account with that confirmed address can accept. Owner and admin invitations require an owner.</p>
        </section>
      )}

      <RoleLegend />
    </div>
  );
}

function ProfileCard({ live, workRole }: { live: LiveAccount; workRole: string }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void live.client.from('profiles').select('full_name').eq('id', live.userId).maybeSingle().then(({ data }) => {
      const value = (data as { full_name: string | null } | null)?.full_name ?? '';
      setName(value); setSaved(value); setLoaded(true);
    });
  }, [live.client, live.userId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    const { error } = await live.client.from('profiles').update({ full_name: value || null }).eq('id', live.userId);
    if (error) { setNotice(errorText(error)); return; }
    setSaved(value);
    setNotice('Saved. Teammates see your name the next time the workspace saves or reloads.');
  }
  return (
    <section className="panel profile-card" aria-labelledby="me-title">
      <h3 id="me-title" className="section-label">You</h3>
      <div className="profile-grid">
        <form className="console-inline" onSubmit={event => void save(event)}>
          <label className="field"><span>Display name</span><input value={name} disabled={!loaded} maxLength={120} placeholder={live.email} onChange={event => setName(event.target.value)} /></label>
          <button className="btn btn-primary btn-sm" disabled={!loaded || name.trim() === saved}>Save name</button>
        </form>
        <dl className="profile-facts">
          <div><dt>Email</dt><dd>{live.email}</dd></div>
          <div><dt>Organization role</dt><dd>{ROLE_LABELS[live.role]}</dd></div>
          <div><dt>Work role</dt><dd>{WORK_LABELS[workRole] ?? (workRole || '—')}</dd></div>
          {live.isPlatformAdmin && <div><dt>Platform</dt><dd>Platform administrator (separate). In {live.org.name} you act only with the roles above.</dd></div>}
        </dl>
      </div>
      {notice && <p className="muted" role="status">{notice}</p>}
    </section>
  );
}

function RequestRow({ item, grantable, busy, onDecide }: { item: Overview['requests'][number]; grantable: OrgRole[]; busy: boolean; onDecide: (approve: boolean, role: OrgRole, work: string) => void }) {
  const [role, setRole] = useState<OrgRole>('member');
  const [work, setWork] = useState('field');
  return (
    <li>
      <span><b>{item.full_name || item.email}</b><small>{item.email} · asked {new Date(item.created_at).toLocaleDateString()}</small>{item.message && <small>“{item.message}”</small>}</span>
      <span className="people-actions">
        <select aria-label="Organization role" value={role} onChange={event => { const next = event.target.value as OrgRole; setRole(next); setWork(defaultWork(next) === 'reviewer' ? 'reviewer' : work === 'reviewer' ? defaultWork(next) : work); }}>{grantable.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select>
        <select aria-label="Work role" value={work} disabled={role === 'reviewer'} onChange={event => setWork(event.target.value)}>{(role === 'reviewer' ? ['reviewer'] : WORK_ROLES).map(value => <option key={value} value={value}>{WORK_LABELS[value]}</option>)}</select>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecide(true, role, role === 'reviewer' ? 'reviewer' : work)}>Approve</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onDecide(false, role, work)}>Decline</button>
      </span>
    </li>
  );
}

function InviteForm({ grantable, busy, onInvite }: { grantable: OrgRole[]; busy: boolean; onInvite: (email: string, role: OrgRole, work: string) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [work, setWork] = useState('field');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onInvite(email.trim().toLowerCase(), role, role === 'reviewer' ? 'reviewer' : work)) setEmail('');
  }
  return (
    <form className="invite-form" onSubmit={event => void submit(event)}>
      <label className="field"><span>Email</span><input type="email" required placeholder="name@company.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label className="field"><span>Organization role</span><select value={role} onChange={event => { const next = event.target.value as OrgRole; setRole(next); setWork(keepWork(work, next)); }}>{grantable.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select></label>
      <label className="field"><span>Work role</span><select value={role === 'reviewer' ? 'reviewer' : work} disabled={role === 'reviewer'} onChange={event => setWork(event.target.value)}>{(role === 'reviewer' ? ['reviewer'] : WORK_ROLES).map(value => <option key={value} value={value}>{WORK_LABELS[value]}</option>)}</select></label>
      <button className="btn btn-primary" disabled={busy || !email.trim()}>Prepare invitation</button>
    </form>
  );
}

function DemoPeople({ quest }: { quest: Quest }) {
  const { state, actor, setActor } = quest;
  const openWork = (id: string) => state.tasks.filter(task => isOpen(task) && task.owner === id).length;
  return (
    <div className="view people-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Task-HQ Demo · synthetic team</p>
          <h1>People & Roles</h1>
          <p className="lede">A complete fictional team so you can experience the whole organization before real employees are onboarded. Nobody here can sign in, and nothing here touches the live workspace.</p>
        </div>
      </header>
      <p className="boundary">Synthetic people only. They have no accounts, emails or production privileges. Use “Work as” to see Task-HQ from each role.</p>
      <section className="panel">
        <div className="people-table is-demo" role="table" aria-label="Synthetic team">
          <div className="people-row is-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Work role</span><span role="columnheader">Assignment</span><span role="columnheader">Open work</span><span role="columnheader"><span className="sr-only">Actions</span></span></div>
          {state.people.map(item => (
            <div key={item.id} className="people-row" role="row">
              <span role="cell" className="person-cell"><Avatar state={state} id={item.id} size="md" /><span><b>{item.name}{item.id === actor && ' (you, in the demo)'}</b><small>{item.title}</small></span></span>
              <span role="cell"><span className="role-chip">{WORK_LABELS[item.role] ?? item.role}</span></span>
              <span role="cell">{item.role === 'reviewer' ? 'Feedback only' : 'Can own work'}</span>
              <span role="cell" className="num">{openWork(item.id)}</span>
              <span role="cell" className="people-actions">{item.id !== actor && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActor(item.id)}>Work as {item.name.split(' ')[0]}</button>}</span>
            </div>
          ))}
        </div>
      </section>
      <RoleLegend />
    </div>
  );
}
