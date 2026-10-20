// Signed-in, live-workspace context (absent in the Task-HQ Demo).
import { createContext, useContext } from 'react';
import type { NavigationAccess } from '../core/navigation.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OrgRole = 'owner' | 'admin' | 'supervisor' | 'member' | 'reviewer';

export interface LiveAccount {
  client: SupabaseClient;
  userId: string;
  email: string;
  org: { id: string; slug: string; name: string };
  role: OrgRole;
  isPlatformAdmin: boolean;
  onSignOut: () => void;
  onLeaveWorkspace: () => void;
  canSwitch: boolean;
  searchOrgs?: { id: string; name: string }[];
  onOpenWorkspace?: (id: string, hash: string) => void;
  /** Organizations this account administers (owner/admin); for choosing affiliation when staging people. */
  adminOrgs: { id: string; name: string }[];
  /** Client-side navigation for the authenticated workspace; backend permissions remain authoritative. */
  navigation: NavigationAccess;
}

export const LiveContext = createContext<LiveAccount | null>(null);
export const useLive = () => useContext(LiveContext);
export const ROLE_LABELS: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', supervisor: 'Supervisor', member: 'Member', reviewer: 'Developer / Observer' };
