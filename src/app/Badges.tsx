// Badges & check-ins (People & Access, Owners and Admins). Issue a person's QR badge; confirm their
// check-ins, check-outs and new phones with one tap. The server enforces every rule (badge_issue,
// badge_revoke, org_badges, decide_check_in); a badge code is shown once and never stored.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { qrSvg } from '../ui/qr.ts';
import type { LiveAccount, OrgRole } from './LiveContext.tsx';
import { PRODUCTION_ORIGIN } from '../core/people-access.ts';
import { badgeHash, badgeLink, newBadgeCode } from '../auth/badge.ts';

interface Member { user_id: string; email: string; full_name: string | null; role: OrgRole }
interface CheckIn { id: string; user_id: string; email: string; full_name: string | null; kind: 'in' | 'out' | 'device'; at: string; status: 'pending' | 'confirmed' | 'rejected'; note: string }
// Issuance stays closed until badge-check-in v2 (no sign-in credentials) is deployed and
// verified in production. Revoking and confirming check-ins remain available.
const BADGE_ISSUANCE_OPEN = false;

interface BadgeRow { user_id: string; issued_at: string; phone_linked: boolean; last_used_at: string | null }
interface Issued { name: string; link: string; display: string; svg: string }

const KIND: Record<CheckIn['kind'], string> = { in: 'Checked in', out: 'Checked out', device: 'New phone' };
const time = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const errorText = (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'Something went wrong. Try again.');

export function Badges({ live, members }: { live: LiveAccount; members: Member[] }) {
  const [badges, setBadges] = useState<BadgeRow[] | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await live.client.rpc('org_badges', { p_org: live.org.id });
    if (error) { setUnavailable(true); return; }
    const value = data as { badges: BadgeRow[]; check_ins: CheckIn[] };
    setBadges(value.badges); setCheckIns(value.check_ins);
  }, [live.client, live.org.id]);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => PromiseLike<{ error: unknown }>, success: string) {
    setBusy(true); setNotice(null);
    const { error } = await work();
    setBusy(false);
    setNotice(error ? { tone: 'error', text: errorText(error) } : { tone: 'info', text: success });
    await load();
    return !error;
  }

  async function issue(member: Member) {
    const { code, display } = newBadgeCode();
    const ok = await run(async () => live.client.rpc('badge_issue', { p_org: live.org.id, p_user: member.user_id, p_hash: await badgeHash(code) }), `Badge ready for ${member.full_name || member.email}.`);
    if (!ok) return;
    const link = badgeLink(PRODUCTION_ORIGIN, code);
    setIssued({ name: member.full_name || member.email, link, display, svg: qrSvg(link) });
  }

  const pending = checkIns.filter(item => item.status === 'pending');
  const recent = checkIns.filter(item => item.status !== 'pending').slice(0, 12);
  const badgeOf = useMemo(() => new Map((badges ?? []).map(item => [item.user_id, item])), [badges]);
  const eligible = members.filter(member => member.role !== 'owner' && member.role !== 'admin');
  if (unavailable) return null; // Before the badge migration exists there is nothing to show.

  return (
    <section className="panel badges" aria-labelledby="badges-title">
      <h3 id="badges-title" className="section-label">Badges & check-ins {pending.length > 0 && <span>{pending.length}</span>}</h3>
      <p className="muted">Each person scans their own QR badge with their own phone to check in or out. Their first phone becomes the badge’s phone; a scan from any other phone waits for your approval. Owner and Admin accounts keep their password. A badge is for check-in only; it never signs anyone in.</p>
      {!BADGE_ISSUANCE_OPEN && <p className="boundary">New badges are paused until the badge security update is verified. You can still switch badges off and confirm check-ins.</p>}

      {pending.length > 0 && (
        <div className="badge-pending">
          <div className="badge-pending-head"><b>Waiting for you</b>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(async () => {
              for (const item of pending) { const { error } = await live.client.rpc('decide_check_in', { p_id: item.id, p_confirm: true }); if (error) return { error }; }
              return { error: null };
            }, `${pending.length} confirmed.`)}>Confirm all</button>
          </div>
          <ul className="people-list">{pending.map(item => (
            <li key={item.id}>
              <span><b>{item.full_name || item.email}</b><small>{KIND[item.kind]} · {time(item.at)}{item.note ? ` · ${item.note}` : ''}</small></span>
              <span className="people-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(() => live.client.rpc('decide_check_in', { p_id: item.id, p_confirm: true }), item.kind === 'device' ? 'New phone approved.' : 'Confirmed.')}>{item.kind === 'device' ? 'Approve phone' : 'Confirm'}</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => live.client.rpc('decide_check_in', { p_id: item.id, p_confirm: false }), 'Rejected.')}>Reject</button>
              </span>
            </li>
          ))}</ul>
        </div>
      )}

      {issued && (
        <div className="badge-issued" role="status">
          <div className="badge-qr" aria-label={`QR badge for ${issued.name}`} dangerouslySetInnerHTML={{ __html: issued.svg }} />
          <div className="badge-issued-text">
            <b>{issued.name}’s badge</b>
            <small>Print this QR, or send the link privately. Shown once; if it’s lost, issue a new one and the old one stops working.</small>
            <code>{issued.display}</code>
            <span className="people-actions">
              <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(issued.link).then(() => setNotice({ tone: 'info', text: 'Badge link copied.' }), () => setNotice({ tone: 'error', text: 'Copy didn’t work. Select the code above instead.' })); }}>Copy badge link</button>
              <button type="button" className="btn btn-sm" onClick={() => window.print()}>Print</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>Done</button>
            </span>
          </div>
        </div>
      )}

      {notice && <p className={`notice ${notice.tone === 'error' ? 'is-error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      <ul className="people-list">{eligible.map(member => {
        const badge = badgeOf.get(member.user_id);
        return (
          <li key={member.user_id}>
            <span><b>{member.full_name || member.email}</b>
              <small>{badge ? `Badge active · ${badge.phone_linked ? 'phone linked' : 'not scanned yet'}${badge.last_used_at ? ` · last scan ${time(badge.last_used_at)}` : ''}` : 'No badge'}</small></span>
            <span className="people-actions">
              <button type="button" className="btn btn-sm" disabled={busy || !BADGE_ISSUANCE_OPEN} title={BADGE_ISSUANCE_OPEN ? undefined : 'Paused until the badge security update is verified'} onClick={() => void issue(member)}>{badge ? 'New badge' : 'Issue badge'}</button>
              {badge && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => live.client.rpc('badge_revoke', { p_org: live.org.id, p_user: member.user_id }), 'Badge switched off.')}>Switch off</button>}
            </span>
          </li>
        );
      })}</ul>

      {recent.length > 0 && (
        <details className="badge-recent"><summary>Last 3 days</summary>
          <ul className="people-list">{recent.map(item => (
            <li key={item.id}><span><b>{item.full_name || item.email}</b><small>{KIND[item.kind]} · {time(item.at)} · {item.status}</small></span></li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}
