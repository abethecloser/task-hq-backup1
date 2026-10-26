// Desktop panel geometry. The left workspace panel and the right panel (instrument deck or task)
// keep independent open state; this only decides how each is shown, never whether it is open.
// When both are open and room is short, the left panel gives up width first (down to its minimum);
// a right panel that still can't dock beside the canvas opens as an overlay drawer instead.
// On mobile both are drawers.

export const RAIL = 56;

export interface PanelInput {
  viewport: number;
  mobile: boolean;
  leftOpen: boolean;
  /** The left panel's chosen width, and the narrowest it may shrink to while the right panel is docked. */
  leftWidth: number;
  leftMin: number;
  rightOpen: boolean;
  rightWidth: number;
  /** Narrowest center canvas beside a docked right panel, and (smaller) when the left panel is open too. */
  minCanvas: number;
  minCanvasBoth: number;
}

export interface PanelLayout {
  /** Width the left panel occupies (0 when closed or on mobile). */
  left: number;
  right: 'docked' | 'drawer' | 'closed';
}

export function panelLayout(input: PanelInput): PanelLayout {
  if (input.mobile) return { left: 0, right: input.rightOpen ? 'drawer' : 'closed' };
  const left = input.leftOpen ? input.leftWidth : 0;
  if (!input.rightOpen) return { left, right: 'closed' };
  const room = input.viewport - RAIL - input.rightWidth - (input.leftOpen ? input.minCanvasBoth : input.minCanvas);
  const narrowest = input.leftOpen ? Math.min(input.leftMin, input.leftWidth) : 0;
  if (room < narrowest) return { left, right: 'drawer' };
  return { left: input.leftOpen ? Math.min(input.leftWidth, room) : 0, right: 'docked' };
}

// ── Pullouts ──────────────────────────────────────────────────────────────────────────────────
// Two pullouts, one each side of the center: the calendar quick view (left, opened by the rail's
// Calendar icon) and notifications (right, opened by the bell). Both start closed. Both may be
// open on a wide desktop only while the center stays usable; otherwise opening one closes the
// other. On a phone only one panel (these two, or the navigation menu) is ever shown at a time.

export type Pullout = 'calendar' | 'notifications';
export interface Pullouts { calendar: boolean; notifications: boolean }
export const PULLOUTS_CLOSED: Pullouts = { calendar: false, notifications: false };

export interface PulloutRoom {
  viewport: number;
  mobile: boolean;
  /** Widths each pullout takes when docked. */
  calendarWidth: number;
  notificationsWidth: number;
  /** Narrowest center canvas with both pullouts docked. */
  minCanvasBoth: number;
  /** Narrowest center canvas with one pullout docked. */
  minCanvas: number;
}

const other = (which: Pullout): Pullout => (which === 'calendar' ? 'notifications' : 'calendar');

/** Both pullouts fit side by side with a usable center. */
export function bothFit(room: PulloutRoom): boolean {
  return !room.mobile && room.viewport - RAIL - room.calendarWidth - room.notificationsWidth >= room.minCanvasBoth;
}

export function openPullout(current: Pullouts, which: Pullout, room: PulloutRoom): Pullouts {
  const next = { ...current, [which]: true };
  if (current[other(which)] && !bothFit(room)) next[other(which)] = false;
  return next;
}

export function togglePullout(current: Pullouts, which: Pullout, room: PulloutRoom): Pullouts {
  return current[which] ? { ...current, [which]: false } : openPullout(current, which, room);
}

/** How an open pullout is shown: docked beside the center when it fits, otherwise over it. */
export function pulloutMode(which: Pullout, current: Pullouts, room: PulloutRoom): 'closed' | 'docked' | 'drawer' {
  if (!current[which]) return 'closed';
  if (room.mobile) return 'drawer';
  const width = which === 'calendar' ? room.calendarWidth : room.notificationsWidth;
  const both = current.calendar && current.notifications;
  const used = both ? room.calendarWidth + room.notificationsWidth : width;
  return room.viewport - RAIL - used >= (both ? room.minCanvasBoth : room.minCanvas) ? 'docked' : 'drawer';
}
