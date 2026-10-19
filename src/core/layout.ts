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
