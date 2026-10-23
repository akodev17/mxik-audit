'use client';

import { useEffect } from 'react';
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
        <div aria-hidden className="absolute inset-0 overflow-hidden motion-safe:animate-fade-in" onPointerDown={(e) => e.preventDefault()}>
          {hole ? (
            // The cut-out casts the scrim as its own spread shadow: one element, rounded like the target,
            // and the overlay token in both themes.
            <div
              className="absolute rounded-md shadow-[0_0_0_200vmax_var(--color-overlay)] ring-2 ring-brand"
              style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            />
          ) : <div className="absolute inset-0 bg-overlay" />}
        </div>
        <TourCard hole={hole} />
      </div>
    </Portal>
  );
}
