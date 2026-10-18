// The Quest task contract. Every surface (web app, extension popup, extension
// background worker) reads and writes QuestState only through `apply()` in
// engine.ts, so there is exactly one set of task rules.
//
// Core files use erasable TypeScript only (no enums/namespaces) so Node can
// run them directly for tests: `node --test src/core/*.test.ts`.

import type { PresetId, Workspace } from './workspace.ts';

export const SCHEMA_VERSION = 2;

export type TaskStatus = 'ready' | 'working' | 'blocked' | 'review' | 'done';
export type Priority = 'normal' | 'high';
/** 'reviewer' is a product reviewer: feedback only, never operational work. */
export type Role = 'manager' | 'coordinator' | 'field' | 'sales' | 'estimator' | 'reviewer';
export const OPERATIONAL_ROLES: Role[] = ['manager', 'coordinator', 'field', 'sales', 'estimator'];

export const APP_VERSION = '0.3.1';

export interface Person {
  id: string;
  name: string;
  role: Role;
  title: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface Blocker {
  note: string;
  by: string;
  at: number;
  /** Person asked to help; '' means "the team". */
  helper: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  /** Execution owner. '' means unassigned. */
  owner: string;
  /** Next-step owner: who the work is handed to when this task finishes. */
  nextOwner: string;
  /** Person who makes the call if a decision is needed. */
  decisionOwner: string;
  /** If set, finishing the work sends it to review; this person approves. */
  approver: string;
  /** Free-text external dependency, e.g. "City permit office". */
  waitingOn: string;
  /** Coordinators/watchers kept informed. */
  watchers: string[];
  status: TaskStatus;
  priority: Priority;
  /** Local date YYYY-MM-DD, or ''. */
  due: string;
  /** The concrete next physical action. */
  nextAction: string;
  dependsOn: string[];
  blocker: Blocker | null;
  /** Speed-to-lead follow-up tasks point back to their lead. */
  leadId: string;
  ultra: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  completedAt: number | null;
}

export type ContactChannel = 'phone' | 'text' | 'email' | 'in-person';
export type ContactOutcome = 'reached' | 'no-answer' | 'left-message';

export interface ContactAttempt {
  at: number;
  by: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string;
}

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'follow-up' | 'blocked' | 'won' | 'escalated' | 'lost';

export interface Lead {
  id: string;
  name: string;
  source: string;
  phone: string;
  address: string;
  need: string;
  arrivedAt: number;
  assignee: string;
  assignedAt: number | null;
  /** Time of the first logged contact attempt. */
  firstResponseAt: number | null;
  attempts: ContactAttempt[];
  stage: LeadStage;
  blocker: string;
  followUpTaskId: string;
  handoffTaskId: string;
  escalatedTo: string;
  email?: string;
  intake?: { version: 1; sourceId: string; externalId: string; channel: 'website' | 'ai_receptionist' | 'business_email' | 'manual'; sourceUrl: string };
  /** False only for accepted server intake. */
  simulated: boolean;
  updatedAt: number;
}

/** Areas of the app that Ultra Priority can lock and grants can open. */
export type Section = 'company-work' | 'needs-attention' | 'leads' | 'create-task';

export type GrantStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'returned' | 'revoked' | 'cancelled';

export interface AccessGrant {
  id: string;
  requester: string;
  section: Section;
  reason: string;
  taskId: string;
  status: GrantStatus;
  requestedAt: number;
  decidedBy: string;
  decidedAt: number | null;
  durationSec: number;
  expiresAt: number | null;
}

export interface UltraFocus {
  taskId: string;
  employee: string;
  activatedBy: string;
  since: number;
}

export interface Policy {
  /** Roles allowed to place a task into Ultra Priority. */
  ultraActivators: Role[];
  /** Roles allowed to approve access requests and release focus. */
  ultraApprovers: Role[];
  /**
   * Governance is intentionally undecided (Abraham to choose after trying it):
   * 'manager-context' — only the manager who activated focus decides requests.
   * 'company-wide'    — any approver role may decide.
   */
  ultraScope: 'manager-context' | 'company-wide';
  grantSeconds: number;
  maxGrantSeconds: number;
  /** Speed-to-lead response target. Demo default only, not company policy. */
  leadResponseMinutes: number;
  /** Open work with no activity for this long is "stalled". */
  stalledHours: number;
  /** Simulated agent workspace pilot. Off by default; the product never needs it. */
  agentPilot: boolean;
}

export type EventKind =
  | 'feedback'
  | 'task' | 'handoff' | 'unlock' | 'help' | 'approval'
  | 'ultra' | 'grant' | 'lead' | 'policy' | 'system';

/** What an undo restores. `null` means "did not exist before". */
export interface UndoSnapshot {
  tasks: Record<string, Task | null>;
  leads: Record<string, Lead | null>;
  focus?: { value: UltraFocus | null };
  grants?: AccessGrant[];
  /** Fingerprint of each touched entity right after the change; undo refuses if they moved on. */
  stamps: Record<string, string>;
  /** Serialized focus/grants right after the change, when those were touched. */
  focusAfter?: string;
  grantsAfter?: string;
}

export interface QuestEvent {
  id: string;
  at: number;
  actor: string;
  kind: EventKind;
  text: string;
  taskId?: string;
  leadId?: string;
  undo?: UndoSnapshot;
  undone?: boolean;
}

// ── Collaborative review ───────────────────────────────────────────────────

export type FeedbackCategory = 'idea' | 'issue' | 'question' | 'approved';
export type FeedbackStatus = 'open' | 'reviewing' | 'resolved';

/** Non-sensitive interface context captured with feedback. Nothing else is collected. */
export interface FeedbackContext {
  view: string;
  route: string;
  taskId: string;
  leadId: string;
  deck: string;
  version: string;
  viewport: string;
}

export interface FeedbackAttachment {
  id: string;
  kind: 'screenshot' | 'recording';
  /** Key in the private media store on this device (IndexedDB), never in task data. */
  mediaId: string;
  mime: string;
  bytes: number;
  durationMs: number;
  annotated: boolean;
  /** The person explicitly started this capture at this time. */
  consentBy: string;
  consentAt: number;
  createdAt: number;
}

export interface FeedbackReply { id: string; by: string; at: number; body: string }

export interface FeedbackItem {
  id: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  title: string;
  /** Original submission. Never edited after creation. */
  body: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  context: FeedbackContext;
  replies: FeedbackReply[];
  attachments: FeedbackAttachment[];
  history: { at: number; by: string; text: string }[];
  /** Development task created from this feedback, if any. */
  linkedTaskId: string;
}

/** Local invitation draft. Nothing is sent until a Task-HQ backend exists. */
export interface ReviewerInvite {
  id: string;
  email: string;
  role: 'reviewer';
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  status: 'draft' | 'revoked';
  revokedAt: number | null;
}

export interface QuestState {
  schemaVersion: number;
  people: Person[];
  projects: Project[];
  tasks: Task[];
  leads: Lead[];
  focus: UltraFocus | null;
  grants: AccessGrant[];
  events: QuestEvent[];
  policy: Policy;
  /** Monotonic revision; adapters keep the higher one. */
  rev: number;
  updatedAt: number;
  /** Which surface wrote last ('app', 'popup', 'background', 'test'…). */
  writer: string;
  /** Customer workspace (tenant) this data belongs to. */
  workspace: Workspace;
  feedback: FeedbackItem[];
  invites: ReviewerInvite[];
}

export interface NewTask {
  title: string;
  description?: string;
  projectId?: string;
  owner?: string;
  nextOwner?: string;
  decisionOwner?: string;
  approver?: string;
  waitingOn?: string;
  watchers?: string[];
  priority?: Priority;
  due?: string;
  nextAction?: string;
  dependsOn?: string[];
  leadId?: string;
}

export type EditableTaskFields = Pick<Task,
  'title' | 'description' | 'projectId' | 'owner' | 'nextOwner' | 'decisionOwner' | 'approver'
  | 'waitingOn' | 'watchers' | 'priority' | 'due' | 'nextAction' | 'dependsOn'>;

export interface SimulatedLeadInput {
  name: string;
  source: string;
  phone: string;
  address: string;
  need: string;
}

export type Action =
  | { type: 'task/create'; task: NewTask }
  | { type: 'task/update'; id: string; changes: Partial<EditableTaskFields> }
  /** Move Work Forward: the single "next step" for a task. */
  | { type: 'task/advance'; id: string }
  | { type: 'task/request-help'; id: string; note: string; helper?: string }
  | { type: 'task/resolve'; id: string; note?: string }
  | { type: 'task/send-back'; id: string; note: string }
  | { type: 'task/handoff'; id: string; to: string; note?: string }
  /** Completed work back to Ready (owner, approver, or a coordinator). */
  | { type: 'task/reopen'; id: string; note: string }
  | { type: 'ultra/activate'; taskId: string }
  | { type: 'ultra/release'; reason?: string }
  | { type: 'grant/request'; section: Section; reason: string }
  | { type: 'grant/decide'; id: string; approve: boolean; seconds?: number }
  | { type: 'grant/return'; id: string }
  | { type: 'grant/revoke'; id: string }
  | { type: 'lead/receive'; lead: SimulatedLeadInput }
  | { type: 'lead/assign'; id: string; to: string }
  | { type: 'lead/attempt'; id: string; channel: ContactChannel; outcome: ContactOutcome; note?: string }
  | { type: 'lead/qualify'; id: string; note?: string }
  | { type: 'lead/block'; id: string; note: string }
  | { type: 'lead/follow-up'; id: string; due: string; note?: string }
  | { type: 'lead/advance'; id: string; to?: string; note?: string }
  | { type: 'lead/escalate'; id: string; note: string }
  | { type: 'policy/update'; changes: Partial<Policy> }
  | { type: 'undo'; eventId: string }
  | { type: 'feedback/create'; item: { category: FeedbackCategory; title: string; body: string; context: Partial<FeedbackContext> } }
  | { type: 'feedback/reply'; id: string; body: string }
  | { type: 'feedback/status'; id: string; status: FeedbackStatus }
  | { type: 'feedback/attach'; id: string; attachment: Omit<FeedbackAttachment, 'id' | 'createdAt'> }
  | { type: 'feedback/convert'; id: string }
  | { type: 'invite/draft'; email: string; days: number }
  | { type: 'invite/revoke'; id: string }
  | { type: 'workspace/update'; changes: { name?: string; preset?: PresetId } }
  | { type: 'demo/reset' };

export interface ApplyContext {
  actor: string;
  now: number;
  writer?: string;
  /** Injected id generator so core stays deterministic in tests. */
  newId?: () => string;
}

export type ApplyResult =
  | { ok: true; state: QuestState; event: QuestEvent | null; message: string }
  | { ok: false; state: QuestState; error: string };

export const SECTION_LABELS: Record<Section, string> = {
  'company-work': 'Company Work',
  'needs-attention': 'Needs Attention',
  leads: 'Speed to Lead',
  'create-task': 'Create tasks',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  ready: 'Ready',
  working: 'Working',
  blocked: 'Blocked',
  review: 'In review',
  done: 'Done',
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'Waiting for first response',
  contacted: 'Contacted',
  qualified: 'Qualified',
  'follow-up': 'Follow-up scheduled',
  blocked: 'Blocked',
  won: 'Handed off',
  escalated: 'Escalated',
  lost: 'Closed',
};

export const DEFAULT_POLICY: Policy = {
  ultraActivators: ['manager'],
  ultraApprovers: ['manager'],
  ultraScope: 'manager-context',
  grantSeconds: 60,
  maxGrantSeconds: 900,
  leadResponseMinutes: 5,
  stalledHours: 24,
  agentPilot: false,
};

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = { idea: 'Idea', issue: 'Issue', question: 'Question', approved: 'Approved' };
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = { open: 'Open', reviewing: 'Reviewing', resolved: 'Resolved' };
export const REVIEWER_SCOPE = [
  'View the Task-HQ preview',
  'Navigate the demo experiences',
  'Leave feedback, replies and annotated screenshots',
  'Create review recordings (only when they start one)',
  'See their own feedback and shared review discussions',
];
