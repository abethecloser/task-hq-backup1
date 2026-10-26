// Product identity, workspaces and industry presets.
//
// Task-HQ is the platform. A customer (organization or individual)
// gets a workspace; industry-specific language and handoffs come from the
// workspace's preset, never from platform code. Quest Roofing is the first
// customer workspace and uses the 'roofing' preset.
import type { QuestState, Role } from './contract.ts';

export const PRODUCT = {
  name: 'Task-HQ',
  short: 'Task-HQ',
  companion: 'Task-HQ Companion',
  demo: 'Task-HQ Demo',
  tagline: 'Move work forward.',
} as const;

export type PresetId = 'roofing' | 'general';

export interface WorkspacePreset {
  id: PresetId;
  label: string;
  /** Lead → delivery handoff vocabulary. */
  leadHandoffAction: string;
  leadHandedLabel: string;
  leadHandoffTaskTitle: (leadName: string) => string;
  leadHandoffNoun: string;
  /** Role that receives qualified leads. */
  leadHandoffRole: Role;
  followUpExample: string;
  roleLabels: Record<Role, string>;
}

export const PRESETS: Record<PresetId, WorkspacePreset> = {
  roofing: {
    id: 'roofing', label: 'Roofing & construction',
    leadHandoffAction: 'Hand to estimating', leadHandedLabel: 'Handed to estimating',
    leadHandoffTaskTitle: name => `Book roof inspection: ${name}`, leadHandoffNoun: 'inspection task', leadHandoffRole: 'estimator',
    followUpExample: 'e.g. send the photo estimate',
    roleLabels: { manager: 'Managers', coordinator: 'Coordinators', field: 'Field leads', sales: 'Sales', estimator: 'Estimators', reviewer: 'Reviewers' },
  },
  general: {
    id: 'general', label: 'General business',
    leadHandoffAction: 'Hand off to delivery', leadHandedLabel: 'Handed off',
    leadHandoffTaskTitle: name => `First appointment: ${name}`, leadHandoffNoun: 'appointment task', leadHandoffRole: 'estimator',
    followUpExample: 'e.g. send the proposal',
    roleLabels: { manager: 'Managers', coordinator: 'Coordinators', field: 'Team members', sales: 'Sales', estimator: 'Specialists', reviewer: 'Reviewers' },
  },
};

/** Future plan entitlements. Nothing is billed or gated today; the local demo has everything. */
export interface Entitlements { instrumentDeck: boolean; speedToLead: boolean; criticalFocus: boolean; feedback: boolean; maxMembers: number | null }
export type Plan = 'local-demo' | 'pilot';
export const ENTITLEMENTS: Record<Plan, Entitlements> = {
  'local-demo': { instrumentDeck: true, speedToLead: true, criticalFocus: true, feedback: true, maxMembers: null },
  pilot: { instrumentDeck: true, speedToLead: true, criticalFocus: true, feedback: true, maxMembers: null },
};

/**
 * A customer workspace. `tenantId` is the isolation boundary a future server
 * will enforce (every record, file and session scoped to it). Today there is
 * one local workspace per browser profile.
 */
export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  kind: 'organization' | 'individual';
  preset: PresetId;
  plan: Plan;
}

/** Account and membership shapes the server-side identity layer will own. Not used for access today. */
export interface Account { id: string; kind: 'individual' | 'organization'; displayName: string }
export interface Membership { accountId: string; workspaceId: string; personId: string; role: Role }

export const QUEST_ROOFING_WORKSPACE: Workspace = {
  id: 'quest-roofing', tenantId: 'local:quest-roofing', name: 'Quest Roofing', kind: 'organization', preset: 'roofing', plan: 'local-demo',
};

export function presetFor(state: Pick<QuestState, 'workspace'>): WorkspacePreset {
  return PRESETS[state.workspace?.preset ?? 'general'] ?? PRESETS.general;
}

export function entitlementsFor(state: Pick<QuestState, 'workspace'>): Entitlements {
  return ENTITLEMENTS[state.workspace?.plan ?? 'local-demo'];
}
