import { Select } from '../ui/Select.tsx';
// People & Access. Live: the organization's real members, requests, activation links and invitations.
// One path for new employees: Add person → roles → Send activation link → they activate → Active.
// Every change is a server RPC that re-checks the caller's role and is audited;
// this screen only renders what the server returns. Demo: the synthetic team,
// clearly labeled, with no production identity or privilege.
import { WorkLabels } from './Relationships.tsx';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { isOpen } from '../core/selectors.ts';
import { errorText } from '../live/LiveRoot.tsx';
import { Avatar } from '../ui/components.tsx';
import type { Quest } from '../ui/useQuest.ts';
import { ROLE_LABELS, useLive } from './LiveContext.tsx';
import type { LiveAccount, OrgRole } from './LiveContext.tsx';
import { PersonForm, PlanWork, invitationMessage } from './StagedTeam.tsx';
import { ORG_ROLES, canManageMember, grantableRoles, isOrgAdmin } from './authority.ts';
import { PRODUCTION_ORIGIN, STATUS_LABEL, activationLink, activationMessage, linkMessage, nextAction, provisionPath } from '../core/people-access.ts';
import type { PersonAccess } from '../core/people-access.ts';
import type { Staged } from './StagedTeam.tsx';

interface Overview {
  members: { user_id: string; email: string; full_name: string | null; role: OrgRole; work_role: string; since: string }[];
  requests: { id: string; email: string; full_name: string | null; message: string; created_at: string }[];
  invitations: { id: string; email: string; role: OrgRole; work_role: string; expires_at: string }[];
}

/** A freshly issued activation link: shown once, never stored on this device. */
interface Issued { id: string; kind: 'link' | 'invite'; name: string; email: string; link: string; code: string; message: string; expiresAt: string }

/** The employee-activation function's error text, when it sent one. */
async function functionError(error: unknown) {
  try { return ((await (error as { context: Response }).context.json()) as { error?: string }).error ?? 'Activation is unavailable. Try again.'; } catch { return 'Activation is unavailable. Try again.'; }
}

const WORK_ROLES = ['manager', 'coordinator', 'field', 'sales', 'estimator'] as const;
export const WORK_LABELS: Record<string, string> = { manager: 'Manager', coordinator: 'Coordinator', field: 'Field', sales: 'Sales', estimator: 'Estimator', reviewer: 'Observer' };
const ORG_ROLE_HELP: Record<OrgRole, string> = {
  owner: 'Full administration, including owners and admins. At least one is required.',
  admin: 'Invites people, approves requests and changes roles below admin.',
  supervisor: 'Operational member; can run attention checks. No member administration.',
  member: 'Operational member. What they can do with work comes from their work role.',
  reviewer: 'Developer / Observer: sees every section read-only and submits bugs and feedback. Never owns or changes work, people, roles or settings — enforced on the server.',
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
  const isAdmin = isOrgAdmin(live.role);
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ email: string; message: string } | null>(null);
  // null = staging isn't available here (migration not applied, or not an admin).
  const [staged, setStaged] = useState<Staged[] | null>(null);
  const [editing, setEditing] = useState<Staged | 'new' | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  // Authoritative per-person status (public.org_people_access); null until loaded or if unavailable.
  const [access, setAccess] = useState<PersonAccess[] | null>(null);
  // Setup messages from the last provisioning run: shown once, never stored on this device.
  const [issued, setIssued] = useState<Issued[]>([]);
  const [confirmAdmin, setConfirmAdmin] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [provisioning, setProvisioning] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmRemoveStaged, setConfirmRemoveStaged] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const [{ data: overview, error }, staging, people] = await Promise.all([
      live.client.rpc('org_admin_overview', { p_org: live.org.id }),
      live.client.rpc('org_staging_overview', { p_org: live.org.id }),
      live.client.rpc('org_people_access', { p_org: live.org.id }),
    ]);
    const fresh = people.error ? null : (people.data as PersonAccess[]);
    setAccess(fresh);
    if (error) setNotice({ tone: 'error', text: errorText(error) }); else setData(overview as Overview);
    // Staging is optional: a database without the staging migration simply shows no staged people.
    setStaged(staging.error ? null : (staging.data as Staged[]));
    return fresh;
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

  // Provisioning: one person → a personal single-use setup link (new account, their own password),
  // or an invitation when their email already has a Task-HQ account (linked, never duplicated).
  // The server re-checks every step; Admin access needs an owner. Codes are shown once, never stored.
  async function provisionOne(person: PersonAccess): Promise<Issued | string> {
    const path = provisionPath(person, live.role) ?? (person.has_account ? 'invite' : 'link');
    if (!person.affiliation_confirmed) {
      const { error } = await live.client.rpc('confirm_staged_affiliation', { p_contact: person.id, p_confirmed: true });
      if (error) return `${person.name}: ${errorText(error)}`;
    }
    if (path === 'invite') {
      const { error } = await live.client.rpc('invite_staged_contact', { p_contact: person.id, p_days: 14 });
      if (error) return `${person.name}: ${errorText(error)}`;
      return { id: person.id, kind: 'invite', name: person.name, email: person.email ?? '', link: PRODUCTION_ORIGIN, code: '', expiresAt: '',
        message: linkMessage(person.name, live.org.name, PRODUCTION_ORIGIN, person.email ?? '') };
    }
    const { data: result, error } = await live.client.functions.invoke('employee-activation', { body: { action: 'generate', org: live.org.id, employee: person.id } });
    if (error || !result?.code) return `${person.name}: ${error ? await functionError(error) : 'No setup link was created.'}`;
    const code = result.code as string, expiresAt = (result.data as { expires_at: string }).expires_at;
    return { id: person.id, kind: 'link', name: person.name, email: person.email ?? '', code, expiresAt,
      link: activationLink(PRODUCTION_ORIGIN, code), message: activationMessage(person.name, live.org.name, PRODUCTION_ORIGIN, code, expiresAt) };
  }
  async function provision(people: PersonAccess[]) {
    setBusy(true); setNotice(null); setIssued([]); setConfirmAdmin(null); setConfirmBulk(false);
    setProvisioning(people.map(person => person.id));
    const done: Issued[] = [], failed: string[] = [];
    for (const person of people) { const result = await provisionOne(person); if (typeof result === 'string') failed.push(result); else done.push(result); }
    setProvisioning([]); setPicked([]); setBusy(false); setIssued(done);
    const links = done.filter(item => item.kind === 'link').length, linked = done.length - links;
    const summary = [links ? `${links} setup link${links === 1 ? '' : 's'} created` : '', linked ? `${linked} existing account${linked === 1 ? '' : 's'} invited to link` : ''].filter(Boolean).join(' · ');
    setNotice(failed.length ? { tone: 'error', text: `${summary ? summary + '. ' : ''}Not provisioned — ${failed.join(' · ')}` }
      : { tone: 'info', text: `${summary}. Copy each message below and send it privately — links are shown only once. Nothing was sent.` });
    await load();
  }
  async function revokeLink(person: PersonAccess) {
    setBusy(true); setNotice(null); setIssued([]);
    const { error } = await live.client.functions.invoke('employee-activation', { body: { action: 'revoke', org: live.org.id, employee: person.id } });
    setBusy(false);
    setNotice(error ? { tone: 'error', text: await functionError(error) } : { tone: 'info', text: `${person.name}’s setup link no longer works.` });
    await load();
  }
  function act(person: PersonAccess, action: 'send' | 'revoke-link' | 'revoke-invite') {
    if (action === 'send') {
      if (person.role === 'admin' && confirmAdmin !== person.id) { setConfirmAdmin(person.id); return; }
      void provision([person]);
    } else if (action === 'revoke-link') void revokeLink(person);
    else if (person.invitation) void run(() => live.client.rpc('revoke_invitation', { p_invitation: person.invitation!.id }), `${person.name}’s invitation revoked.`);
  }

  const openWork = (id: string) => state.tasks.filter(task => isOpen(task) && task.owner === id).length;
  const me = state.people.find(item => item.id === live.userId);
  const assignable = (orgRole: OrgRole, work: string) => orgRole !== 'reviewer' && work !== 'reviewer';
  const grantable = grantableRoles(live.role);

  // Members everyone can see (names and roles come from the server-built roster); emails only for admins.
  const accessOf = (id: string) => access?.find(item => item.id === id);
  // Membership wins: a person is active as soon as they have one, whatever else is still open.
  const pending = (staged ?? []).filter(item => (accessOf(item.id)?.status ?? (item.state === 'active' ? 'active' : 'ready')) !== 'active');
  const activeWithPlans = (staged ?? []).filter(item => item.state === 'active' && item.planned.length > 0);
  const statusOf = (id: string) => accessOf(id)?.status;
  const counts = { active: data?.members.length ?? 0, notInvited: pending.filter(item => ['ready', 'needs-email', 'link-expired', 'link-invalid', 'invite-expired'].includes(statusOf(item.id) ?? 'ready')).length, invited: pending.filter(item => ['link-sent', 'invited'].includes(statusOf(item.id) ?? '')).length };
  const stagedEmails = new Set((staged ?? []).map(item => item.email).filter(Boolean));
  // Bulk provisioning: everyone selectable is eligible right now for this caller.
  const eligible = pending.map(item => accessOf(item.id)).filter((person): person is PersonAccess => !!person && !!provisionPath(person, live.role));
  const chosen = eligible.filter(person => picked.includes(person.id));
  const chosenAdmins = chosen.filter(person => person.role === 'admin');
  const planningPerson = (staged ?? []).find(item => item.id === planning) ?? null;
  const stagedName = (id: string | null) => (staged ?? []).find(item => item.id === id)?.full_name;
  const memberName = (id: string | null) => (data?.members ?? []).find(item => item.user_id === id);
  const inviteMessage = (email: string, role: OrgRole, work: string) => invitationMessage(live.org.name, email, role, work);
  const rows = data?.members ?? state.people.map(item => ({ user_id: item.id, email: '', full_name: item.name, role: (Object.keys(ROLE_LABELS) as OrgRole[]).find(role => ROLE_LABELS[role] === item.title) ?? 'member', work_role: item.role, since: '' }));

  return (
    <div className="view people-view">
      <header className="view-head">
        <div>
          <p className="eyebrow">{live.org.name} · team</p>
          <h1>People & Access</h1>
          <p className="lede">{isAdmin && staged
            ? <span className="team-counts"><b>{counts.active}</b> active · <b>{counts.invited}</b> setup pending · <b>{counts.notInvited}</b> not provisioned or expired{data?.requests.length ? <> · <b>{data.requests.length}</b> waiting for approval</> : null}</span>
            : <>{rows.length} {rows.length === 1 ? 'member' : 'members'}{data ? ` · ${data.invitations.length} open invitation${data.invitations.length === 1 ? '' : 's'} · ${data.requests.length} waiting for approval` : ''}. Roles are enforced on the server for every change.</>}</p>
        </div>
        {isAdmin && (
          <div className="head-actions">
            <button type="button" className="btn btn-primary" disabled={!staged} onClick={() => setEditing('new')}
              title={staged ? 'Add someone, choose their roles, then provision their access.' : 'Needs the team-staging database update (pending approval).'}>+ Add person</button>
          </div>
        )}
      </header>
      {isAdmin && !staged && <p className="boundary">Adding people before inviting them needs the team-staging database update, which hasn’t been applied here yet. Everything else on this page works.</p>}

      {notice && <p className={`console-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {issued.length > 0 && (
        <section className="prepared issued-link" aria-labelledby="issued-title">
          <p id="issued-title"><b>Setup messages ({issued.length})</b> · each link is personal, works once and expires in 24 hours. Task-HQ doesn’t email anyone — send each one privately yourself. They won’t be shown again.</p>
          {issued.map(item => (
            <div key={item.id} className="issued-item">
              <p><b>{item.name}</b>{item.email ? ` · ${item.email}` : ''} · {item.kind === 'link' ? `setup link, expires ${new Date(item.expiresAt).toLocaleString()}` : 'existing account — sign in and join'}</p>
              <textarea readOnly rows={3} value={item.message} onFocus={event => event.currentTarget.select()} aria-label={`Setup message for ${item.name}`} />
              <span className="people-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void navigator.clipboard?.writeText(item.message)}>Copy setup message</button>
                {item.kind === 'link' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(item.link)}>Copy link only</button>}
              </span>
            </div>
          ))}
          <span className="people-actions">
            {issued.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(issued.map(item => `To ${item.name}${item.email ? ` <${item.email}>` : ''}:\n${item.message}`).join('\n\n'))}>Copy all messages</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIssued([])}>Done</button>
          </span>
        </section>
      )}

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
          <div className="people-row is-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Organization role</span><span role="columnheader">Permission profile</span><span role="columnheader">Status</span><span role="columnheader">Assignment</span><span role="columnheader">Open work</span><span role="columnheader"><span className="sr-only">Actions</span></span></div>
          {rows.map(item => {
            const self = item.user_id === live.userId;
            const canEdit = canManageMember(live.role, item.role, self);
            return (
              <div key={item.user_id} className="people-row" role="row">
                <span role="cell" className="person-cell"><Avatar state={state} id={item.user_id} size="md" /><span><b>{item.full_name || item.email || 'Member'}{self && ' (you)'}</b>{item.email && <small>{item.email}</small>}<small>Reports to: not configured</small></span></span>
                <span role="cell">{canEdit
                  ? <Select aria-label={`Organization role for ${item.email}`} value={item.role} disabled={busy} onChange={event => { const next = event.target.value as OrgRole; void run(() => live.client.rpc('set_member_role', { p_org: live.org.id, p_user: item.user_id, p_role: next, p_work_role: keepWork(item.work_role, next) }), `${item.email} is now ${ROLE_LABELS[next]}.`); }}>
                      {grantable.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                    </Select>
                  : <span className={`role-chip role-${item.role}`}>{ROLE_LABELS[item.role]}</span>}</span>
                <span role="cell">{canEdit && item.role !== 'reviewer'
                  ? <Select aria-label={`Work role for ${item.email}`} value={item.work_role} disabled={busy} onChange={event => void run(() => live.client.rpc('set_member_role', { p_org: live.org.id, p_user: item.user_id, p_role: item.role, p_work_role: event.target.value }), `${item.email} now works as ${WORK_LABELS[event.target.value]}.`)}>
                      {WORK_ROLES.map(role => <option key={role} value={role}>{WORK_LABELS[role]}</option>)}
                    </Select>
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
            const person = accessOf(item.id);
            const next = person ? nextAction(person, live.role) : null;
            const label = provisioning.includes(item.id) ? 'Provisioning…' : person ? STATUS_LABEL[person.status] : 'Loading…';
            const tone = person?.status === 'link-sent' || person?.status === 'invited' ? 'invited' : person?.status === 'link-invalid' || person?.status === 'link-expired' || person?.status === 'invite-expired' ? 'expired' : 'not-invited';
            return (
              <div key={item.id} className="people-row is-staged" role="row">
                <span role="cell" className="person-cell">
                  <label className="pick" title={person && provisionPath(person, live.role) ? 'Select to provision' : person?.role === 'admin' && live.role !== 'owner' ? 'Only an owner can provision Admin access' : 'Nothing to provision right now'}>
                    <input type="checkbox" disabled={!person || !provisionPath(person, live.role) || busy} checked={picked.includes(item.id)} aria-label={`Select ${item.full_name} to provision`}
                      onChange={event => setPicked(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
                  </label>
                  <span className="avatar avatar-md avatar-empty" aria-hidden="true">{item.full_name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                  <span><b>{item.full_name}</b><small>{[item.title, item.email ?? 'no email yet', item.phone].filter(Boolean).join(' · ')}</small><small>Reports to: {reportsTo ?? 'not set'}</small></span></span>
                <span role="cell"><span className={`role-chip role-${item.provisional_role}`} title="Applied when they activate.">{ROLE_LABELS[item.provisional_role]}</span></span>
                <span role="cell"><span className="role-chip" title="Applied when they activate.">{WORK_LABELS[item.provisional_work_role] ?? item.provisional_work_role}</span></span>
                <span role="cell"><span className={`status-chip is-${tone}`}>{label}</span>{next?.detail && <small className="muted access-detail">{next.detail}</small>}</span>
                <span role="cell">Not assignable until active</span>
                <span role="cell" className="num"><button type="button" className="link" onClick={() => setPlanning(item.id)} title="Planned — not assigned">{item.planned.length ? `${item.planned.length} planned` : 'Plan work'}</button></span>
                <span role="cell" className="people-actions">
                  {confirmRemoveStaged === item.id
                    ? <><button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setConfirmRemoveStaged(null); void run(() => live.client.rpc('remove_staged_contact', { p_contact: item.id }), `${item.full_name} removed from the directory.`); }}>Remove</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemoveStaged(null)}>Keep</button></>
                    : person && confirmAdmin === item.id
                    ? <span className="admin-confirm" role="group" aria-label={`Confirm Admin access for ${item.full_name}`}>
                        <small>Joins as <b>Admin</b>: can invite people and change roles below Admin.</small>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(person, 'send')}>Send Admin link</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAdmin(null)}>Cancel</button>
                      </span>
                    : <>
                      {person && next && (next.primary === 'send-link' || next.primary === 'new-link' || next.primary === 'link-account') && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(person, 'send')}>{next.label}</button>}
                      {next?.primary === 'owner-only' && <small className="muted" title="Admin access can only be granted by an owner.">Owner sends Admin links</small>}
                      {next?.primary === 'add-email' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setEditing(item)}>Add email</button>}
                      {person && next?.secondary.includes('revoke-link') && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(person, 'revoke-link')}>Revoke link</button>}
                      {person && next?.secondary.includes('revoke-invite') && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(person, 'revoke-invite')}>Revoke invitation</button>}
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(item)} title={person?.status === 'link-sent' ? 'Saving changes cancels the open activation link' : undefined}>Edit</button>
                      {person?.status !== 'invited' && person?.status !== 'link-sent' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Remove ${item.full_name}`} onClick={() => setConfirmRemoveStaged(item.id)}>Remove…</button>}
                    </>}
                </span>
              </div>
            );
          })}
        </div>
        {isAdmin && staged && eligible.length > 0 && (
          <div className="select-bar">
            <button type="button" className="link" disabled={busy} onClick={() => setPicked(chosen.length === eligible.length ? [] : eligible.map(person => person.id))}>{chosen.length === eligible.length ? 'Clear selection' : `Select all ready (${eligible.length})`}</button>
            {confirmBulk && chosenAdmins.length
              ? <span className="admin-confirm" role="group" aria-label="Confirm Admin access">
                  <small>Grants <b>Admin</b> to {chosenAdmins.map(person => person.name).join(', ')}: they can invite people and change roles below Admin.</small>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void provision(chosen)}>Provision {chosen.length}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmBulk(false)}>Cancel</button>
                </span>
              : <>
                  <span className="muted">Each person gets a personal setup link (24 h) and chooses their own password. Existing accounts are linked, not duplicated.</span>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!chosen.length || busy} onClick={() => (chosenAdmins.length ? setConfirmBulk(true) : void provision(chosen))}>{busy && provisioning.length ? 'Provisioning…' : `Provision ${chosen.length || ''} selected`}</button>
                </>}
          </div>
        )}
        {activeWithPlans.length > 0 && (
          <div className="ready-plans">
            <h4 className="section-label">Planned work ready to assign</h4>
            <ul className="people-list">{activeWithPlans.map(item => <li key={item.id}><span><b>{item.full_name}</b><small>now active · {item.planned.length} planned</small></span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanning(item.id)}>Review & assign…</button></li>)}</ul>
          </div>
        )}
        {pending.some(item => item.planned.length) && (
          <details className="staged-plans">
            <summary>Planned work by person ({pending.reduce((sum, item) => sum + item.planned.length, 0)}) <em className="planned-tag">Planned — not assigned</em></summary>
            <ul className="people-list">{pending.filter(item => item.planned.length).map(item => (
              <li key={item.id}><span><b>{item.full_name}</b><small>{item.planned.map(plan => `${plan.title}${plan.due ? ` (${plan.due})` : ''}`).join(' · ')}</small></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanning(item.id)}>Edit plan</button></li>
            ))}</ul>
            <p className="muted">Planned — not assigned. Tasks can be owned only by active members, so these become real tasks only when you assign them after the person accepts.</p>
          </details>
        )}
        {pending.length > 0 && <p className="muted">Staged people are visible only to owners and admins. They have no account, membership or access until they accept an invitation; provisional roles and reporting lines grant nothing.</p>}
        {!isAdmin && <p className="muted">You’re a {ROLE_LABELS[live.role]} of {live.org.name}. Owners and admins manage who has access and see email addresses.</p>}
        <p className="muted">{staged ? 'Reporting lines are planning data for staged people. ' : 'Reporting lines and temporary deactivation aren’t configured in this workspace yet. '}Removing access deletes the membership (history stays); the person can be invited again.</p>
      </section>

      {isAdmin && data && (
        <section className="panel" aria-labelledby="invite-title">
          <h3 id="invite-title" className="section-label">Invite an existing Task-HQ account</h3>
          <p className="muted">For someone who already signs in to Task-HQ. New employees get an activation link from the directory above instead.</p>
          {data.invitations.some(item => !stagedEmails.has(item.email)) && (
            <ul className="people-list">{data.invitations.filter(item => !stagedEmails.has(item.email)).map(item => (
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

      <WorkLabels quest={quest} />
      <RoleLegend />

      {editing && <PersonForm live={live} person={editing === 'new' ? null : editing} staged={staged ?? []} members={(data?.members ?? []).map(item => ({ user_id: item.user_id, email: item.email, full_name: item.full_name }))}
        onClose={() => setEditing(null)} onSaved={(message, again) => { setNotice({ tone: 'info', text: message }); void load(); if (!again) setEditing(null); }}
        onProvision={async (id, message) => { setEditing(null); setNotice({ tone: 'info', text: message }); const fresh = await load(); const person = fresh?.find(item => item.id === id); if (person) await provision([person]); }} />}
      {planningPerson && <PlanWork quest={quest} live={live} person={planningPerson} onClose={() => setPlanning(null)} onChanged={message => { setNotice({ tone: 'info', text: message }); void load(); }} />}
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
        <Select aria-label="Organization role" value={role} onChange={event => { const next = event.target.value as OrgRole; setRole(next); setWork(defaultWork(next) === 'reviewer' ? 'reviewer' : work === 'reviewer' ? defaultWork(next) : work); }}>{grantable.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</Select>
        <Select aria-label="Work role" value={work} disabled={role === 'reviewer'} onChange={event => setWork(event.target.value)}>{(role === 'reviewer' ? ['reviewer'] : WORK_ROLES).map(value => <option key={value} value={value}>{WORK_LABELS[value]}</option>)}</Select>
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
      <label className="field"><span>Organization role</span><Select value={role} onChange={event => { const next = event.target.value as OrgRole; setRole(next); setWork(keepWork(work, next)); }}>{grantable.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</Select></label>
      <label className="field"><span>Work role</span><Select value={role === 'reviewer' ? 'reviewer' : work} disabled={role === 'reviewer'} onChange={event => setWork(event.target.value)}>{(role === 'reviewer' ? ['reviewer'] : WORK_ROLES).map(value => <option key={value} value={value}>{WORK_LABELS[value]}</option>)}</Select></label>
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
          <div className="people-row is-head" role="row"><span role="columnheader">Person</span><span role="columnheader">Permission profile</span><span role="columnheader">Assignment</span><span role="columnheader">Open work</span><span role="columnheader"><span className="sr-only">Actions</span></span></div>
          {state.people.map(item => (
            <div key={item.id} className="people-row" role="row">
              <span role="cell" className="person-cell"><Avatar state={state} id={item.id} size="md" /><span><b>{item.name}{item.id === actor && ' (you, in the demo)'}</b><small>{state.workLabels?.[item.id] ?? item.title}</small></span></span>
              <span role="cell"><span className="role-chip">{WORK_LABELS[item.role] ?? item.role}</span></span>
              <span role="cell">{item.role === 'reviewer' ? 'Feedback only' : 'Can own work'}</span>
              <span role="cell" className="num">{openWork(item.id)}</span>
              <span role="cell" className="people-actions">{item.id !== actor && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActor(item.id)}>Work as {item.name.split(' ')[0]}</button>}</span>
            </div>
          ))}
        </div>
      </section>
      <WorkLabels quest={quest} />
      <RoleLegend />
    </div>
  );
}
