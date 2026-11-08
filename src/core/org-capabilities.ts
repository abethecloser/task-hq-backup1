// What Task HQ consumes from QuestBase: the organization's (or a person's) functional intelligence
// participants, called brains here. QuestBase owns them: structure, responsibilities, humans, tools, the
// agent registry, principals and grants (QB-ARCH-SPEC-002; ADR-0001 D-A). Task HQ never creates, stores or
// edits a brain. It reads a snapshot through a provider, offers the relevant ones for a task, and records a
// human's bounded, task-scoped delegation in the task history.
//
// Rules this file enforces:
//   - A snapshot belongs to one context (personal or organization). Contexts are never merged.
//   - Authority only goes down: a delegation is at most the brain's ceiling and the task role's ceiling.
//   - A delegation always names the human who granted it (ADR-0001 D-A; agent-to-agent delegation is an
//     unresolved Director decision, G3, so a brain can only be proposed, never self-delegate).
//   - A brain existing in a snapshot does not make it autonomous. `state` says what is really connected.
//   - With no provider, the answer is an empty snapshot that says so. Nothing is invented.
import type { Task } from './contract.ts';
import { rank, AUTHORITY_LEVELS } from './participants.ts';
import type { Authority, ParticipantId } from './participants.ts';
import type { CapabilityState, WorkKind } from './workbench.ts';

export type ContextKind = 'personal' | 'organization';
export interface ContextScope { kind: ContextKind; id: string; name: string }

export interface OrgBrain {
  id: string;
  name: string;
  /** Open vocabulary: organizations do not share one set of departments. */
  domain: string;
  purpose: string;
  responsibilities: string[];
  /** The humans accountable for this area, by name. */
  accountable: string[];
  /** Where it reports or escalates (a person or another brain's name). */
  escalatesTo: string;
  tools: string[];
  /** Highest authority QuestBase has granted it. Task HQ treats this as a ceiling, never a default. */
  ceiling: Authority;
  state: CapabilityState;
  stateNote: string;
  suits: WorkKind[];
}

/** `questbase`: from QuestBase. `fixture`: a contract test double, shown as such. `none`: nothing provided. */
export type SnapshotSource = 'questbase' | 'fixture' | 'none';
export interface OrgSnapshot { context: ContextScope; source: SnapshotSource; brains: OrgBrain[]; fetchedAt: number }
export type OrgProvider = (context: ContextScope, signal?: AbortSignal) => Promise<OrgSnapshot>;

/** The honest default: no integration exists, so there is nothing to offer. */
export const noProvider: OrgProvider = async context => ({ context, source: 'none', brains: [], fetchedAt: Date.now() });

const USABLE: readonly CapabilityState[] = ['connected', 'configured', 'experimental'];
export const brainUsable = (brain: Pick<OrgBrain, 'state'>) => USABLE.includes(brain.state);

const text = (value: unknown, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value: unknown) => (Array.isArray(value) ? value.map(item => text(item, 120)).filter(Boolean).slice(0, 20) : []);

/** A provider's answer is untrusted input: it must match the requested context and every brain must be well formed. */
export function checkSnapshot(raw: unknown, requested: ContextScope): OrgSnapshot {
  const snap = raw as Partial<OrgSnapshot> | null;
  if (!snap || typeof snap !== 'object' || !snap.context) throw new Error('Organization capabilities: malformed response.');
  if (snap.context.kind !== requested.kind || snap.context.id !== requested.id) throw new Error('Organization capabilities: the response is for a different context and was refused.');
  if (!['questbase', 'fixture', 'none'].includes(String(snap.source))) throw new Error('Organization capabilities: unknown source.');
  const seen = new Set<string>();
  const brains: OrgBrain[] = [];
  for (const entry of Array.isArray(snap.brains) ? snap.brains : []) {
    const id = text(entry?.id, 80); const name = text(entry?.name, 80);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const ceiling = (AUTHORITY_LEVELS as readonly string[]).includes(entry.ceiling) ? entry.ceiling : 'observe';
    brains.push({ id, name, domain: text(entry.domain, 60), purpose: text(entry.purpose), responsibilities: list(entry.responsibilities), accountable: list(entry.accountable), escalatesTo: text(entry.escalatesTo, 120), tools: list(entry.tools), ceiling, state: (['available', 'connected', 'configured', 'unavailable', 'experimental'] as const).includes(entry.state) ? entry.state : 'unavailable', stateNote: text(entry.stateNote), suits: Array.isArray(entry.suits) ? entry.suits : [] });
  }
  return { context: requested, source: snap.source as SnapshotSource, brains, fetchedAt: Number(snap.fetchedAt) || 0 };
}

export interface OrgView {
  context: ContextScope;
  source: SnapshotSource;
  suggested: { brain: OrgBrain; why: string }[];
  /** Relevant brains that exist but cannot be used, and the reason. */
  unusable: { brain: OrgBrain; why: string }[];
  /** Why there is nothing to offer, when that is the case. */
  note: string;
}

/** Which of the context's brains fit this kind of work. Reads the snapshot only. */
export function viewFor(snapshot: OrgSnapshot, kind: WorkKind): OrgView {
  const fits = snapshot.brains.filter(b => b.suits.includes(kind));
  const suggested = fits.filter(brainUsable).map(brain => ({ brain, why: `${brain.name} is responsible for ${brain.domain}: ${brain.purpose}` }));
  const unusable = fits.filter(b => !brainUsable(b)).map(brain => ({ brain, why: `${brain.name} would help but is ${brain.state}: ${brain.stateNote}` }));
  const note = snapshot.source === 'none' ? `QuestBase has not provided any capabilities for ${snapshot.context.name}.`
    : !snapshot.brains.length ? `${snapshot.context.name} has no functional brains configured.`
    : !fits.length ? `None of ${snapshot.context.name}'s brains is responsible for ${kind} work.` : '';
  return { context: snapshot.context, source: snapshot.source, suggested, unusable, note };
}

/** One bounded, task-scoped delegation, always granted by a named human. */
export interface Delegation {
  taskId: string;
  context: ContextScope;
  brainId: string | null;
  roleId: ParticipantId | null;
  grantedBy: string;
  authority: Authority;
  /** Only this task. A delegation never widens to other work. */
  scope: `task:${string}`;
  at: number;
}

export function delegate(input: { task: Pick<Task, 'id'>; context: ContextScope; brain: OrgBrain | null; roleCeiling: Authority | null; roleId: ParticipantId | null; requested: Authority; grantedBy: string; now: number; executeAuthorized?: boolean }): Delegation {
  if (!input.grantedBy.trim()) throw new Error('A delegation must name the person who authorizes it.');
  if (input.brain && !brainUsable(input.brain)) throw new Error(`${input.brain.name} is ${input.brain.state} and cannot be delegated to.`);
  let level = input.requested;
  for (const cap of [input.brain?.ceiling, input.roleCeiling]) if (cap && rank(level) > rank(cap)) level = cap;
  if (level === 'execute' && !input.executeAuthorized) level = 'propose';
  return { taskId: input.task.id, context: input.context, brainId: input.brain?.id ?? null, roleId: input.roleId, grantedBy: input.grantedBy, authority: level, scope: `task:${input.task.id}`, at: input.now };
}

/** The history line for approved delegations. Names who authorized it and for which context. */
export function delegationNote(grants: { name: string; authority: Authority }[], context: ContextScope, grantedByName: string): string {
  if (!grants.length) return '';
  return ` ${context.kind === 'personal' ? 'Personal' : 'Organization'} capabilities (${context.name}): ${grants.map(g => `${g.name} (${g.authority})`).join(', ')}. Authorized by ${grantedByName} for this task only.`;
}
