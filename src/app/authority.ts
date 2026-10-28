// What People & Access offers, as pure predicates over the caller's organization role.
// The server decides with its own SQL functions (tenancy_core, team_staging); the DB
// parity test runs every role × action against the real functions and fails if the UI
// offers anything the server refuses.
import type { OrgRole } from './LiveContext.tsx';

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'supervisor', 'member', 'reviewer'];

/** Owners and admins manage members, requests, invitations and the staged directory. */
export const isOrgAdmin = (role: OrgRole) => role === 'owner' || role === 'admin';

/** Roles the caller may grant (invite, approve a request, change someone's role to). */
export const grantableRoles = (caller: OrgRole): OrgRole[] => (isOrgAdmin(caller) ? ORG_ROLES.filter(role => caller === 'owner' || (role !== 'owner' && role !== 'admin')) : []);

/** Change another member's roles or remove them. Your own row is never editable here. */
export const canManageMember = (caller: OrgRole, target: OrgRole, self: boolean) => isOrgAdmin(caller) && !self && (caller === 'owner' || (target !== 'owner' && target !== 'admin'));

/** Planned organization roles the caller may give a staged person (owners are never staged). */
export const plannedRolesFor = (caller: OrgRole): OrgRole[] => (isOrgAdmin(caller) ? (['admin', 'supervisor', 'member', 'reviewer'] as OrgRole[]).filter(role => caller === 'owner' || role !== 'admin') : []);

/** A staged person can be selected for "Prepare invitation" by this caller. */
export function inviteEligible(item: { affiliation_confirmed: boolean; email: string | null; state: string; provisional_role: OrgRole }, caller: OrgRole) {
  return isOrgAdmin(caller) && item.affiliation_confirmed && !!item.email && (item.state === 'not-invited' || item.state === 'expired')
    && grantableRoles(caller).includes(item.provisional_role);
}
