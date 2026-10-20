// Signed-in routing for real accounts: pending invitations → workspace → the app.
// The server decides identity, membership and data access; navigation is a client-side affordance.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import App from '../app/App.tsx';
import { LiveContext, ROLE_LABELS } from '../app/LiveContext.tsx';
import type { LiveAccount, OrgRole } from '../app/LiveContext.tsx';
import { createLiveBackend } from '../adapter/live.ts';
import { Glyph } from '../auth/AuthScreen.tsx';
import { PRODUCT } from '../core/workspace.ts';
import { AUTHENTICATED_NAVIGATION, forOrg } from '../core/navigation.ts';
import type { NavigationAccess } from '../core/navigation.ts';
import { PlatformConsole } from './PlatformConsole.tsx';
import './live.css';

export interface MyContext {
  user_id: string;
  email: string;
  email_confirmed: boolean;
  full_name: string | null;
  is_platform_admin: boolean;
  memberships: { org_id: string; slug: string; name: string; preset: string; role: OrgRole; work_role: string }[];
  invitations: { id: string; org_name: string; role: OrgRole; invited_by: string; expires_at: string }[];
  requests: { id: string; org_name: string; status: string; created_at: string }[];
  /** Your place in the waiting room (signed in, no workspace yet). Absent before the waiting-room migration. */
  waiting?: { id: string; since: string; message: string; position: number } | null;
  waiting_declined?: boolean;
}

const ORG_KEY = 'tmhq.org';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string).trim();
const PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string).trim();

export const errorText = (reason: unknown) => {
  const message = typeof reason === 'object' && reason && 'message' in reason ? String((reason as { message: unknown }).message) : String(reason);
  return message.replace(/^.*?:\s(?=[A-Z])/, '') || 'Something went wrong. Try again.';
};

export function LiveRoot({ client, onSignOut, onDemo }: { client: SupabaseClient; onSignOut: () => void; onDemo: () => void }) {
  const [context, setContext] = useState<MyContext | null>(null);
  const navigation = AUTHENTICATED_NAVIGATION;
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState<string | null>(() => { try { return localStorage.getItem(ORG_KEY); } catch { return null; } });
  const [console_, setConsole] = useState(false);
  const [skipInvites, setSkipInvites] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    const { data, error: rpcError } = await client.rpc('my_context');
    if (rpcError || !data) { setError(rpcError ? errorText(rpcError) : 'Could not load your account.'); return; }
    setContext(data as MyContext);
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  const choose = (id: string | null) => {
    try { if (id) localStorage.setItem(ORG_KEY, id); else localStorage.removeItem(ORG_KEY); } catch { /* remembered for this tab only */ }
    setOrgId(id);
    setConsole(false);
  };

  if (error) return <Card title="Couldn’t reach Task-HQ" subtitle={error}><button type="button" className="auth-primary" onClick={() => void refresh()}>Try again</button><button type="button" className="auth-demo" onClick={onSignOut}>Sign out</button></Card>;
  if (!context) return <Card title="Signing you in…" subtitle="Loading your workspaces." />;

  if (context.invitations.length && !skipInvites) {
    return <Invitations client={client} context={context} onAccepted={async org => { await refresh(); choose(org); }} onSkip={() => setSkipInvites(true)} onSignOut={onSignOut} />;
  }

  // A platform admin who is also a member works in that workspace by default; the
  // console is one click away. Platform administration never implies membership.
  const membership = context.memberships.find(item => item.org_id === orgId) ?? (context.memberships.length === 1 ? context.memberships[0] : undefined);
  if (context.is_platform_admin && (console_ || !membership)) {
    return <PlatformConsole client={client} context={context} onOpen={choose} onSignOut={onSignOut} onRefresh={refresh} />;
  }
  if (membership) {
    return <LiveWorkspace key={membership.org_id} client={client} context={context} membership={membership} navigation={navigation} onSignOut={onSignOut}
      onLeave={() => (context.is_platform_admin ? setConsole(true) : choose(null))} canLeave={context.memberships.length > 1 || context.is_platform_admin} onChoose={choose} />;
  }
  if (context.memberships.length > 1) {
    return (
      <Card title="Choose a workspace" subtitle={context.email}>
        {context.memberships.map(item => <button key={item.org_id} type="button" className="auth-primary" onClick={() => choose(item.org_id)}>{item.name} · {ROLE_LABELS[item.role]}</button>)}
        <button type="button" className="auth-demo" onClick={onSignOut}>Sign out</button>
      </Card>
    );
  }
  return <NoWorkspace client={client} context={context} onRefresh={refresh} onSignOut={onSignOut} onDemo={onDemo} />;
}

function LiveWorkspace({ client, context, membership, navigation, onSignOut, onLeave, canLeave, onChoose }: {
  client: SupabaseClient; context: MyContext; membership: MyContext['memberships'][number]; navigation: NavigationAccess; onSignOut: () => void; onLeave: () => void; canLeave: boolean; onChoose: (id: string) => void;
}) {
  const org = useMemo(() => ({ id: membership.org_id, slug: membership.slug, name: membership.name }), [membership.org_id, membership.slug, membership.name]);
  const backend = useMemo(() => createLiveBackend(client, SUPABASE_URL, PUBLISHABLE_KEY, org, context.user_id), [client, org, context.user_id]);
  const account: LiveAccount = useMemo(() => ({
    client, userId: context.user_id, email: context.email, org, role: membership.role, isPlatformAdmin: context.is_platform_admin,
    onSignOut, onLeaveWorkspace: canLeave ? onLeave : () => undefined, canSwitch: canLeave,
    searchOrgs: context.memberships.map(m => ({ id: m.org_id, name: m.name })),
    onOpenWorkspace: (id, hash) => { if (context.memberships.some(m => m.org_id === id)) { history.replaceState(null, '', hash); onChoose(id); } },
    adminOrgs: context.memberships.filter(item => item.role === 'owner' || item.role === 'admin').map(item => ({ id: item.org_id, name: item.name })),
    navigation: forOrg(navigation, membership.org_id),
  }), [client, context, org, membership.role, navigation, onSignOut, onLeave, canLeave, onChoose]);
  useEffect(() => { document.title = `${org.name} — ${PRODUCT.name}`; }, [org.name]);
  return <LiveContext.Provider value={account}><App backend={backend} /></LiveContext.Provider>;
}

function Invitations({ client, context, onAccepted, onSkip, onSignOut }: { client: SupabaseClient; context: MyContext; onAccepted: (org: string) => Promise<void>; onSkip: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const accept = async (id: string) => {
    setBusy(id); setError('');
    const { data, error: rpcError } = await client.rpc('accept_invitation', { p_invitation: id });
    setBusy('');
    if (rpcError) { setError(errorText(rpcError)); return; }
    await onAccepted(data as string);
  };
  // One invitation (the usual case) reads as a single decision: who invited you, as what, one button.
  const only = context.invitations.length === 1 ? context.invitations[0]! : null;
  return (
    <Card title={only ? `Join ${only.org_name}` : 'You’ve been invited'}
      subtitle={only
        ? `${only.invited_by || 'A workspace owner'} invited ${context.email} as ${ROLE_LABELS[only.role]}. Joining adds this account to the workspace.`
        : `Signed in as ${context.email}. Accepting adds this account to the workspace.`}>
      {context.invitations.map(item => (
        <div key={item.id} className="auth-invite">
          {!only && <p><b>{item.org_name}</b> · {ROLE_LABELS[item.role]}<br /><small>From {item.invited_by || 'a workspace owner'} · expires {new Date(item.expires_at).toLocaleDateString()}</small></p>}
          <button type="button" className="auth-primary" autoFocus={!!only} disabled={!!busy} onClick={() => void accept(item.id)}>{busy === item.id ? 'Joining…' : `Join ${item.org_name}`}</button>
          {only && <p><small>Expires {new Date(item.expires_at).toLocaleDateString()}</small></p>}
        </div>
      ))}
      {error && <p className="auth-notice is-error" role="alert">{error}</p>}
      {(context.memberships.length > 0 || context.is_platform_admin) && <button type="button" className="auth-demo" onClick={onSkip}>Not now</button>}
      <button type="button" className="auth-demo" onClick={onSignOut}>Sign out</button>
    </Card>
  );
}

/** Signed in without a workspace: everyone waits in one queue, and the app opens by itself once an Owner or Admin places them. */
function NoWorkspace({ client, context, onRefresh, onSignOut, onDemo }: { client: SupabaseClient; context: MyContext; onRefresh: () => Promise<void>; onSignOut: () => void; onDemo: () => void }) {
  const [note, setNote] = useState(context.waiting?.message ?? '');
  const [workspace, setWorkspace] = useState('');
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const waiting = context.waiting ?? null;
  const declined = !waiting && !!context.waiting_declined;
  const pending = context.requests.filter(item => item.status === 'pending');

  // Join the queue on arrival (never re-adds someone who was declined), then keep checking so the app opens on its own.
  useEffect(() => {
    if (waiting || declined || unsupported) return;
    void client.rpc('join_waiting_room', { p_message: '' }).then(({ error }) => { if (error) setUnsupported(true); else void onRefresh(); });
  }, [client, waiting, declined, unsupported, onRefresh]);
  useEffect(() => { const id = setInterval(() => void onRefresh(), 15_000); return () => clearInterval(id); }, [onRefresh]);

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (declined && !note.trim()) { setNotice({ tone: 'error', text: 'Add a short note so they know who you are.' }); return; }
    setBusy(true);
    const { error } = await client.rpc('join_waiting_room', { p_message: note.trim() });
    setBusy(false);
    setNotice(error ? { tone: 'error', text: errorText(error) } : { tone: 'info', text: declined ? 'You’re back in the waiting room.' : 'Note saved. The person who places you will see it.' });
    if (!error) void onRefresh();
  }
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!workspace.trim()) return;
    setBusy(true);
    const { data, error } = await client.rpc('request_access', { p_workspace: workspace.trim(), p_message: note.trim() });
    setBusy(false);
    setNotice(error ? { tone: 'error', text: errorText(error) } : { tone: 'info', text: String(data) });
    if (!error) { setWorkspace(''); void onRefresh(); }
  }

  // Before the waiting-room migration exists the server can't queue anyone: fall back to asking a workspace by name.
  const title = unsupported ? 'No workspace yet' : declined ? 'Your request wasn’t approved' : waiting ? 'You’re in the waiting room' : 'Joining the waiting room…';
  const subtitle = unsupported
    ? `Signed in as ${context.email}. Ask your workspace by its exact name, and an Owner or Admin will approve you.`
    : declined
    ? `Signed in as ${context.email}. Add a note about who you are and ask again.`
    : `Signed in as ${context.email}. An Owner or Admin will place you in your workspace. This page opens it automatically, so there’s nothing else to do.`;
  return (
    <Card title={title} subtitle={subtitle}>
      {waiting && <p className="auth-notice is-info" role="status">#{waiting.position} in line · since {new Date(waiting.since).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
      {pending.length > 0 && <p className="auth-notice is-info">Also asked: {pending.map(item => item.org_name).join(', ')}.</p>}
      {!unsupported && <form noValidate onSubmit={event => void saveNote(event)} className="auth-inline-form">
        <div className="auth-field"><label htmlFor="msg">Who you are (optional)</label><div className="auth-input"><input id="msg" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="e.g. Shan, developer · or Ralph, field crew" /></div></div>
        <button className="auth-primary" disabled={busy}>{busy ? 'Saving…' : declined ? 'Ask again' : 'Save note'}</button>
      </form>}
      <details className="auth-more" open={unsupported || undefined}>
        <summary>Know your workspace’s exact name?</summary>
        <form noValidate onSubmit={event => void ask(event)} className="auth-inline-form">
          <div className="auth-field"><label htmlFor="ws">Workspace</label><div className="auth-input"><input id="ws" value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="e.g. Quest Roofing" /></div></div>
          <button className="auth-secondary" disabled={busy || !workspace.trim()}>Ask that workspace directly</button>
        </form>
      </details>
      {notice && <p className={`auth-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      <button type="button" className="auth-demo" onClick={() => void onRefresh()}>Check now</button>
      <button type="button" className="auth-demo" onClick={onDemo}>Explore the Task-HQ Demo</button>
      <button type="button" className="auth-demo" onClick={onSignOut}>Sign out</button>
    </Card>
  );
}

export function Card({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="auth-page">
      <main className="auth-card is-single">
        <section className="auth-panel">
          <div className="auth-icon" aria-hidden="true"><Glyph /></div>
          <div className="auth-form-wrap">
            <header className="auth-heading"><h2>{title}</h2><p>{subtitle}</p></header>
            {children}
          </div>
        </section>
      </main>
    </div>
  );
}
