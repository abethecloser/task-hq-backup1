import type { QuestState } from '../core/contract.ts';
export type ShiftState = 'active' | 'checkout_pending' | 'checked_out';
export interface ShiftRecord { id: string; shift_id: string; kind: string; text: string; author: string; created_at: string; data: Record<string, unknown> }
export interface ShiftMedia { id: string; shift_id: string; path: string; mime: string; bytes: number; status: 'pending' | 'ready'; task_id: string; project_id: string; created_at: string }
export interface Shift {
  id: string; org_id: string; employee: string; employee_name?: string; state: ShiftState; started_at: string; ended_at: string | null;
  checkout_requested_at: string | null; focus: string; task_id: string; project_id: string; eod_draft: string;
  review_required: boolean; records: ShiftRecord[]; media: ShiftMedia[];
}
export interface ShiftSnapshot { shifts: Shift[]; server_now: string; can_manage: boolean }
export type ShiftAction = 'check_in' | 'context' | 'capture' | 'request_checkout' | 'draft_eod' | 'submit_eod' | 'checkout' | 'exception_checkout' | 'correction' | 'adjust' | 'reserve_media' | 'finish_media';
export interface ShiftCommand { id: string; action: ShiftAction; shift_id: string | null; data: Record<string, unknown> }
export interface ShiftBackend {
  kind: 'live' | 'demo'; org: string; actor: string;
  load(team?: boolean): Promise<ShiftSnapshot>;
  command(command: ShiftCommand): Promise<Shift>;
  upload(media: ShiftMedia, blob: Blob): Promise<void>;
  mediaUrl(media: ShiftMedia): Promise<string>;
}
export interface ShiftContext { org: string; actor: string; manager: boolean; canCheckIn: boolean; tasks: QuestState['tasks']; projects: QuestState['projects']; events: QuestState['events'] }
export const STATE_LABELS: Record<ShiftState, string> = { active: 'Active Shift', checkout_pending: 'Checkout Pending', checked_out: 'Checked Out' };
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'video/webm', 'video/mp4', 'video/quicktime'];
export const normalizeMime = (value: string) => value.split(';')[0]!.trim().toLowerCase();
export function validateMedia(blob: Blob) {
  if (!blob.size || blob.size > MAX_MEDIA_BYTES || !MEDIA_TYPES.includes(normalizeMime(blob.type))) throw new Error('Choose a supported photo, audio or video file up to 50 MB.');
}
