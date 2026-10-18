import type { ExecResponse } from '../core/executive-commands.ts';
import type { ExecutiveBundle } from './executive-interface.ts';
import type { Action, TaskStatus, LeadStage, Lead } from '../core/contract.ts';
import type { InsightKind, Severity } from '../core/rules.ts';
export interface AttentionRecord {
  id: string;
  orgId: string;
  rule: InsightKind;
  severity: Severity;
  subject: { kind: 'task' | 'lead' | 'grant'; id: string };
  accountableId: string | null;
  assignmentRequired: boolean;
  conditionVersion: number;
  what: string;
  why: string;
  nextAction: string;
  suggestedAction: Action | null;
}
export interface AutomationPlan {
  version: 1;
  orgId: string;
  sourceRevision: number;
  records: AttentionRecord[];
  /** False means the bounded batch cannot resolve omitted existing records. */
  complete: boolean;
  total: number;
}
export interface OperationalSnapshot {
  version: 1;
  orgId: string;
  revision: number;
  generatedAt: number;
  runtimeTimeZone: string;
  intelligence: ExecutiveBundle;
  actor: { id: string; canRunAutomation: boolean };
  executive: { openTasks: number; openLeads: number; attentionTotal: number; decisionsTotal: number };
  attention: AttentionRecord[];
  decisions: AttentionRecord[];
  tasks: { id: string; orgId: string; title: string; owner: string | null; status: TaskStatus; nextAction: string; due: string; leadId: string | null }[];
  leads: { id: string; orgId: string; name: string; owner: string | null; stage: LeadStage; arrivedAt: number; firstResponseAt: number | null; followUpTaskId: string | null; source: string; simulated: boolean }[];
  activity: { id: string; orgId: string; at: number; actor: string; kind: string; text: string; taskId: string | null; leadId: string | null }[];
  coverage: { attentionComplete: boolean; tasksComplete: boolean; leadsComplete: boolean; activityComplete: boolean; activityRetention: 'workspace-history'; oldestAvailableAt: number | null };
}
export type OperationsReply = { ok: true; snapshot: OperationalSnapshot } | { ok: false; error: string; conflict?: boolean };
export interface AutomationReceipt { ok: true; orgId: string; sourceRevision: number; opened: number; changed: number; resolved: number; complete: boolean }

export type CommandPreviewReply = {ok:true;orgId:string;revision:number;preview:ExecResponse}|{ok:false;error:string;conflict?:boolean};

export interface IntakeEventRecord { id:string;orgId:string;sourceId:string;externalId:string;channel:NonNullable<Lead['intake']>['channel'];sourceUrl:string;leadId:string;taskId:string;acceptedAt:string;eventKind:'intake.accepted' }
export type IntakeEventsReply = {ok:true;version:1;orgId:string;since:string;events:IntakeEventRecord[];truncated:boolean}|{ok:false;error:string;conflict?:boolean};
