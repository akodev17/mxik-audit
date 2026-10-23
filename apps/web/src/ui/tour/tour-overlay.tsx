'use client';

import { useEffect, useId } from 'react';
import { useEscape, useScrollLock } from '../overlay';
import { Portal } from '../portal';
import { useMediaQuery } from '../shell/use-media-query';
import { TourCard } from './tour-card';
import { useTour, useTourMode } from './tour-context';
import { spotlightRect } from './tour-target';
import { useTourTarget } from './use-tour-target';

/**
 * The tour's modal layer: the page dimmed with the overlay token, a cut-out over the current step's
 * target, and the card beside it. The target stays visible but cannot be clicked (the tour is modal).
 * Below md the tabs sit in a closed drawer, so every step is a centred card there.
 */
export function TourOverlay() {
  const tour = useTour();
  const setMode = useTourMode();
  const wide = useMediaQuery('(min-width: 768px)', true);
  const maskId = `tour-mask-${useId().replace(/[^\w-]/g, '')}`;
  const { rect } = useTourTarget(tour.step?.targets ?? [], tour.open, wide, tour.index);

  useScrollLock(tour.open);
  useEscape(tour.open, tour.skip);
  const mode = rect ? 'spotlight' : 'centred';
  useEffect(() => setMode(mode), [mode, setMode]);

  if (!tour.open || !tour.step) return null;
  const hole = rect ? spotlightRect(rect, { width: window.innerWidth, height: window.innerHeight }) : null;

  return (
    <Portal>
      <div className="fixed inset-0 z-modal">
        {/* Swallows every press on the page behind, and keeps focus in the card. */}
        <div aria-hidden className="absolute inset-0 motion-safe:animate-fade-in" onPointerDown={(e) => e.preventDefault()}>
          {hole ? (
            <svg className="pointer-events-none absolute inset-0 size-full">
              <defs>
                <mask id={maskId}>
                  <rect width="100%" height="100%" fill="white" />
                  <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={8} fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" className="fill-overlay" mask={`url(#${maskId})`} />
            </svg>
          ) : <div className="absolute inset-0 bg-overlay" />}
          {hole ? (
            <div
              className="pointer-events-none absolute rounded-md ring-2 ring-brand"
              style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            />
          ) : null}
        </div>
        <TourCard hole={hole} />
      </div>
    </Portal>
  );
}
