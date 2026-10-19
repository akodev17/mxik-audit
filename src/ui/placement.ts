// Viewport collision handling for panels anchored to a trigger (Popover, Menu).

export type Side = 'top' | 'bottom';
export type Align = 'start' | 'end';

export type Box = { top: number; bottom: number; left: number; right: number };
export type Size = { width: number; height: number };

/** Side to open on, and the panel's left edge relative to the anchor's left edge (px). */
export type Placement = { side: Side; x: number };

export const PANEL_GAP = 4;
export const VIEWPORT_MARGIN = 8;

/**
 * Keeps the preferred side unless the panel does not fit there and fits (or has more room) on the
 * other; then shifts it horizontally so it stays `margin` px inside the viewport, pinning it to the
 * left margin when it is wider than the viewport allows.
 */
export function placePanel(
  anchor: Box,
  panel: Size,
  viewport: Size,
  prefer: { side: Side; align: Align },
  gap = PANEL_GAP,
  margin = VIEWPORT_MARGIN,
): Placement {
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const [room, other] = prefer.side === 'bottom' ? [below, above] : [above, below];
  const flip = panel.height > room && (panel.height <= other || other > room);
  const side: Side = flip ? (prefer.side === 'bottom' ? 'top' : 'bottom') : prefer.side;

  const ideal = prefer.align === 'end' ? anchor.right - panel.width : anchor.left;
  const left = Math.max(margin, Math.min(ideal, viewport.width - margin - panel.width));
  return { side, x: Math.round(left - anchor.left) };
}
