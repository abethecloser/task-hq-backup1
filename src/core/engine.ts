// The single place where Quest state changes. Pure: (state, action, context) → result.
// Authorization here is enforced for every Quest surface on this device, but the
// acting person is self-selected in the demo, so this is NOT secure server-side
// authorization. See READINESS.md.
import { feedbackSignature } from './feedback.ts';
import { indexReferenceChanges } from './reference-persistence.ts';
import { validateAliases, tagKey, validTag, canonicalTag, referenceScope } from './references.ts';
import type {
  AccessGrant, Action, ApplyContext, ApplyResult, EventEffect, EventKind, Lead, Policy, QuestEvent, QuestState, Role, Section, Task, UltraFocus,
} from './contract.ts';
import { APP_VERSION, EDITABLE_TASK_FIELDS, FEEDBACK_CATEGORY_LABELS, FEEDBACK_STATUS_LABELS, OPERATIONAL_ROLES, SECTION_LABELS } from './contract.ts';
import { blankLead, blankTask, seedState } from './seed.ts';
import { PRESETS, presetFor } from './workspace.ts';
import {
  activeGrant, allowedBy, blockingDeps, canDecideGrants, coordinates, firstName, hasRole, inFocus, leadById, manages, nameOf, observes, owns, peopleWithRole, person, sectionFor, taskById,
} from './selectors.ts';
import { duration, localDate } from './time.ts';

const MAX_EVENTS = 400;
const ROLES: Role[] = OPERATIONAL_ROLES;
const SECTIONS: Section[] = ['company-work', 'needs-attention', 'leads', 'create-task'];

let counter = 0;
function defaultId() {
  counter += 1;
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${counter}`;
}

// ── Draft: collects changes plus the undo snapshot ─────────────────────────

interface Draft {
  base: QuestState;
  s: QuestState;
  before: { tasks: Record<string, Task | null>; leads: Record<string, Lead | null>; focus?: { value: UltraFocus | null }; grants?: AccessGrant[] };
  extraEvents: QuestEvent[];
  effects: EventEffect[];
  referenceDrafts?: Action['referenceDrafts'];
  action?: Action;
}

function begin(state: QuestState): Draft {
  return { base: state, s: { ...state, tasks: [...state.tasks], leads: [...state.leads], grants: [...state.grants] }, before: { tasks: {}, leads: {} }, extraEvents: [], effects: [] };
}

function putTask(d: Draft, task: Task) {
  const index = d.s.tasks.findIndex(item => item.id === task.id);
  if (!(task.id in d.before.tasks)) d.before.tasks[task.id] = index >= 0 ? d.s.tasks[index]! : null;
  if (index >= 0) d.s.tasks[index] = task; else d.s.tasks.unshift(task);
}

function putLead(d: Draft, lead: Lead) {
  const index = d.s.leads.findIndex(item => item.id === lead.id);
  if (!(lead.id in d.before.leads)) d.before.leads[lead.id] = index >= 0 ? d.s.leads[index]! : null;
  if (index >= 0) d.s.leads[index] = lead; else d.s.leads.unshift(lead);
}

function setFocus(d: Draft, value: UltraFocus | null) {
  if (!d.before.focus) d.before.focus = { value: d.s.focus };
  d.s.focus = value;
}

function setGrants(d: Draft, grants: AccessGrant[]) {
  if (!d.before.grants) d.before.grants = d.base.grants;
  d.s.grants = grants;
}

function touch<T extends Task>(task: T, now: number, changes: Partial<Task> = {}): Task {
  return { ...task, ...changes, updatedAt: now, lastActivityAt: now };
}

interface CommitOptions {
  kind: EventKind;
  text: string;
  message?: string;
  taskId?: string;
  leadId?: string;
  undoable?: boolean;
}

/** Short content fingerprint (djb2) so undo can tell whether an entity changed since. */
export function fingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function commit(d: Draft, ctx: ApplyContext, newId: () => string, options: CommitOptions): ApplyResult {
  d.s = indexReferenceChanges(d.base, d.s, ctx.actor, d.referenceDrafts);
  const stamps: Record<string, string> = {};
  for (const id of Object.keys(d.before.tasks)) { const task = d.s.tasks.find(item => item.id === id); if (task) stamps[id] = fingerprint(task); }
  for (const id of Object.keys(d.before.leads)) { const lead = d.s.leads.find(item => item.id === id); if (lead) stamps[id] = fingerprint(lead); }
  const event: QuestEvent = {
    id: newId(), at: ctx.now, actor: ctx.actor, kind: options.kind, text: options.text,
    ...(d.action ? { feedback: feedbackSignature(d.action, d.base, d.s), actionType: d.action.type } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.leadId ? { leadId: options.leadId } : {}),
    ...(d.effects.length ? { effects: d.effects } : {}),
    ...(options.undoable ? {
      undo: {
        tasks: d.before.tasks, leads: d.before.leads, stamps,
        ...(d.before.focus ? { focus: d.before.focus, focusAfter: JSON.stringify(d.s.focus) } : {}),
        ...(d.before.grants ? { grants: d.before.grants, grantsAfter: JSON.stringify(d.s.grants) } : {}),
      },
    } : {}),
  };
  const indexedEventState = indexReferenceChanges(d.s, { ...d.s, events: [event] }, ctx.actor, d.referenceDrafts);
  const indexedEvent = indexedEventState.events[0]!;
  const state: QuestState = {
    ...indexedEventState,
    events: [indexedEvent, ...d.extraEvents, ...d.s.events].slice(0, MAX_EVENTS),
    rev: d.base.rev + 1,
    updatedAt: ctx.now,
    writer: ctx.writer ?? d.base.writer,
  };
  return { ok: true, state, event: indexedEvent, message: options.message ?? options.text };
}

function fail(state: QuestState, error: string): ApplyResult {
  return { ok: false, state, error };
}

// ── Reconcile: time-based changes (grant expiry) ───────────────────────────

export function reconcile(state: QuestState, now: number, writer?: string): { state: QuestState; expired: AccessGrant[] } {
  const expired = state.grants.filter(grant => grant.status === 'approved' && (grant.expiresAt ?? 0) <= now);
  if (expired.length === 0) return { state, expired };
  const events: QuestEvent[] = expired.map(grant => ({
    id: `expire-${grant.id}`, at: now, actor: 'system', kind: 'grant',
    text: `Temporary access to ${SECTION_LABELS[grant.section]} expired for ${nameOf(state, grant.requester)}. Back to the critical task.`,
    taskId: grant.taskId,
  }));
  return {
    state: {
      ...state,
      grants: state.grants.map(grant => expired.includes(grant) ? { ...grant, status: 'expired' } : grant),
      events: [...events, ...state.events].slice(0, MAX_EVENTS),
      rev: state.rev + 1,
      updatedAt: now,
      writer: writer ?? state.writer,
    },
    expired,
  };
}

// ── Ultra Priority gate ────────────────────────────────────────────────────

function focusGate(state: QuestState, action: Action, actor: string, now: number): string | null {
  if (!state.focus || !inFocus(state, actor)) return null;
  const section = sectionFor(state, action);
  if (section === null) return null;
  const focusTitle = taskById(state, state.focus.taskId)?.title ?? 'the critical task';
  if (section === 'never') return `You’re in Critical Focus on “${focusTitle}”. A manager handles this until focus is released.`;
  const grant = activeGrant(state, actor, now);
  const allowed = grant && (grant.section === section || (section === 'company-work' && grant.section === 'needs-attention'));
  return allowed ? null : `You’re in Critical Focus on “${focusTitle}”. Request temporary access to ${SECTION_LABELS[section]} to do this.`;
}

// ── Completion, unlocks and handoffs ───────────────────────────────────────

function completeTask(d: Draft, task: Task, ctx: ApplyContext): string[] {
  const notes: string[] = [];
  putTask(d, touch(task, ctx.now, { status: 'done', completedAt: ctx.now, completedBy: ctx.actor, archivedAt: null, archivedBy: null, blocker: null, ultra: false }));
  for (const item of d.s.tasks) {
    if (!item.dependsOn.includes(task.id) || item.status === 'done') continue;
    const still = blockingDeps(d.s, item);
    if (still.length > 0) {
      d.effects.push({ rule: 'dependency-unlock', outcome: 'skipped', taskId: item.id, reason: `still waiting on “${still[0]!.title}”` });
      continue;
    }
    const owner = item.owner || task.nextOwner;
    putTask(d, touch(item, ctx.now, { owner }));
    d.effects.push({ rule: 'dependency-unlock', outcome: 'executed', taskId: item.id, ...(owner ? { owner } : { reason: 'unlocked with no owner' }) });
    notes.push(`“${item.title}” is unlocked for ${nameOf(d.s, owner, 'nobody yet — assign an owner')}`);
  }
  if (notes.length === 0 && task.nextOwner) {
    notes.push(`handed off to ${nameOf(d.s, task.nextOwner)}`);
    d.effects.push({ rule: 'handoff', outcome: 'executed', taskId: task.id, owner: task.nextOwner });
  }
  if (d.s.focus?.taskId === task.id) {
    endFocus(d, ctx);
    notes.push('Critical Focus released');
    d.effects.push({ rule: 'focus-release', outcome: 'executed', taskId: task.id });
  }
  return notes;
}

function endFocus(d: Draft, ctx: ApplyContext) {
  const focus = d.s.focus;
  if (!focus) return;
  const focusTask = d.s.tasks.find(task => task.id === focus.taskId);
  if (focusTask && focusTask.ultra) putTask(d, { ...focusTask, ultra: false, updatedAt: ctx.now });
  setFocus(d, null);
  setGrants(d, d.s.grants.map(grant => grant.status === 'approved' ? { ...grant, status: 'returned' } : grant.status === 'pending' ? { ...grant, status: 'cancelled' } : grant));
}

function wouldCycle(state: QuestState, taskId: string, deps: string[]) {
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(taskById(state, id)?.dependsOn ?? []));
  }
  return false;
}

/** Someone who may hold operational work. Reviewers never can. */
const TAG = /^[a-z0-9][a-z0-9-]{0,29}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates type/tags/time against the organization's taxonomy. A string is the refusal. */
function classify(state: QuestState, t: { type?: string; tags?: string[]; dueTime?: string; due?: string }): { type: string | undefined; tags: string[] | undefined; dueTime: string | undefined } | string {
  const type = t.type || undefined;
  if (type && !state.taxonomy?.types.some(item => item.id === type)) return 'That task type isn’t configured for this workspace.';
  const tags = t.tags?.length ? [...new Set(t.tags.map(tag => canonicalTag(tag, referenceScope(state, state.people[0]?.id ?? '')) ?? tagKey(tag)))] : undefined;
  if (tags && (tags.length > 8 || !tags.every(validTag))) return 'Tags are up to 8 short words: letters, digits and dashes.';
  const dueTime = t.dueTime || undefined;
  if (dueTime && !TIME.test(dueTime)) return 'Times look like 09:30.';
  if (dueTime && !t.due) return 'Pick a due date before a time.';
  return { type, tags, dueTime };
}

function cleanTaxonomy(input: QuestState['taxonomy']): NonNullable<QuestState['taxonomy']> | string {
  if (!input || !Array.isArray(input.types) || !Array.isArray(input.tags)) return 'Malformed task types and tags.';
  if (input.types.length > 30 || input.tags.length > 100) return 'Keep it to 30 types and 100 tags.';
  const types = input.types.map(item => ({ id: String(item.id).trim().toLowerCase(), label: String(item.label).trim().slice(0, 40), keywords: [...new Set((item.keywords ?? []).map(word => String(word).trim().toLowerCase()).filter(Boolean))].slice(0, 12) }));
  if (types.some(item => !TAG.test(item.id) || !item.label)) return 'Each type needs a short id and a label.';
  if (new Set(types.map(item => item.id)).size !== types.length) return 'Type ids must be unique.';
  const tags = [...new Set(input.tags.map(tag => String(tag).trim().toLowerCase().replace(/^#/, '')))];
  if (!tags.every(validTag)) return 'Tags are short words: letters, digits and dashes.';
  const rawAliasError = validateAliases({ types, tags, tagAliases: input.tagAliases });
  if (rawAliasError) return rawAliasError;
  const tagAliases = Object.fromEntries(Object.entries(input.tagAliases ?? {}).map(([a, t]) => [tagKey(a), tagKey(t)]));
  const invalid = validateAliases({ types, tags, tagAliases });
  if (invalid) return invalid;
  return { types, tags, ...(Object.keys(tagAliases).length ? { tagAliases } : {}) };
}

function validPerson(state: QuestState, id: string | undefined) {
  if (id === undefined || id === '') return true;
  const found = person(state, id);
  return !!found && found.role !== 'reviewer';
}

const isFeedbackAction = (action: Action) => action.type.startsWith('feedback/');
const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
/** Policy fields an Admin may change; the rest (Ultra Priority authority, access windows, agent pilot) stay with the Owner. */
const ROUTINE_POLICY = new Set(['leadResponseMinutes', 'stalledHours']);

// ── apply ──────────────────────────────────────────────────────────────────

export function apply(input: QuestState, action: Action, ctx: ApplyContext): ApplyResult {
  const newId = ctx.newId ?? defaultId;
  const now = ctx.now;
  const actor = ctx.actor;
  // Reviewers may only leave and discuss feedback. Checked before anything else, including reset.
  if (observes(person(input, actor)) && !isFeedbackAction(action)) {
    return fail(input, 'Reviewers can view Task-HQ and leave feedback, but can’t change operational work or the workspace.');
  }
  if (action.type === 'demo/reset') {
    const fresh = seedState(now);
    return { ok: true, state: { ...fresh, rev: input.rev + 1, writer: ctx.writer ?? 'reset' }, event: fresh.events[0]!, message: 'Demo workspace reset.' };
  }
  const state = reconcile(input, now, ctx.writer).state;
  const me = person(state, actor);
  if (!me) return fail(input, 'Choose who you are working as first.');
  const gate = focusGate(state, action, actor, now);
  if (gate) return fail(input, gate);

  const d = begin(state);
  d.action = action;
  d.referenceDrafts = Array.isArray(action.referenceDrafts) ? action.referenceDrafts : [];
  const policy = state.policy;
  const isManager = manages(me);
  const managerish = coordinates(me);

  switch (action.type) {
    case 'task/comment': {
      const task = taskById(state, action.id);
      if (!task) return fail(input, 'That task no longer exists.');
      const note = clip(action.note, 2000);
      if (!note) return fail(input, 'Write a comment first.');
      return commit(d, ctx, newId, { kind: 'task', taskId: task.id, text: `${me.name} commented: ${note}`, message: 'Comment saved. No external notification sent.' });
    }
    case 'task/create': {
      const title = action.task.title?.trim() ?? '';
      if (!title) return fail(input, 'Give the task a name.');
      if (title.length > 160) return fail(input, 'Keep the task name under 160 characters.');
      const t = action.task;
      if (![t.owner, t.nextOwner, t.decisionOwner, t.approver].every(id => validPerson(state, id))) return fail(input, 'One of the chosen people is not in this workspace.');
      if ((t.dependsOn ?? []).some(id => !taskById(state, id))) return fail(input, 'A chosen dependency no longer exists.');
      // Live members create work for themselves (or leave it unassigned); assigning others needs coordination authority.
      if (me.authority && t.owner && t.owner !== actor && !managerish) return fail(input, 'Only a supervisor, admin or owner assigns work to someone else. Create it for yourself or leave it unassigned.');
      const shape = classify(state, t);
      if (typeof shape === 'string') return fail(input, shape);
      const task = blankTask(newId(), { ...t, ...shape, title }, actor, now);
      putTask(d, task);
      const ownerText = task.owner === actor ? 'themself' : nameOf(state, task.owner, 'nobody yet');
      return commit(d, ctx, newId, { kind: 'task', taskId: task.id, undoable: true, text: `${me.name} created “${title}” for ${ownerText}.`, message: `Task created${task.owner ? ` and assigned to ${nameOf(state, task.owner)}` : ' — it needs an owner'}.` });
    }

    case 'task/update': {
      const task = taskById(state, action.id);
      if (!task) return fail(input, 'That task no longer exists.');
      if (!action.changes || typeof action.changes !== 'object') return fail(input, 'Nothing to change.');
      if (Object.keys(action.changes).some(key => !(EDITABLE_TASK_FIELDS as readonly string[]).includes(key))) return fail(input, 'Those task fields can’t be edited directly. Nothing was changed.');
      const changes = { ...action.changes };
      if (changes.title !== undefined && !changes.title.trim()) return fail(input, 'A task needs a name.');
      if (me.authority && !managerish) {
        // Live members update their own tasks. On anyone else's they may only add or remove themselves as a watcher.
        const keys = Object.keys(changes).filter(key => (changes as Record<string, unknown>)[key] !== undefined);
        const watcherOnly = keys.length === 1 && keys[0] === 'watchers' && Array.isArray(changes.watchers)
          && [...changes.watchers.filter(id => !task.watchers.includes(id)), ...task.watchers.filter(id => !changes.watchers!.includes(id))].every(id => id === actor);
        if (task.owner !== actor && !watcherOnly && !(task.owner === '' && keys.length === 1 && changes.owner === actor)) return fail(input, `Only ${task.owner ? nameOf(state, task.owner) : 'a coordinator'} or a supervisor, admin or owner can change this task.`);
        if (changes.owner !== undefined && changes.owner !== task.owner && !(task.owner === '' && changes.owner === actor)) return fail(input, 'Only a supervisor, admin or owner reassigns work. Use Hand off to pass your task on.');
      }
      if (task.ultra && !isManager && (changes.owner !== undefined || changes.due !== undefined || changes.priority !== undefined)) return fail(input, 'Only an owner or admin can change owner, due date or priority on an Ultra Priority task.');
      if (![changes.owner, changes.nextOwner, changes.decisionOwner, changes.approver].every(id => validPerson(state, id))) return fail(input, 'That person is not in this workspace.');
      if (changes.due === '' && task.dueTime && !('dueTime' in changes)) changes.dueTime = undefined;
      if ('type' in changes || 'tags' in changes || 'dueTime' in changes) {
        const shape = classify(state, { ...task, ...changes });
        if (typeof shape === 'string') return fail(input, shape);
        Object.assign(changes, { type: shape.type, tags: shape.tags, dueTime: shape.dueTime });
      }
      if (changes.dependsOn) {
        if (changes.dependsOn.some(id => !taskById(state, id))) return fail(input, 'A chosen dependency no longer exists.');
        if (wouldCycle(state, task.id, changes.dependsOn)) return fail(input, 'That dependency would make the tasks wait on each other forever.');
      }
      putTask(d, touch(task, now, changes));
      const parts: string[] = [];
      if (changes.owner !== undefined && changes.owner !== task.owner) parts.push(`owner → ${nameOf(state, changes.owner)}`);
      if (changes.nextOwner !== undefined && changes.nextOwner !== task.nextOwner) parts.push(`next step → ${nameOf(state, changes.nextOwner, 'nobody')}`);
      if (changes.approver !== undefined && changes.approver !== task.approver) parts.push(`approver → ${nameOf(state, changes.approver, 'none')}`);
      if (changes.nextAction !== undefined && changes.nextAction !== task.nextAction) parts.push(`next action → “${changes.nextAction || 'none'}”`);
      if (changes.due !== undefined && changes.due !== task.due) parts.push(`due → ${changes.due || 'no date'}`);
      if (changes.priority !== undefined && changes.priority !== task.priority) parts.push(`priority → ${changes.priority}`);
      if (changes.dependsOn !== undefined) parts.push('dependencies updated');
      const text = parts.length ? `${me.name} updated “${task.title}”: ${parts.join(', ')}.` : `${me.name} edited “${task.title}”.`;
      return commit(d, ctx, newId, { kind: changes.owner !== undefined && changes.owner !== task.owner ? 'handoff' : 'task', taskId: task.id, undoable: true, text, message: 'Saved.' });
    }

    case 'task/advance': {
      const task = taskById(state, action.id);
      if (!task) return fail(input, 'That task no longer exists.');
      if (task.status === 'done') return fail(input, 'This task is already done.');
      const deps = blockingDeps(state, task);
      if (deps.length) return fail(input, `Waiting on “${deps[0]!.title}” (${nameOf(state, deps[0]!.owner, 'unassigned')}) to finish first.`);
      if (!task.owner) {
        putTask(d, touch(task, now, { owner: actor }));
        return commit(d, ctx, newId, { kind: 'handoff', taskId: task.id, undoable: true, text: `${me.name} took ownership of “${task.title}”.`, message: `You own “${task.title}” now.` });
      }
      const mayMove = task.owner === actor || managerish;
      if (task.status === 'ready') {
        if (!mayMove) return fail(input, `Only ${nameOf(state, task.owner)} or a supervisor, admin or owner can start this.`);
        putTask(d, touch(task, now, { status: 'working' }));
        return commit(d, ctx, newId, { kind: 'task', taskId: task.id, undoable: true, text: `${me.name} started “${task.title}”.`, message: `Work started: ${task.title}` });
      }
      if (task.status === 'blocked') {
        if (!mayMove && actor !== task.blocker?.helper) return fail(input, 'Only the task owner, the person asked to help, or a supervisor, admin or owner can clear this blocker.');
        putTask(d, touch(task, now, { status: 'working', blocker: null }));
        return commit(d, ctx, newId, { kind: 'help', taskId: task.id, undoable: true, text: `${me.name} resolved the blocker on “${task.title}”. Back to Working.`, message: `Blocker resolved. ${task.title} is moving again.` });
      }
      if (task.status === 'working') {
        if (!mayMove) return fail(input, `Only ${nameOf(state, task.owner)} or a supervisor, admin or owner can finish this.`);
        if (task.approver && task.approver !== actor) {
          putTask(d, touch(task, now, { status: 'review' }));
          return commit(d, ctx, newId, { kind: 'approval', taskId: task.id, undoable: true, text: `${me.name} sent “${task.title}” to ${nameOf(state, task.approver)} for approval.`, message: `Sent to ${nameOf(state, task.approver)} for approval.` });
        }
        const notes = completeTask(d, task, ctx);
        return commit(d, ctx, newId, { kind: 'task', taskId: task.id, undoable: true, text: `${me.name} completed “${task.title}”${notes.length ? `. ${notes.join('; ')}` : ''}.`, message: `Completed${notes.length ? ` — ${notes.join('; ')}` : ''}.` });
      }
      // review
      if (actor !== task.approver && !isManager) return fail(input, `Waiting on ${nameOf(state, task.approver)} to approve.`);
      const notes = completeTask(d, task, ctx);
      return commit(d, ctx, newId, { kind: 'approval', taskId: task.id, undoable: true, text: `${me.name} approved and completed “${task.title}”${notes.length ? `. ${notes.join('; ')}` : ''}.`, message: `Approved${notes.length ? ` — ${notes.join('; ')}` : ''}.` });
    }

    case 'task/request-help': {
      const task = taskById(state, action.id);
      if (!task) return fail(input, 'That task no longer exists.');
      if (task.status === 'done') return fail(input, 'This task is already done.');
      const note = action.note.trim();
      if (!note) return fail(input, 'Say what you need help with.');
      // Live: help and blockers come from people on the task (owner, approver, next step, decision owner, watchers) or a coordinator.
      if (me.authority && !managerish && ![task.owner, task.approver, task.nextOwner, task.decisionOwner, ...task.watchers].includes(actor)) return fail(input, 'Only people on this task, or a supervisor, admin or owner, can report a blocker on it.');
      const helper = action.helper ?? '';
      if (!validPerson(state, helper)) return fail(input, 'That person is not in this workspace.');
      putTask(d, touch(task, now, { status: 'blocked', blocker: { note, by: actor, at: now, helper } }));
      return commit(d, ctx, newId, { kind: 'help', taskId: task.id, undoable: true, text: `${me.name} asked ${helper ? nameOf(state, helper) : 'the team'} for help on “${task.title}”: “${note}”.`, message: `Help requested from ${helper ? nameOf(state, helper) : 'the team'}. It’s in Needs Attention.` });
    }

    case 'task/resolve': {
      const task = taskById(state, action.id);
      if (!task || task.status !== 'blocked') return fail(input, 'This task is not blocked.');
      if (task.owner !== actor && actor !== task.blocker?.helper && !managerish) return fail(input, 'Only the task owner, the person asked to help, or a supervisor, admin or owner can clear this blocker.');
      putTask(d, touch(task, now, { status: 'working', blocker: null }));
      return commit(d, ctx, newId, { kind: 'help', taskId: task.id, undoable: true, text: `${me.name} resolved the blocker on “${task.title}”${action.note ? `: “${action.note}”` : ''}.`, message: 'Blocker resolved.' });
    }

    case 'task/send-back': {
      const task = taskById(state, action.id);
      if (!task || task.status !== 'review') return fail(input, 'Only tasks in review can be sent back.');
      if (actor !== task.approver && !isManager) return fail(input, 'Only the approver can send this back.');
      const note = action.note.trim();
      if (!note) return fail(input, 'Say what needs to change.');
      putTask(d, touch(task, now, { status: 'working', nextAction: note }));
      return commit(d, ctx, newId, { kind: 'approval', taskId: task.id, undoable: true, text: `${me.name} sent “${task.title}” back to ${nameOf(state, task.owner)}: “${note}”.`, message: `Sent back to ${nameOf(state, task.owner)} with your note.` });
    }

    case 'task/reopen': {
      const task = taskById(state, action.id);
      if (!task || task.status !== 'done') return fail(input, 'Only completed work can be reopened.');
      if (task.owner !== actor && task.approver !== actor && !managerish) return fail(input, 'Only the owner, the approver, or a supervisor, admin or owner can reopen this.');
      const note = action.note.trim();
      if (!note) return fail(input, 'Say why it is being reopened.');
      putTask(d, touch(task, now, { status: 'ready', completedAt: null, completedBy: null, archivedAt: null, archivedBy: null, nextAction: note }));
      return commit(d, ctx, newId, { kind: 'task', taskId: task.id, undoable: true, text: `${me.name} reopened “${task.title}”: “${note}”.`, message: `Reopened. ${nameOf(state, task.owner, 'It needs an owner')}${task.owner ? ' has it again' : ''}.` });
    }

    case 'task/archive':
    case 'task/unarchive': {
      const task = taskById(state, action.id);
      const archiving = action.type === 'task/archive';
      if (!task || task.status !== 'done') return fail(input, 'Only completed work can be archived.');
      if (task.owner !== actor && task.approver !== actor && !managerish) return fail(input, 'Only the owner, the approver, or a supervisor, admin or owner can archive this.');
      if (archiving === !!task.archivedAt) return fail(input, archiving ? 'That task is already archived.' : 'That task is not archived.');
      putTask(d, touch(task, now, archiving ? { archivedAt: now, archivedBy: actor } : { archivedAt: null, archivedBy: null }));
      return commit(d, ctx, newId, { kind: 'task', taskId: task.id, undoable: true, text: `${me.name} ${archiving ? 'archived' : 'restored from the archive'} “${task.title}”.`, message: archiving ? 'Archived. It stays in history.' : 'Restored from the archive.' });
    }

    case 'task/handoff': {
      const task = taskById(state, action.id);
      if (!task) return fail(input, 'That task no longer exists.');
      if (!person(state, action.to) || !validPerson(state, action.to)) return fail(input, 'Choose who receives the work.');
      if (task.ultra && !isManager) return fail(input, 'Only an owner or admin can hand off an Ultra Priority task.');
      if (task.owner && task.owner !== actor && !managerish) return fail(input, `Only ${nameOf(state, task.owner)} or a supervisor, admin or owner can hand this off.`);
      const note = action.note?.trim() ?? '';
      putTask(d, touch(task, now, { owner: action.to, ...(note ? { nextAction: note } : {}) }));
      return commit(d, ctx, newId, { kind: 'handoff', taskId: task.id, undoable: true, text: `${me.name} handed “${task.title}” to ${nameOf(state, action.to)}${note ? `: “${note}”` : ''}.`, message: `Handed to ${nameOf(state, action.to)}.` });
    }

    case 'ultra/activate': {
      if (!allowedBy(me, policy.ultraActivators)) return fail(input, 'Your role is not allowed to activate Ultra Priority under the current policy.');
      if (state.focus) return fail(input, 'An Ultra Priority task is already active. Release it first.');
      const task = taskById(state, action.taskId);
      if (!task || task.status === 'done') return fail(input, 'Choose an open task.');
      if (!task.owner) return fail(input, 'Assign an owner before making this Ultra Priority.');
      putTask(d, touch(task, now, { ultra: true, priority: 'high' }));
      setFocus(d, { taskId: task.id, employee: task.owner, activatedBy: actor, since: now });
      return commit(d, ctx, newId, { kind: 'ultra', taskId: task.id, undoable: true, text: `${me.name} activated Ultra Priority on “${task.title}”. ${nameOf(state, task.owner)} is in Critical Focus.`, message: `Ultra Priority active. ${nameOf(state, task.owner)} is now in Critical Focus.` });
    }

    case 'ultra/release': {
      if (!state.focus) return fail(input, 'No Ultra Priority task is active.');
      if (!allowedBy(me, policy.ultraApprovers) && state.focus.activatedBy !== actor) return fail(input, 'Only an approver can release Critical Focus.');
      const title = taskById(state, state.focus.taskId)?.title ?? 'the task';
      const employee = state.focus.employee;
      endFocus(d, ctx);
      return commit(d, ctx, newId, { kind: 'ultra', taskId: state.focus.taskId, text: `${me.name} released Ultra Priority on “${title}”${action.reason ? `: ${action.reason}` : ''}. ${nameOf(state, employee)} has normal access again.`, message: 'Critical Focus released. Normal navigation restored.' });
    }

    case 'grant/request': {
      if (!state.focus || state.focus.employee !== actor) return fail(input, 'Only the person in Critical Focus requests temporary access.');
      if (!SECTIONS.includes(action.section)) return fail(input, 'Choose what you need access to.');
      const reason = action.reason.trim();
      if (!reason) return fail(input, 'Say what you need and why.');
      if (state.grants.some(grant => grant.requester === actor && (grant.status === 'pending' || (grant.status === 'approved' && (grant.expiresAt ?? 0) > now)))) return fail(input, 'You already have an open access request.');
      const grant: AccessGrant = { id: newId(), requester: actor, section: action.section, reason, taskId: state.focus.taskId, status: 'pending', requestedAt: now, decidedBy: '', decidedAt: null, durationSec: policy.grantSeconds, expiresAt: null };
      setGrants(d, [grant, ...d.s.grants]);
      const deciders = state.policy.ultraScope === 'manager-context' ? nameOf(state, state.focus.activatedBy) : 'an approver';
      return commit(d, ctx, newId, { kind: 'grant', taskId: grant.taskId, text: `${me.name} requested temporary access to ${SECTION_LABELS[action.section]}: “${reason}”.`, message: `Request sent to ${deciders}. You stay on the critical task until it’s approved.` });
    }

    case 'grant/decide': {
      const grant = state.grants.find(item => item.id === action.id);
      if (!grant || grant.status !== 'pending') return fail(input, 'That request is no longer waiting for a decision.');
      if (!canDecideGrants(state, actor)) return fail(input, state.policy.ultraScope === 'manager-context' && state.focus ? `Under the current policy only ${nameOf(state, state.focus.activatedBy)} decides these requests.` : 'Your role cannot decide access requests.');
      if (grant.requester === actor) return fail(input, 'You can’t approve your own request.');
      const seconds = Math.round(Math.min(Math.max(action.seconds ?? policy.grantSeconds, 10), policy.maxGrantSeconds));
      const decided: AccessGrant = action.approve
        ? { ...grant, status: 'approved', decidedBy: actor, decidedAt: now, durationSec: seconds, expiresAt: now + seconds * 1000 }
        : { ...grant, status: 'denied', decidedBy: actor, decidedAt: now };
      setGrants(d, d.s.grants.map(item => item.id === grant.id ? decided : item));
      return commit(d, ctx, newId, {
        kind: 'grant', taskId: grant.taskId,
        text: action.approve
          ? `${me.name} approved ${nameOf(state, grant.requester)}’s access to ${SECTION_LABELS[grant.section]} for ${duration(seconds * 1000)}.`
          : `${me.name} denied ${nameOf(state, grant.requester)}’s access to ${SECTION_LABELS[grant.section]}.`,
        message: action.approve ? `Approved for ${duration(seconds * 1000)}.` : 'Request denied.',
      });
    }

    case 'grant/return':
    case 'grant/revoke': {
      const grant = state.grants.find(item => item.id === action.id);
      if (!grant || (grant.status !== 'approved' && grant.status !== 'pending')) return fail(input, 'That access is no longer open.');
      const returning = action.type === 'grant/return';
      if (returning && grant.requester !== actor) return fail(input, 'Only the person using the access can return it.');
      if (!returning && !canDecideGrants(state, actor)) return fail(input, 'Only an approver can revoke access.');
      const status = returning ? (grant.status === 'pending' ? 'cancelled' : 'returned') : 'revoked';
      setGrants(d, d.s.grants.map(item => item.id === grant.id ? { ...item, status } : item));
      return commit(d, ctx, newId, {
        kind: 'grant', taskId: grant.taskId,
        text: returning ? `${me.name} returned to the critical task. Access to ${SECTION_LABELS[grant.section]} closed.` : `${me.name} revoked ${nameOf(state, grant.requester)}’s access to ${SECTION_LABELS[grant.section]}.`,
        message: returning ? 'Back on the critical task.' : 'Access revoked.',
      });
    }

    case 'lead/receive': {
      const lead = blankLead(newId(), action.lead, now);
      putLead(d, lead);
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, text: `New simulated lead: ${lead.name} — ${lead.need}. Response target ${policy.leadResponseMinutes} min.`, message: `New lead: ${lead.name}. The response clock is running.` });
    }

    case 'roles/label': {
      if (!isManager) return fail(input, 'Only an owner or admin can configure work labels.');
      const label = clip(action.label, 80);
      if (!label || (action.personId && !person(state, action.personId))) return fail(input, 'Choose a label and a workspace member.');
      d.s.workRoles = [...new Set([...(state.workRoles ?? []), label])].slice(-100);
      if (action.personId) d.s.workLabels = { ...state.workLabels, [action.personId]: label };
      return commit(d, ctx, newId, { kind: 'policy', text: `${me.name} saved work label “${label}”. Permissions unchanged.`, message: 'Work label saved; permissions unchanged.' });
    }
    case 'lead/tags': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That relationship no longer exists.');
      if (lead.assignee !== actor && !managerish) return fail(input, 'Only the lead owner or a supervisor, admin or owner can edit relationship tags.');
      if (!Array.isArray(action.tags) || action.tags.length > 8 || !action.tags.every(tag => typeof tag === 'string' && validTag(tag))) return fail(input, 'Use up to 8 tags with letters, digits and dashes.');
      putLead(d, { ...lead, relationshipTags: [...new Set(action.tags.map(t => canonicalTag(t, referenceScope(state, actor)) ?? tagKey(t)))], updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, text: `${me.name} updated relationship tags for ${lead.name}.`, message: 'Relationship tags saved.' });
    }
    case 'lead/claim': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      if (lead.stage === 'won' || lead.stage === 'lost') return fail(input, 'Closed inquiries cannot be claimed.');
      if (lead.assignee) return fail(input, 'This lead has already been claimed. Refresh the queue.');
      putLead(d, { ...lead, assignee: actor, assignedAt: now, updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, text: `${me.name} claimed ${lead.name}.`, message: 'Lead claimed. Log a real contact attempt next.' });
    }
    case 'lead/assign': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      const to = validPerson(state, action.to) ? person(state, action.to) : undefined;
      if (!to) return fail(input, 'Choose who owns this lead.');
      // Live: assigning a lead to someone else is coordination authority. Demo: sales keeps its old routing power.
      if (action.to !== actor && !(me.authority ? managerish : hasRole(state, actor, ['manager', 'coordinator', 'sales']))) return fail(input, me.authority ? 'Only a supervisor, admin or owner assigns leads to someone else.' : 'Only sales, coordinators or managers assign leads to others.');
      putLead(d, { ...lead, assignee: to.id, assignedAt: lead.assignedAt ?? now, updatedAt: now });
      const waited = duration(now - lead.arrivedAt);
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, undoable: true, text: `${me.name} assigned lead ${lead.name} to ${to.name} (${waited} after arrival).`, message: `${to.name} owns ${lead.name}.${lead.firstResponseAt ? '' : ' First response is due now.'}` });
    }

    case 'lead/attempt': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      if (lead.assignee && lead.assignee !== actor && !managerish) return fail(input, `${nameOf(state, lead.assignee)} owns this lead.`);
      const first = !lead.firstResponseAt;
      const outcomeText = { reached: 'reached them', 'no-answer': 'no answer', 'left-message': 'left a message' }[action.outcome];
      putLead(d, {
        ...lead,
        assignee: lead.assignee || actor,
        assignedAt: lead.assignedAt ?? now,
        firstResponseAt: lead.firstResponseAt ?? now,
        attempts: [...lead.attempts, { at: now, by: actor, channel: action.channel, outcome: action.outcome, note: action.note?.trim() ?? '' }],
        stage: lead.stage === 'new' ? 'contacted' : lead.stage,
        updatedAt: now,
      });
      const timing = first ? ` First response logged ${duration(now - lead.arrivedAt)} after arrival.` : '';
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, undoable: true, text: `${me.name} logged a ${action.channel} contact attempt with ${lead.name} (${outcomeText}).${timing}`, message: `Contact attempt logged (${outcomeText}).${timing} Task-HQ did not contact anyone; this records what you did.` });
    }

    case 'lead/qualify': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      if (!lead.firstResponseAt) return fail(input, 'Log a contact attempt before qualifying.');
      putLead(d, { ...lead, stage: 'qualified', blocker: '', updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, undoable: true, text: `${me.name} qualified ${lead.name}${action.note ? `: “${action.note}”` : ''}.`, message: `${lead.name} qualified. Schedule a follow-up or ${presetFor(state).leadHandoffAction.toLowerCase()}.` });
    }

    case 'lead/block': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      const note = action.note.trim();
      if (!note) return fail(input, 'Say what is blocking this lead.');
      putLead(d, { ...lead, stage: 'blocked', blocker: note, updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, undoable: true, text: `${me.name} flagged a blocker on ${lead.name}: “${note}”.`, message: 'Blocker flagged. It’s in Needs Attention.' });
    }

    case 'lead/follow-up': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      if (!action.due) return fail(input, 'Pick a follow-up date.');
      const owner = lead.assignee || actor;
      const existing = lead.followUpTaskId ? taskById(state, lead.followUpTaskId) : undefined;
      const nextAction = action.note?.trim() || `Contact ${lead.name} at ${lead.phone}`;
      let taskId: string;
      if (existing && existing.status !== 'done') {
        taskId = existing.id;
        putTask(d, touch(existing, now, { due: action.due, nextAction }));
      } else {
        const task = blankTask(newId(), { title: `Follow up with ${lead.name}`, description: `${lead.need}. ${lead.address}. Source: ${lead.source}.`, owner, due: action.due, nextAction, projectId: 'office', leadId: lead.id, priority: 'high' }, actor, now);
        taskId = task.id;
        putTask(d, task);
      }
      putLead(d, { ...lead, assignee: owner, stage: 'follow-up', followUpTaskId: taskId, updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, taskId, undoable: true, text: `${me.name} scheduled a follow-up with ${lead.name} for ${action.due}, owned by ${nameOf(state, owner)}.`, message: `Follow-up task created for ${nameOf(state, owner)} (${action.due}).` });
    }

    case 'lead/advance': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      if (!lead.firstResponseAt) return fail(input, 'Log a contact attempt before handing this lead on.');
      const preset = presetFor(state);
      const to = action.to ?? peopleWithRole(state, preset.leadHandoffRole)[0]?.id ?? actor;
      if (!validPerson(state, to)) return fail(input, 'Choose who receives the lead.');
      if (!person(state, to)) return fail(input, 'Choose who receives the lead.');
      const task = blankTask(newId(), {
        title: preset.leadHandoffTaskTitle(lead.name), description: `${lead.need}. Contact: ${lead.phone}, ${lead.address}. Qualified by ${nameOf(state, lead.assignee || actor)}.`,
        owner: to, due: localDate(now), priority: 'high', projectId: 'office', leadId: lead.id,
        nextAction: action.note?.trim() || `Call ${lead.phone} and book a time at ${lead.address}`,
      }, actor, now);
      putTask(d, task);
      const followUp = lead.followUpTaskId ? taskById(state, lead.followUpTaskId) : undefined;
      // Same completion path as any task: clears its blocker, unlocks dependents, releases focus.
      if (followUp && followUp.status !== 'done') completeTask(d, followUp, ctx);
      putLead(d, { ...lead, stage: 'won', handoffTaskId: task.id, blocker: '', updatedAt: now });
      return commit(d, ctx, newId, { kind: 'handoff', leadId: lead.id, taskId: task.id, undoable: true, text: `${me.name} handed lead ${lead.name} to ${nameOf(state, to)} (${preset.leadHandoffNoun}).`, message: `Handed to ${nameOf(state, to)}. An ${preset.leadHandoffNoun} is in their My Work.` });
    }

    case 'lead/escalate': {
      const lead = leadById(state, action.id);
      if (!lead) return fail(input, 'That lead no longer exists.');
      const note = action.note.trim();
      if (!note) return fail(input, 'Say why this needs escalation.');
      // Escalations go to the people who manage the workspace (Owner and Admins live; managers in the demo).
      const managers = state.people.filter(item => manages(item));
      const to = (managers.find(item => item.id !== actor) ?? managers[0])?.id ?? actor;
      const task = blankTask(newId(), { title: `Escalated lead: ${lead.name}`, description: `${lead.need}. ${lead.phone}, ${lead.address}.`, owner: to, decisionOwner: to, due: localDate(now), priority: 'high', projectId: 'office', leadId: lead.id, nextAction: note }, actor, now);
      putTask(d, task);
      putLead(d, { ...lead, stage: 'escalated', escalatedTo: to, updatedAt: now });
      return commit(d, ctx, newId, { kind: 'lead', leadId: lead.id, taskId: task.id, undoable: true, text: `${me.name} escalated ${lead.name} to ${nameOf(state, to)}: “${note}”.`, message: `Escalated to ${nameOf(state, to)}.` });
    }

    case 'taxonomy/register-tags': {
      if (!Array.isArray(action.tags) || action.tags.length > 30 || !action.tags.every(t => typeof t === 'string' && validTag(tagKey(t)))) return fail(input, 'Use short tag names with letters, digits and dashes.');
      const tags = [...new Set([...(state.taxonomy?.tags ?? []), ...action.tags.map(tagKey)])];
      if (tags.length > 100) return fail(input, 'Keep it to 100 organization tags.');
      d.s.taxonomy = { types: state.taxonomy?.types ?? [], ...state.taxonomy, tags };
      return commit(d, ctx, newId, { kind: 'policy', text: `${me.name} registered organization tags.`, message: 'Tags saved. No notifications sent.' });
    }
    case 'taxonomy/update': {
      if (!isManager) return fail(input, 'Only an owner or admin can change task types and tags.');
      const next = cleanTaxonomy(action.taxonomy);
      if (typeof next === 'string') return fail(input, next);
      d.s.taxonomy = next;
      return commit(d, ctx, newId, { kind: 'policy', text: `${me.name} updated task types and tags (${next.types.length} types, ${next.tags.length} tags).`, message: 'Task types and tags saved.' });
    }

    case 'policy/update': {
      if (!isManager) return fail(input, 'Only an owner or admin can change the policy.');
      if (Object.entries(action.changes).some(([key, value]) => !ROUTINE_POLICY.has(key) && JSON.stringify(value) !== JSON.stringify(policy[key as keyof Policy])) && !owns(me)) return fail(input, 'Only the owner changes Ultra Priority authority, access windows and the agent pilot. Admins can change response and stalled-work thresholds.');
      const next: Policy = { ...policy, ...action.changes };
      const numbers: [keyof Policy, number, number][] = [['grantSeconds', 10, next.maxGrantSeconds], ['maxGrantSeconds', 30, 86_400], ['leadResponseMinutes', 1, 1440], ['stalledHours', 1, 720]];
      for (const [key, min, max] of numbers) {
        const value = next[key] as number;
        if (!Number.isFinite(value) || value < min || value > max) return fail(input, `${key} must be between ${min} and ${max}.`);
      }
      if (!next.ultraActivators.length || !next.ultraApprovers.length || ![...next.ultraActivators, ...next.ultraApprovers].every(role => ROLES.includes(role))) return fail(input, 'Pick at least one valid role.');
      if (next.ultraScope !== 'manager-context' && next.ultraScope !== 'company-wide') return fail(input, 'Unknown scope.');
      d.s.policy = next;
      return commit(d, ctx, newId, { kind: 'policy', text: `${me.name} updated the demo policy.`, message: 'Policy saved.' });
    }

    case 'feedback/create': {
      const item = action.item;
      if (!item || !(item.category in FEEDBACK_CATEGORY_LABELS)) return fail(input, 'Choose Idea, Issue, Question or Approved.');
      const title = clip(item.title, 120);
      const body = clip(item.body, 4000);
      if (!title) return fail(input, 'Give the feedback a short title.');
      const c = item.context ?? {};
      const context = { view: clip(c.view, 60), route: clip(c.route, 200), taskId: clip(c.taskId, 80), leadId: clip(c.leadId, 80), deck: clip(c.deck, 40), version: clip(c.version, 20) || APP_VERSION, viewport: clip(c.viewport, 20) };
      if (context.taskId && !taskById(state, context.taskId)) context.taskId = '';
      if (context.leadId && !leadById(state, context.leadId)) context.leadId = '';
      const created = { id: newId(), category: item.category, status: 'open' as const, title, body, author: actor, createdAt: now, updatedAt: now, context, replies: [], attachments: [], history: [{ at: now, by: actor, text: `${me.name} submitted this ${FEEDBACK_CATEGORY_LABELS[item.category].toLowerCase()}.` }], linkedTaskId: '' };
      d.s.feedback = [created, ...d.s.feedback];
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} left ${FEEDBACK_CATEGORY_LABELS[item.category].toLowerCase()} feedback: “${title}”${context.view ? ` (${context.view})` : ''}.`, message: 'Feedback saved on this device.', ...(context.taskId ? { taskId: context.taskId } : {}), ...(context.leadId ? { leadId: context.leadId } : {}) });
    }

    case 'feedback/reply': {
      const item = state.feedback.find(entry => entry.id === action.id);
      if (!item) return fail(input, 'That feedback no longer exists.');
      const body = clip(action.body, 2000);
      if (!body) return fail(input, 'Write a reply first.');
      d.s.feedback = state.feedback.map(entry => entry.id === item.id ? { ...entry, updatedAt: now, replies: [...entry.replies, { id: newId(), by: actor, at: now, body }] } : entry);
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} replied on “${item.title}”.`, message: 'Reply added.' });
    }

    case 'feedback/status': {
      const item = state.feedback.find(entry => entry.id === action.id);
      if (!item) return fail(input, 'That feedback no longer exists.');
      if (!(action.status in FEEDBACK_STATUS_LABELS)) return fail(input, 'Unknown status.');
      const triage = managerish;
      const authorResolving = item.author === actor && action.status === 'resolved';
      if (!triage && !authorResolving) return fail(input, 'Only a supervisor, admin or owner moves feedback through review. Authors can mark their own feedback resolved.');
      if (item.status === action.status) return fail(input, `It’s already ${FEEDBACK_STATUS_LABELS[action.status].toLowerCase()}.`);
      d.s.feedback = state.feedback.map(entry => entry.id === item.id ? { ...entry, status: action.status, updatedAt: now, history: [...entry.history, { at: now, by: actor, text: `${me.name} moved it to ${FEEDBACK_STATUS_LABELS[action.status]}.` }] } : entry);
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} marked “${item.title}” ${FEEDBACK_STATUS_LABELS[action.status].toLowerCase()}.`, message: `Marked ${FEEDBACK_STATUS_LABELS[action.status]}.` });
    }

    case 'feedback/attach': {
      const item = state.feedback.find(entry => entry.id === action.id);
      if (!item) return fail(input, 'That feedback no longer exists.');
      if (item.author !== actor) return fail(input, 'Only the author attaches captures to their feedback.');
      const a = action.attachment;
      if (!a || (a.kind !== 'screenshot' && a.kind !== 'recording')) return fail(input, 'Unknown attachment type.');
      if (a.consentBy !== actor || !a.consentAt || a.consentAt > now) return fail(input, 'Captures need explicit consent from the person who made them.');
      if (!a.mediaId) return fail(input, 'The capture was not stored.');
      if ((a.kind === 'screenshot' && !/^image\/(png|jpeg|webp)$/.test(a.mime)) || (a.kind === 'recording' && !/^video\/webm/.test(a.mime))) return fail(input, 'Unsupported capture format.');
      if (!(a.bytes > 0) || a.bytes > 60 * 1024 * 1024) return fail(input, 'Capture is empty or too large (60 MB max).');
      const attachment = { ...a, durationMs: Math.max(0, Math.round(a.durationMs || 0)), annotated: !!a.annotated, id: newId(), createdAt: now };
      d.s.feedback = state.feedback.map(entry => entry.id === item.id ? { ...entry, updatedAt: now, attachments: [...entry.attachments, attachment], history: [...entry.history, { at: now, by: actor, text: `${me.name} attached a ${a.kind}${a.annotated ? ' (annotated)' : ''}.` }] } : entry);
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} attached a ${a.kind} to “${item.title}”.`, message: `${a.kind === 'screenshot' ? 'Screenshot' : 'Recording'} attached.` });
    }

    case 'feedback/convert': {
      const item = state.feedback.find(entry => entry.id === action.id);
      if (!item) return fail(input, 'That feedback no longer exists.');
      if (!isManager) return fail(input, 'Only an owner or admin turns feedback into development work.');
      if (item.linkedTaskId) return fail(input, 'This feedback already has a development task.');
      if (!d.s.projects.some(project => project.id === 'quest-product')) d.s.projects = [...d.s.projects, { id: 'quest-product', name: 'Task-HQ product (development)' }];
      const task = blankTask(newId(), {
        title: `${FEEDBACK_CATEGORY_LABELS[item.category]}: ${item.title}`.slice(0, 160), projectId: 'quest-product', owner: actor,
        description: `From feedback by ${nameOf(state, item.author)} on ${new Date(item.createdAt).toLocaleDateString('en-US')}${item.context.view ? ` (${item.context.view})` : ''}. Original feedback is kept unchanged in the Feedback inbox.`,
        nextAction: 'Decide scope and acceptance criteria',
      }, actor, now);
      putTask(d, task);
      d.s.feedback = state.feedback.map(entry => entry.id === item.id ? { ...entry, linkedTaskId: task.id, status: entry.status === 'open' ? 'reviewing' : entry.status, updatedAt: now, history: [...entry.history, { at: now, by: actor, text: `${me.name} created development task “${task.title}”.` }] } : entry);
      return commit(d, ctx, newId, { kind: 'feedback', taskId: task.id, text: `${me.name} turned feedback “${item.title}” into development task “${task.title}”.`, message: 'Development task created and linked.' });
    }

    case 'invite/draft': {
      if (!isManager) return fail(input, 'Only an owner or admin prepares reviewer invitations.');
      const email = clip(action.email, 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(input, 'Enter the reviewer’s verified email address.');
      const days = Math.round(action.days);
      if (!(days >= 1 && days <= 30)) return fail(input, 'Invitations expire after 1–30 days.');
      if (state.invites.some(invite => invite.email === email && invite.status === 'draft' && invite.expiresAt > now)) return fail(input, 'There’s already an open draft for that email.');
      d.s.invites = [{ id: newId(), email, role: 'reviewer', createdBy: actor, createdAt: now, expiresAt: now + days * 86_400_000, status: 'draft', revokedAt: null }, ...state.invites];
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} prepared a reviewer invitation draft (not sent).`, message: 'Draft saved. Nothing was sent — a Task-HQ backend is required.' });
    }

    case 'invite/revoke': {
      if (!isManager) return fail(input, 'Only an owner or admin revokes invitations.');
      const invite = state.invites.find(item => item.id === action.id);
      if (!invite || invite.status === 'revoked') return fail(input, 'That invitation is already revoked.');
      d.s.invites = state.invites.map(item => item.id === invite.id ? { ...item, status: 'revoked', revokedAt: now } : item);
      return commit(d, ctx, newId, { kind: 'feedback', text: `${me.name} revoked a reviewer invitation draft.`, message: 'Invitation revoked.' });
    }

    case 'workspace/update': {
      if (!owns(me)) return fail(input, 'Only the owner changes the workspace name and industry preset.');
      const name = action.changes.name === undefined ? state.workspace.name : clip(action.changes.name, 80);
      if (!name) return fail(input, 'Give the workspace a name.');
      const preset = action.changes.preset ?? state.workspace.preset;
      if (!(preset in PRESETS)) return fail(input, 'Unknown industry preset.');
      d.s.workspace = { ...state.workspace, name, preset };
      return commit(d, ctx, newId, { kind: 'policy', text: `${me.name} updated the workspace: ${name} · ${PRESETS[preset].label}.`, message: 'Workspace updated.' });
    }

    case 'undo': {
      const event = state.events.find(item => item.id === action.eventId);
      if (!event?.undo || event.undone) return fail(input, 'That change can’t be undone.');
      if (event.actor !== actor) return fail(input, 'Only the person who made a change can undo it.');
      const snap = event.undo;
      for (const [id, stamp] of Object.entries(snap.stamps)) {
        const current = taskById(state, id) ?? leadById(state, id);
        if (current && fingerprint(current) !== stamp) return fail(input, 'Someone has changed this since. Undo is no longer safe.');
      }
      if (snap.focusAfter !== undefined && JSON.stringify(state.focus) !== snap.focusAfter) return fail(input, 'Ultra Priority has changed since. Undo is no longer safe.');
      if (snap.grantsAfter !== undefined && JSON.stringify(state.grants) !== snap.grantsAfter) return fail(input, 'Access requests have changed since. Undo is no longer safe.');
      const removed = Object.keys(snap.tasks).filter(id => snap.tasks[id] === null);
      if (state.tasks.some(task => !(task.id in snap.tasks) && task.dependsOn.some(id => removed.includes(id)))) return fail(input, 'Other work now depends on this. Undo is no longer safe.');
      d.s.tasks = state.tasks.flatMap(task => task.id in snap.tasks ? (snap.tasks[task.id] ? [{ ...snap.tasks[task.id]!, updatedAt: now }] : []) : [task]);
      d.s.leads = state.leads.flatMap(lead => lead.id in snap.leads ? (snap.leads[lead.id] ? [{ ...snap.leads[lead.id]!, updatedAt: now }] : []) : [lead]);
      if (snap.focus) d.s.focus = snap.focus.value;
      if (snap.grants) d.s.grants = snap.grants;
      d.s.events = state.events.map(item => item.id === event.id ? { ...item, undone: true } : item);
      return commit(d, ctx, newId, { kind: event.kind, taskId: event.taskId, leadId: event.leadId, text: `${me.name} undid: ${event.text}`, message: 'Undone.' });
    }
  }
}

/** First names of everyone who should hear about an event, for notifications. */
export function audienceFor(state: QuestState, event: QuestEvent): string[] {
  const task = event.taskId ? taskById(state, event.taskId) : undefined;
  const lead = event.leadId ? leadById(state, event.leadId) : undefined;
  const ids = new Set<string>();
  if (task) [task.owner, task.approver, task.nextOwner, task.blocker?.helper ?? '', ...task.watchers].forEach(id => id && ids.add(id));
  if (lead) [lead.assignee, lead.escalatedTo].forEach(id => id && ids.add(id));
  if (event.kind === 'grant' || event.kind === 'ultra') {
    if (state.focus) { ids.add(state.focus.employee); ids.add(state.focus.activatedBy); }
    state.people.filter(item => allowedBy(item, state.policy.ultraApprovers)).forEach(item => ids.add(item.id));
  }
  if (event.kind === 'lead' && lead && !lead.assignee) state.people.filter(item => manages(item) || item.role === 'sales').forEach(item => ids.add(item.id));
  ids.delete(event.actor);
  return [...ids];
}

export { firstName };
