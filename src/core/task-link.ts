// The address of one task: #/task/<id>?org=<workspace>. Older links without a workspace keep working.
// The address is the only place a destination is kept, so nothing new is stored: while someone is on a
// sign-in screen it rides along as #/auth/<view>?next=<task address>. Only a task address is ever accepted
// as a destination. A link grants nothing: the session, membership and the server still decide what opens.

export interface TaskRoute { taskId: string; orgId: string | null }

const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

/** The task a hash points at, or null when it isn't a task address. */
export function parseTaskRoute(hash: string): TaskRoute | null {
  const [path = '', query = ''] = hash.split('?');
  const [, first = '', second = ''] = path.split('/');
  if (first !== 'task' || !second) return null;
  return { taskId: decode(second), orgId: new URLSearchParams(query).get('org') || null };
}

export function taskHash(taskId: string, orgId?: string | null): string {
  const path = `#/task/${encodeURIComponent(taskId)}`;
  return orgId ? `${path}?org=${encodeURIComponent(orgId)}` : path;
}

/** The address an open task should show, or null to leave it alone: this only ever adds the workspace to
 * an address already pointing at this task, so it can't overwrite a link that has just arrived. */
export function scopedTaskHash(hash: string, taskId: string, orgId: string): string | null {
  if (parseTaskRoute(hash)?.taskId !== taskId) return null;
  const scoped = taskHash(taskId, orgId);
  return hash === scoped ? null : scoped;
}

/** `base` is the app's address without a hash, e.g. https://task.questroofing.com/ */
export function taskUrl(base: string, taskId: string, orgId?: string | null): string {
  return `${base}${taskHash(taskId, orgId)}`;
}

/** Where this hash wants to end up after sign-in: its own task address, or the one an auth screen carries. */
export function destinationFrom(hash: string): string | null {
  const direct = parseTaskRoute(hash);
  if (direct) return taskHash(direct.taskId, direct.orgId);
  if (!hash.startsWith('#/auth/')) return null;
  const next = parseTaskRoute(new URLSearchParams(hash.split('?')[1] ?? '').get('next') ?? '');
  return next ? taskHash(next.taskId, next.orgId) : null;
}

/** An auth screen's address, carrying the destination when there is one. */
export function authRoute(view: string, destination?: string | null): string {
  return destination ? `#/auth/${view}?next=${encodeURIComponent(destination)}` : `#/auth/${view}`;
}

/** Which workspace to open. A link's workspace wins over the remembered one, and is refused (never
 * replaced by another workspace) when this account isn't a member of it. */
export function pickWorkspace<T extends { org_id: string }>(memberships: readonly T[], remembered: string | null, linkOrg: string | null): { membership?: T; linkDenied: boolean } {
  if (linkOrg) {
    const linked = memberships.find(item => item.org_id === linkOrg);
    return linked ? { membership: linked, linkDenied: false } : { linkDenied: true };
  }
  const membership = memberships.find(item => item.org_id === remembered) ?? (memberships.length === 1 ? memberships[0] : undefined);
  return { membership, linkDenied: false };
}
