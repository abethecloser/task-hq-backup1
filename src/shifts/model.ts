import type { Shift, ShiftCommand, ShiftContext, ShiftSnapshot, ShiftRecord } from './types.ts';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, normalizeMime } from './types.ts';
export interface DemoLedger { shifts: Shift[]; receipts: Record<string, { command: ShiftCommand; shift: Shift }> }
export const emptyLedger = (): DemoLedger => ({ shifts: [], receipts: {} });
const text = (data: Record<string, unknown>, key: string, max = 5000) => {
  const value = data[key] ?? '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${key}.`);
  return value.trim();
};
export function applyShift(ledger: DemoLedger, command: ShiftCommand, context: ShiftContext, now: number): { ledger: DemoLedger; shift: Shift } {
  const saved = ledger.receipts[command.id];
  if (saved) {
    if (JSON.stringify(saved.command) !== JSON.stringify(command)) throw new Error('This request ID already belongs to another action.');
    return { ledger, shift: saved.shift };
  }
  const next = structuredClone(ledger), at = new Date(now).toISOString(), data = command.data;
  let shift = command.shift_id ? next.shifts.find(item => item.id === command.shift_id && item.org_id === context.org) : undefined;
  if (shift && shift.employee !== context.actor && !(context.manager && command.action === 'adjust')) throw new Error('This shift belongs to another employee.');
  const record = (kind: string, value = text(data, 'text'), extra = data) => {
    const item: ShiftRecord = { id: command.id, shift_id: shift!.id, kind, text: value, author: context.actor, created_at: at, data: extra };
    shift!.records.push(item);
  };
  const bind = () => {
    const task = text(data, 'task_id', 200), project = text(data, 'project_id', 200);
    const found = context.tasks.find(item => item.id === task);
    if (task && (!found || (!context.manager && found.owner !== context.actor && found.approver !== context.actor))) throw new Error('Assigned work is not available.');
    if (project && !context.projects.some(item => item.id === project)) throw new Error('Job/site is not available.');
    if (task && project && found!.projectId !== project) throw new Error('Task and job do not match.');
    return { task_id: task, project_id: project || found?.projectId || '' };
  };
  if (command.action === 'check_in') {
    if (!context.canCheckIn) throw new Error('Only active operational members can check in.');
    if (next.shifts.some(item => item.org_id === context.org && item.employee === context.actor && item.state !== 'checked_out')) throw new Error('You already have an open shift. Refresh to resume it.');
    const focus = text(data, 'focus', 1000), binding = bind();
    if (!focus && !binding.task_id && !binding.project_id) throw new Error('Add a focus or choose assigned work or a job.');
    shift = { id: command.id, org_id: context.org, employee: context.actor, state: 'active', started_at: at, ended_at: null, checkout_requested_at: null, focus, ...binding, eod_draft: '', review_required: Number.isFinite(Date.parse(String(data.client_observed_at))) && Math.abs(now - Date.parse(String(data.client_observed_at))) > 300_000, records: [], media: [] };
    next.shifts.unshift(shift); record('check_in', focus);
  } else {
    if (!shift) throw new Error('Shift not found.');
    if (!['correction', 'adjust', 'finish_media', 'capture', 'reserve_media'].includes(command.action) && shift.state === 'checked_out') throw new Error('This shift is checked out. Use the correction process.');
    switch (command.action) {
      case 'context': Object.assign(shift, bind()); record('context', 'Active work context changed.'); break;
      case 'capture': {
        const binding = bind(), body = text(data, 'text'), media = text(data, 'media_id');
        if (!body && !media) throw new Error('Add a note or attachment.');
        if (media && !shift.media.some(item => item.id === media && item.status === 'ready')) throw new Error('Attachment upload is not confirmed.');
        record('capture', body, { ...data, ...binding }); break;
      }
      case 'request_checkout': shift.state = 'checkout_pending'; shift.checkout_requested_at ??= at; record('request_checkout', 'Checkout requested.'); break;
      case 'draft_eod': shift.eod_draft = text(data, 'text'); break;
      case 'submit_eod': {
        if (shift.state !== 'checkout_pending') throw new Error('Request checkout before submitting EOD.');
        if (shift.records.some(item => item.kind === 'eod')) throw new Error('EOD is already submitted. Use a correction for changes.');
        const body = text(data, 'text'), media = text(data, 'media_id');
        if (!body && !media) throw new Error('Add an EOD note or a successfully uploaded voice recording.');
        if (media && !shift.media.some(item => item.id === media && item.status === 'ready' && item.mime.startsWith('audio/'))) throw new Error('EOD voice upload is not confirmed.');
        record('eod', body); shift.eod_draft = ''; break;
      }
      case 'checkout':
        if (shift.state !== 'checkout_pending' || !shift.records.some(item => item.kind === 'eod')) throw new Error('Submit EOD successfully before normal checkout.');
        shift.state = 'checked_out'; shift.ended_at = at; record('checkout', 'Checkout confirmed.'); break;
      case 'exception_checkout':
        if (!text(data, 'text')) throw new Error('Explain why normal checkout is not possible.');
        shift.state = 'checked_out'; shift.ended_at = at; shift.review_required = true; record('exception_checkout'); break;
      case 'correction':
        if (!text(data, 'text')) throw new Error('Explain the requested correction.');
        shift.review_required = true; record('correction'); break;
      case 'adjust': {
        if (!context.manager) throw new Error('Only an organization manager can adjust timestamps.');
        const start = Date.parse(text(data, 'started_at')), end = Date.parse(text(data, 'ended_at'));
        if (!text(data, 'text') || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now) throw new Error('Supply valid past timestamps and a reason.');
        if (next.shifts.some(item => item.id !== shift!.id && item.org_id === shift!.org_id && item.employee === shift!.employee && start < (item.ended_at ? Date.parse(item.ended_at) : Infinity) && end > Date.parse(item.started_at))) throw new Error('This adjustment overlaps another shift.');
        record('adjustment', text(data, 'text'), { ...data, before: { started_at: shift.started_at, ended_at: shift.ended_at, state: shift.state } });
        shift.started_at = new Date(start).toISOString(); shift.ended_at = new Date(end).toISOString(); shift.state = 'checked_out'; shift.review_required = false; break;
      }
      case 'reserve_media': {
        const binding = bind(), mime = normalizeMime(text(data, 'mime')), bytes = Number(data.bytes), id = text(data, 'media_id');
        if (!id || !MEDIA_TYPES.includes(mime) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_MEDIA_BYTES) throw new Error('Unsupported media.');
        if (shift.media.some(item => item.id === id)) throw new Error('Media reservation already exists.');
        shift.media.push({ id, shift_id: shift.id, path: `${context.org}/${context.actor}/${shift.id}/${id}`, mime, bytes, status: 'pending', ...binding, created_at: at }); break;
      }
      case 'finish_media': {
        const media = shift.media.find(item => item.id === data.media_id);
        if (!media) throw new Error('Media reservation not found.');
        // Demo backend checks the durable blob before calling the reducer.
        media.status = 'ready'; break;
      }
      default: throw new Error('Unknown shift action.');
    }
  }
  next.receipts[command.id] = { command: structuredClone(command), shift: structuredClone(shift) };
  return { ledger: next, shift };
}
export function shiftSnapshot(ledger: DemoLedger, context: ShiftContext, now: number, team = false): ShiftSnapshot {
  return { shifts: ledger.shifts.filter(item => item.org_id === context.org && (item.employee === context.actor || (team && context.manager))), server_now: new Date(now).toISOString(), can_manage: context.manager };
}
export function shiftInsights(shift: Shift, context: Pick<ShiftContext, 'tasks' | 'events'>, now: number) {
  const start = Date.parse(shift.started_at), end = shift.ended_at ? Date.parse(shift.ended_at) : now;
  const owned = context.tasks.filter(task => task.owner === shift.employee);
  const ids = new Set(owned.map(task => task.id));
  return {
    elapsed: end >= start ? end - start : null,
    missed: shift.state !== 'checked_out' && now - start > 16 * 3_600_000,
    updates: new Set(context.events.filter(event => !event.undone && event.taskId && ids.has(event.taskId) && event.at >= start && event.at <= end).map(event => event.id)).size,
    completed: owned.filter(task => task.status === 'done' && task.completedAt !== null && task.completedAt >= start && task.completedAt <= end).length,
    blocked: owned.filter(task => task.status === 'blocked').length,
    captures: shift.records.filter(item => item.kind === 'capture').length,
    eod: shift.records.some(item => item.kind === 'eod'),
  };
}
