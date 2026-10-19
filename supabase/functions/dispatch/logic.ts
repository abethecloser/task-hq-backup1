// Server-side Task-HQ dispatch logic (pure; runs on Deno in the Edge Function and on
// Node in tests). The engine in ./core is a copy of src/core synced by
// `npm run sync:functions`, so there is exactly one set of task rules.
//
// Authority: the actor is the JWT-verified user; `people` is rebuilt from real
// memberships before every action, so nobody can add themselves or change roles
// by editing state. Demo-only actions are refused in live workspaces.
import type { Action, Person, QuestState, Role } from './core/contract.ts';
import { DEFAULT_POLICY, SCHEMA_VERSION } from './core/contract.ts';
import { apply, reconcile } from './core/engine.ts';
import type { Workspace } from './core/workspace.ts';

export type OrgRole = 'owner' | 'admin' | 'supervisor' | 'member' | 'reviewer';

export interface OrgRow { id: string; slug: string; name: string; preset: string }
export interface MemberRow { user_id: string; role: OrgRole; work_role: string; name: string }

const ROLE_TITLES: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', supervisor: 'Supervisor', member: 'Member', reviewer: 'Reviewer' };
const WORK_ROLES: Role[] = ['manager', 'coordinator', 'field', 'sales', 'estimator', 'reviewer'];

/** Actions that only make sense with synthetic demo data. */
export const LIVE_REFUSED = new Set<Action['type']>(['demo/reset', 'lead/receive', 'invite/draft', 'invite/revoke']);

export function workspaceFor(org: OrgRow): Workspace {
  return { id: org.slug, tenantId: org.id, name: org.name, kind: 'organization', preset: org.preset === 'roofing' ? 'roofing' : 'general', plan: 'pilot' };
}

export function peopleFrom(members: MemberRow[]): Person[] {
  return members.map(member => ({
    id: member.user_id,
    name: member.name || 'Member',
    role: member.role === 'reviewer' ? 'reviewer' : (WORK_ROLES.includes(member.work_role as Role) ? member.work_role as Role : 'field'),
    title: ROLE_TITLES[member.role] ?? 'Member',
    // Authority from organization membership only; never from stored state or the work role.
    authority: (ROLE_TITLES[member.role] ? member.role : 'member') as Person['authority'],
  }));
}

/** A real organization starts empty: no synthetic people, tasks or leads. */
export function emptyState(org: OrgRow, members: MemberRow[], now: number): QuestState {
  return {
    schemaVersion: SCHEMA_VERSION,
    people: peopleFrom(members),
    projects: [{ id: 'general', name: 'General' }],
    tasks: [],
    leads: [],
    focus: null,
    grants: [],
    events: [{ id: `created-${now}`, at: now, actor: 'system', kind: 'system', text: `${org.name} workspace created in Task-HQ.` }],
    policy: { ...DEFAULT_POLICY },
    rev: 1,
    updatedAt: now,
    writer: 'server',
    workspace: workspaceFor(org),
    feedback: [],
    invites: [],
  };
}

/** Server-authoritative fields are always replaced, whatever was stored. */
export function withAuthority(state: QuestState, org: OrgRow, members: MemberRow[]): QuestState {
  return {
    ...state,
    people: peopleFrom(members),
    workspace: workspaceFor(org),
    policy: { ...DEFAULT_POLICY, ...state.policy },
    feedback: Array.isArray(state.feedback) ? state.feedback : [],
    invites: [],
  };
}

/** Apply time-based expiry (temporary access) on the server. Null when nothing expired. */
export function reconcileStored(stored: QuestState, org: OrgRow, members: MemberRow[], now: number): QuestState | null {
  const result = reconcile(withAuthority(stored, org, members), now, 'server');
  return result.expired.length ? result.state : null;
}

export type RunResult =
  | { ok: true; state: QuestState; message: string; eventId: string | null; undoable: boolean }
  | { ok: false; status: number; error: string };

export function runAction(stored: QuestState, org: OrgRow, members: MemberRow[], actorId: string, action: Action, now: number): RunResult {
  if (!action || typeof action !== 'object' || typeof (action as { type?: unknown }).type !== 'string') return { ok: false, status: 400, error: 'Malformed action.' };
  if (LIVE_REFUSED.has(action.type)) return { ok: false, status: 403, error: 'That action is only available in the Task-HQ Demo.' };
  if (!members.some(member => member.user_id === actorId)) return { ok: false, status: 403, error: 'You are not a member of this workspace.' };
  const state = reconcile(withAuthority(stored, org, members), now, 'server').state;
  const result = apply(state, action, { actor: actorId, now, writer: 'server' });
  if (!result.ok) return { ok: false, status: 422, error: result.error };
  return { ok: true, state: result.state, message: result.message, eventId: result.event?.id ?? null, undoable: !!result.event?.undo };
}
