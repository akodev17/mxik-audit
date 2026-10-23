// Where the tour card goes: beside the spotlight (bottom, top, right, left, in that order), else centred.
import type { Rect } from './tour-target';

export type CardSide = 'bottom' | 'top' | 'right' | 'left' | 'center';
export type CardPlacement = { side: CardSide; top: number; left: number };
type Size = { width: number; height: number };

export const CARD_GAP = 12;
export const CARD_GUTTER = 16;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * The first side where the whole card fits between the target and the viewport's gutter, sliding it
 * along that side to stay inside; centred in the viewport when there is no target or no side fits.
 */
export function placeCard(target: Rect | null, card: Size, viewport: Size, gap = CARD_GAP, gutter = CARD_GUTTER): CardPlacement {
  const maxLeft = viewport.width - gutter - card.width;
  const maxTop = viewport.height - gutter - card.height;
  const centred: CardPlacement = {
    side: 'center',
    left: Math.round(clamp((viewport.width - card.width) / 2, gutter, maxLeft)),
    top: Math.round(clamp((viewport.height - card.height) / 2, gutter, maxTop)),
  };
  if (!target) return centred;

  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const alongX = clamp(target.left + target.width / 2 - card.width / 2, gutter, maxLeft);
  const alongY = clamp(target.top + target.height / 2 - card.height / 2, gutter, maxTop);
  const fitsX = card.width <= viewport.width - 2 * gutter;
  const fitsY = card.height <= viewport.height - 2 * gutter;

  const sides: [CardSide, boolean, number, number][] = [
    ['bottom', fitsX && bottom + gap + card.height <= viewport.height - gutter, bottom + gap, alongX],
    ['top', fitsX && target.top - gap - card.height >= gutter, target.top - gap - card.height, alongX],
    ['right', fitsY && right + gap + card.width <= viewport.width - gutter, alongY, right + gap],
    ['left', fitsY && target.left - gap - card.width >= gutter, alongY, target.left - gap - card.width],
  ];
  const hit = sides.find(([, fits]) => fits);
  return hit ? { side: hit[0], top: Math.round(hit[2]), left: Math.round(hit[3]) } : centred;
}
