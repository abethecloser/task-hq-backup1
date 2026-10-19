import { Select } from '../ui/Select.tsx';
// Platform Super Admin console. Platform admins manage Task-HQ itself: they can list
// and create organizations and invite first owners, but see no tenant data unless an
// owner grants time-limited support access. All calls are audited on the server.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ROLE_LABELS } from '../app/LiveContext.tsx';
import { PRODUCT } from '../core/workspace.ts';
import { errorText } from './LiveRoot.tsx';
import type { MyContext } from './LiveRoot.tsx';

interface OrgSummary {
  id: string; slug: string; name: string; preset: string; created_at: string; members: number; owners: number;
  open_owner_invitations: { id: string; email: string; expires_at: string }[] | null; support_access_until: string | null;
}

export function PlatformConsole({ client, context, onOpen, onSignOut, onRefresh }: { client: SupabaseClient; context: MyContext; onOpen: (orgId: string) => void; onSignOut: () => void; onRefresh?: () => Promise<void> }) {
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [preset, setPreset] = useState('general');
  const [ownerFor, setOwnerFor] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [accessNote, setAccessNote] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await client.rpc('platform_list_organizations');
    if (error) { setNotice({ tone: 'error', text: errorText(error) }); return; }
    setOrgs(data as OrgSummary[]);
  }, [client]);
  useEffect(() => { void load(); document.title = `Platform — ${PRODUCT.name}`; }, [load]);

  async function run(work: () => PromiseLike<{ error: unknown }>, success: string) {
    setBusy(true); setNotice(null);
    const { error } = await work();
    setBusy(false);
    if (error) { setNotice({ tone: 'error', text: errorText(error) }); return false; }
    setNotice({ tone: 'info', text: success });
    await load();
    return true;
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await run(() => client.rpc('platform_create_organization', { p_slug: slug, p_name: name, p_preset: preset }), `${name.trim()} created. Invite its first owner next.`)) { setName(''); setSlug(''); }
  }
  async function inviteOwner(event: FormEvent, org: OrgSummary) {
    event.preventDefault();
    if (await run(() => client.rpc('platform_invite_owner', { p_org: org.id, p_email: ownerEmail, p_days: 14 }), `Owner invitation for ${ownerEmail.trim()} recorded. Task-HQ doesn’t send email: ask them to sign in at ${location.origin} with that address.`)) { setOwnerFor(null); setOwnerEmail(''); }
  }

  return (
    <div className="console-page">
      <header className="console-head">
        <div><p className="eyebrow">{PRODUCT.name} · Platform</p><h1>Organizations</h1><p className="lede">Signed in as {context.email} · Platform Super Admin. You administer Task-HQ, not customer work: task data stays private to each organization unless its owner grants support access.</p></div>
        <button type="button" className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
      </header>
      {notice && <p className={`console-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      {context.memberships.length > 0 && (
        <section className="panel">
          <h3>Your own workspaces</h3>
          <ul className="console-list">{context.memberships.map(item => <li key={item.org_id}><span><b>{item.name}</b> · {ROLE_LABELS[item.role]}</span><button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen(item.org_id)}>Open</button></li>)}</ul>
        </section>
      )}
      {orgs && orgs.some(org => !context.memberships.some(item => item.org_id === org.id)) && (
        <section className="panel">
          <h3>Operational access</h3>
          <p className="muted">Platform administration doesn’t include anyone’s task data. To work inside an organization, its owner must approve a membership and choose your organization role and work role. Your platform role stays separate.</p>
          <ul className="console-list">
            {orgs.filter(org => !context.memberships.some(item => item.org_id === org.id)).map(org => {
              const pending = context.requests.find(item => item.org_name === org.name && item.status === 'pending');
              return (
                <li key={org.id}>
                  <span><b>{org.name}</b><br /><small>{pending ? `Request pending since ${new Date(pending.created_at).toLocaleDateString()} · waiting for an owner or admin of ${org.name} to approve in People & Roles.` : 'Not a member. Requires approval from an owner or admin of this organization.'}</small></span>
                  {!pending && (org.owners > 0
                    ? <form className="console-inline" onSubmit={event => { event.preventDefault(); void run(() => client.rpc('request_access', { p_workspace: org.slug, p_message: accessNote.trim() || 'Platform admin requesting operational membership. Please choose my roles.' }), `Request sent to ${org.name}. Nothing is granted until an owner or admin approves it.`).then(ok => { if (ok) { setAccessNote(''); void onRefresh?.(); } }); }}>
                        <input value={accessNote} maxLength={500} placeholder="Note for the owner (optional)" onChange={event => setAccessNote(event.target.value)} aria-label={`Note for ${org.name} owner`} />
                        <button className="btn btn-primary btn-sm" disabled={busy}>Request operational access</button>
                      </form>
                    : <small className="muted">No owner yet: the first owner must accept their invitation before anyone can be approved.</small>)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="panel">
        <h3>All organizations</h3>
        {!orgs ? <p className="muted">Loading…</p> : orgs.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="console-list">
            {orgs.map(org => (
              <li key={org.id}>
                <span>
                  <b>{org.name}</b> <small className="muted">/{org.slug} · {org.preset}</small><br />
                  <small>{org.members} member{org.members === 1 ? '' : 's'} · {org.owners ? `${org.owners} owner${org.owners === 1 ? '' : 's'}` : 'no owner yet'}
                    {org.open_owner_invitations?.length ? ` · owner invitation open for ${org.open_owner_invitations.map(item => item.email).join(', ')} (expires ${new Date(org.open_owner_invitations[0].expires_at).toLocaleDateString()})` : ''}
                    {org.support_access_until ? ` · support access until ${new Date(org.support_access_until).toLocaleString()}` : ''}</small>
                </span>
                {ownerFor === org.id
                  ? <form className="console-inline" onSubmit={event => void inviteOwner(event, org)}><input type="email" required placeholder="owner@company.com" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} aria-label="Owner email" /><button className="btn btn-primary btn-sm" disabled={busy}>Invite owner</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOwnerFor(null)}>Cancel</button></form>
                  : !org.owners && !org.open_owner_invitations?.length && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOwnerFor(org.id)}>Invite first owner…</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h3>New organization</h3>
        <form className="console-form" onSubmit={event => void create(event)}>
          <label>Name<input required minLength={2} maxLength={80} value={name} onChange={event => { setName(event.target.value); setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)); }} /></label>
          <label>Address<input required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={slug} onChange={event => setSlug(event.target.value)} /></label>
          <label>Preset<Select value={preset} onChange={event => setPreset(event.target.value)}><option value="general">General</option><option value="roofing">Roofing</option></Select></label>
          <button className="btn btn-primary" disabled={busy}>Create organization</button>
        </form>
      </section>
    </div>
  );
}
