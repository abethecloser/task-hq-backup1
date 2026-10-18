// Converts the first Quest app's v1 browser data into the v2 contract, and
// validates anything loaded from storage. Old keys are never deleted.
import { DEFAULT_POLICY, SCHEMA_VERSION } from './contract.ts';
import type { AccessGrant, QuestState, Section, Task, TaskStatus } from './contract.ts';
import { DEMO_PEOPLE, PRODUCT_PROJECT, REVIEWER_PERSONA, seedState } from './seed.ts';
import { QUEST_ROOFING_WORKSPACE } from './workspace.ts';

/** Earlier names of the product-feedback project; kept so stored data is recognized and renamed. */
const LEGACY_PRODUCT_PROJECT_NAMES = ['Quest product (development)', 'Task Management HQ product (development)'];

export const V1_TASKS_KEY = 'quest-task-management.tasks.v1';
export const V1_FOCUS_KEY = 'quest-task-management.focus.v1';

interface V1Task { id: string; title: string; description: string; owner: string; status: string; due: string; priority: string; dependency: string; helpNote: string; createdAt: string; ultra?: boolean }
interface V1Request { id: string; requester: string; section: string; reason: string; taskId: string; status: string; requestedAt: number; decidedBy?: string; expiresAt?: number }
interface V1Focus { focus: { employee: string; taskId: string; since: number } | null; requests: V1Request[]; history: { at: number; text: string }[] }

const V1_STATUS: Record<string, TaskStatus> = { 'have-it': 'ready', working: 'working', 'need-help': 'blocked', completed: 'done' };

function idForName(name: string | undefined) {
  return DEMO_PEOPLE.find(item => item.name === name)?.id ?? '';
}

export function migrateV1(tasksRaw: string | null, focusRaw: string | null, now: number): QuestState | null {
  if (!tasksRaw) return null;
  let v1: V1Task[];
  try {
    const parsed: unknown = JSON.parse(tasksRaw);
    if (!Array.isArray(parsed)) return null;
    v1 = parsed as V1Task[];
  } catch { return null; }
  const base = seedState(now);
  const tasks: Task[] = v1.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string').map(item => {
    const created = Date.parse(item.createdAt) || now;
    const status = V1_STATUS[item.status] ?? 'ready';
    const owner = idForName(item.owner);
    return {
      id: item.id, title: item.title, description: item.description ?? '', projectId: '',
      owner, nextOwner: '', decisionOwner: '', approver: '', waitingOn: '', watchers: [],
      status, priority: item.priority === 'High' ? 'high' : 'normal', due: item.due ?? '', nextAction: '',
      dependsOn: item.dependency ? [item.dependency] : [],
      blocker: status === 'blocked' ? { note: item.helpNote || 'Needs help', by: owner, at: created, helper: '' } : null,
      leadId: '', ultra: !!item.ultra, createdBy: owner, createdAt: created, updatedAt: now, lastActivityAt: created,
      completedAt: status === 'done' ? now : null,
    };
  });
  let focus: QuestState['focus'] = null;
  let grants: AccessGrant[] = [];
  const events = [{ id: 'migrated-v1', at: now, actor: 'system', kind: 'system' as const, text: `Imported ${tasks.length} task(s) from the earlier task app on this browser.` }];
  if (focusRaw) {
    try {
      const old = JSON.parse(focusRaw) as V1Focus;
      if (old.focus) {
        const employee = idForName(old.focus.employee);
        if (employee && tasks.some(task => task.id === old.focus!.taskId)) focus = { taskId: old.focus.taskId, employee, activatedBy: 'jordan', since: old.focus.since };
      }
      grants = (old.requests ?? []).map(request => ({
        id: request.id, requester: idForName(request.requester), section: (request.section === 'my-work' ? 'company-work' : request.section) as Section,
        reason: request.reason, taskId: request.taskId, status: request.status as AccessGrant['status'], requestedAt: request.requestedAt,
        decidedBy: idForName(request.decidedBy), decidedAt: null, durationSec: 60, expiresAt: request.expiresAt ?? null,
      })).filter(grant => grant.requester);
    } catch { /* focus data unreadable; tasks still migrate */ }
  }
  return { ...base, tasks: tasks.length ? tasks : base.tasks, focus, grants, events, writer: 'migration' };
}

/** Light structural check for anything read back from storage. */
export function isQuestState(value: unknown): value is QuestState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<QuestState>;
  return state.schemaVersion === SCHEMA_VERSION
    && Array.isArray(state.tasks) && Array.isArray(state.leads) && Array.isArray(state.people)
    && Array.isArray(state.grants) && Array.isArray(state.events) && typeof state.rev === 'number'
    && !!state.policy && typeof state.policy === 'object';
}

/** Fill any policy fields added after the state was saved. */
/** Fill fields added after the state was saved (policy keys, workspace, feedback, reviewer persona). Never drops data. */
export function normalize(state: QuestState): QuestState {
  const people = state.people.some(item => item.id === REVIEWER_PERSONA.id) ? state.people : [...state.people, REVIEWER_PERSONA];
  const projects = state.projects.some(item => item.id === PRODUCT_PROJECT.id)
    ? state.projects.map(item => (item.id === PRODUCT_PROJECT.id && LEGACY_PRODUCT_PROJECT_NAMES.includes(item.name) ? PRODUCT_PROJECT : item))
    : [...state.projects, PRODUCT_PROJECT];
  // Data saved before workspaces existed belongs to the first customer workspace.
  const workspace = state.workspace && state.workspace.id ? state.workspace : { ...QUEST_ROOFING_WORKSPACE };
  return { ...state, people, projects, workspace, feedback: Array.isArray(state.feedback) ? state.feedback : [], invites: Array.isArray(state.invites) ? state.invites : [], policy: { ...DEFAULT_POLICY, ...state.policy } };
}
