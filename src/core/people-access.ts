// People & Access: one status and one next action per person, from public.org_people_access.
// The activation link is the single path for people without a Task-HQ account; an invitation
// is the fallback for someone who already has one. Organization roles (Owner/Admin/Member)
// stay separate from work roles, and only an owner may send an Admin activation.

export type AccessStatus = 'active' | 'link-sent' | 'link-invalid' | 'link-expired' | 'invited' | 'invite-expired' | 'ready' | 'needs-email';

export interface PersonAccess {
  id: string;
  name: string;
  email: string | null;
  role: string;
  work_role: string;
  affiliation_confirmed: boolean;
  member: { user_id: string; role: string; work_role: string } | null;
  invitation: { id: string; role: string; work_role: string; expires_at: string; expired: boolean } | null;
  activation: { expires_at: string; state: 'valid' | 'invalidated' | 'expired' | 'revoked' | 'redeemed' } | null;
  status: AccessStatus;
}

export const STATUS_LABEL: Record<AccessStatus, string> = {
  active: 'Active',
  'link-sent': 'Activation link sent',
  'link-invalid': 'Link no longer valid',
  'link-expired': 'Link expired',
  invited: 'Invited',
  'invite-expired': 'Invitation expired',
  ready: 'Not invited',
  'needs-email': 'Needs email',
};

export type Primary = 'send-link' | 'new-link' | 'add-email' | 'owner-only' | 'none';
export type Secondary = 'revoke-link' | 'invite-instead' | 'revoke-invite';

export interface NextAction { primary: Primary; label: string; secondary: Secondary[]; detail: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What the caller can do next for this person. `callerRole` is their organization role. */
export function nextAction(person: PersonAccess, callerRole: string): NextAction {
  const sending = person.role === 'admin' && callerRole !== 'owner';
  const invitedDetail = person.invitation && !person.invitation.expired ? `Invitation open until ${when(person.invitation.expires_at)}` : '';
  switch (person.status) {
    case 'active':
      return { primary: 'none', label: '', secondary: [], detail: '' };
    case 'needs-email':
      return { primary: 'add-email', label: 'Add email', secondary: [], detail: 'An email is needed to activate' };
    case 'link-sent':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'New link', secondary: sending ? [] : ['revoke-link'],
        detail: `Single use · expires ${when(person.activation!.expires_at)}${invitedDetail ? ` · ${invitedDetail.toLowerCase()}` : ''}` };
    case 'link-invalid':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'Send new link', secondary: [], detail: 'Edited, or the issuer’s role changed, after the link was sent' };
    case 'link-expired':
      return { primary: sending ? 'owner-only' : 'new-link', label: 'Send new link', secondary: [], detail: 'Expired or revoked' };
    case 'invited':
      return { primary: sending ? 'owner-only' : 'send-link', label: 'Send activation link', secondary: ['revoke-invite'], detail: invitedDetail };
    case 'invite-expired':
    case 'ready':
      return { primary: sending ? 'owner-only' : 'send-link', label: 'Send activation link', secondary: sending ? [] : ['invite-instead'], detail: person.status === 'invite-expired' ? 'Invitation expired' : '' };
  }
}

/** The single-use link. The code travels in the fragment, so it never reaches server logs or referrers. */
export const activationLink = (origin: string, code: string) => `${origin}/activate/index.html#code=${encodeURIComponent(code)}`;

/** The message an administrator sends, since Task-HQ doesn't email anyone. */
export function activationMessage(name: string, org: string, origin: string, code: string, expiresAt: string) {
  return `Hi ${name.split(' ')[0]}, here is your ${org} Task-HQ activation link: ${activationLink(origin, code)}\n`
    + `It works once and expires ${when(expiresAt)}. You'll choose your own password. `
    + `If the link doesn't open, go to ${origin}/activate/index.html and enter this code: ${code}`;
}
