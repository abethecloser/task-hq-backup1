// People & Access: one status and one next action per person, from public.org_people_access.
// Identity v1: one invite path. Invite → personal, single-use setup link (7 days, revocable, also
// as a QR code) → the person confirms it's them and proves their email with a six-digit code →
// active with the roles chosen here. An existing Task-HQ account is linked by the same link, never
// duplicated. Organization roles stay separate from work roles; only an owner may invite an Admin.

export type AccessStatus = 'active' | 'link-sent' | 'link-invalid' | 'link-expired' | 'invited' | 'invite-expired' | 'ready' | 'needs-email';

export interface PersonAccess {
  id: string;
  name: string;
  email: string | null;
  role: string;
  work_role: string;
  affiliation_confirmed: boolean;
  /** The email already belongs to a Task-HQ account (link it; never create another). */
  has_account?: boolean;
  member: { user_id: string; role: string; work_role: string } | null;
  invitation: { id: string; role: string; work_role: string; expires_at: string; expired: boolean } | null;
  activation: { expires_at: string; state: 'valid' | 'invalidated' | 'expired' | 'revoked' | 'redeemed' } | null;
  status: AccessStatus;
}

/** The production address employees use. Setup messages always point here, whatever page an admin is on. */
export const PRODUCTION_ORIGIN = 'https://task.questroofing.com';

export const STATUS_LABEL: Record<AccessStatus, string> = {
  active: 'Active',
  'link-sent': 'Setup pending',
  'link-invalid': 'Expired · details changed',
  'link-expired': 'Expired',
  invited: 'Invited',
  'invite-expired': 'Expired',
  ready: 'Not provisioned',
  'needs-email': 'Needs email',
};

/** How provisioning reaches this person, or why it can't (null = not eligible right now). */
export function provisionPath(person: PersonAccess, callerRole: string): 'link' | null {
  if (person.status === 'active' || person.status === 'needs-email' || person.status === 'link-sent') return null;
  if (person.role === 'admin' && callerRole !== 'owner') return null;
  return 'link';
}

export type Primary = 'send-link' | 'new-link' | 'add-email' | 'owner-only' | 'none';
export type Secondary = 'revoke-link' | 'revoke-invite';

export interface NextAction { primary: Primary; label: string; secondary: Secondary[]; detail: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What the caller can do next for this person. `callerRole` is their organization role. */
export function nextAction(person: PersonAccess, callerRole: string): NextAction {
  const sending = person.role === 'admin' && callerRole !== 'owner';
  const invitedDetail = person.invitation && !person.invitation.expired ? `Older invitation open until ${when(person.invitation.expires_at)}` : '';
  const account = person.has_account ? 'Has a Task-HQ account; the link adds it to this workspace' : '';
  const action = nextFor(person, sending, invitedDetail);
  return account && person.status !== 'active' ? { ...action, detail: [account, action.detail].filter(Boolean).join(' · ') } : action;
}

function nextFor(person: PersonAccess, sending: boolean, invitedDetail: string): NextAction {
  switch (person.status) {
    case 'active':
      return { primary: 'none', label: '', secondary: [], detail: '' };
    case 'needs-email':
      return { primary: 'add-email', label: 'Add email', secondary: [], detail: 'An email is needed to activate' };
    case 'link-sent':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'New setup link',
        secondary: sending ? [] : (['revoke-link'] as Secondary[]).concat(person.invitation && !person.invitation.expired ? ['revoke-invite'] : []),
        detail: `Single use · expires ${when(person.activation!.expires_at)}${invitedDetail ? ` · ${invitedDetail.toLowerCase()}` : ''}` };
    case 'link-invalid':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'Send new setup link', secondary: [], detail: 'Edited, or the issuer’s role changed, after the link was sent' };
    case 'link-expired':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'Send new setup link', secondary: [], detail: 'Expired or revoked · the old link no longer works' };
    case 'invited':
      return { primary: sending ? 'owner-only' : 'send-link', label: 'Send setup link', secondary: ['revoke-invite'], detail: invitedDetail };
    case 'invite-expired':
    case 'ready':
      return { primary: sending ? 'owner-only' : 'send-link', label: 'Send setup link', secondary: [], detail: person.status === 'invite-expired' ? 'Invitation expired' : '' };
  }
}

/** The single-use link. The code travels in the fragment, so it never reaches server logs or referrers. */
export const activationLink = (origin: string, code: string) => `${origin}/activate/index.html#code=${encodeURIComponent(code)}`;

/** The message a manager sends through their own channel; Task-HQ sends nothing itself. */
export function activationMessage(name: string, org: string, origin: string, code: string, expiresAt: string) {
  return `Hi ${name.split(' ')[0]}, here is your personal ${org} Task-HQ setup link: ${activationLink(origin, code)}\n`
    + `It works once and expires ${when(expiresAt)}. You'll confirm your email with a six-digit code we send you. Please don't forward this link. `
    + `If the link doesn't open, go to ${origin}/activate/index.html and enter this code: ${code}`;
}
