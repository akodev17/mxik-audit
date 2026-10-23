'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../button';
import { cx } from '../cx';
import { trapTab } from '../focus';
import { IconArrowRight } from '../icons';
import { useReturnFocus } from '../overlay';
import { useTour } from './tour-context';
import { useTourCopy } from './tour-copy';
import { placeCard, type CardPlacement } from './tour-place';
import type { Rect } from './tour-target';

/**
 * The tour's dialog: counter, title, one or two sentences, an optional link to the section, and
 * Skip / Back / Next. Placed beside the spotlight (or centred); Tab stays inside, arrows step,
 * focus starts on Next and returns to the opener when the tour closes.
 */
export function TourCard({ hole }: { hole: Rect | null }) {
  const tour = useTour();
  const copy = useTourCopy();
  const card = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [place, setPlace] = useState<CardPlacement | null>(null);
  const { index, steps, step, next, back, skip } = tour;
  const last = index === steps.length - 1;

  useReturnFocus(true, card);

  const top = hole?.top;
  const left = hole?.left;
  const width = hole?.width;
  const height = hole?.height;
  useLayoutEffect(() => {
    const target = top === undefined || left === undefined || width === undefined || height === undefined ? null : { top, left, width, height };
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const box = card.current;
      if (!box) return;
      const root = document.documentElement;
      const next = placeCard(target, { width: box.offsetWidth, height: box.offsetHeight }, { width: root.clientWidth, height: root.clientHeight });
      setPlace((cur) => (cur && cur.side === next.side && cur.top === next.top && cur.left === next.left ? cur : next));
    };
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (card.current) observer?.observe(card.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [top, left, width, height, index]);

  // Next takes focus once the card is placed, and again whenever focus has left it (Back vanishing on step 1).
  const placed = place !== null;
  useEffect(() => {
    if (placed && !card.current?.contains(document.activeElement)) nextButton.current?.focus({ preventScroll: true });
  }, [placed, index]);

  // Capture phase: page shortcuts must not see Tab or the arrows while the tour is modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const box = card.current;
      if (!box) return;
      if (e.key === 'Tab') {
        trapTab(e, box);
        e.stopPropagation();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowRight') next();
      else back();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, back]);

  if (!step) return null;
  const words = copy.steps[step.key];

  return (
    <div
      ref={card}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
      className={cx(
        'fixed w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border border-line bg-raised p-5 text-fg shadow-overlay',
        'focus-visible:outline-none motion-safe:animate-pop-in',
      )}
    >
      <p aria-live="polite" className="text-small font-medium tabular-nums text-muted">{copy.counter(index + 1, steps.length)}</p>
      <h2 id={titleId} className="mt-1 text-h2">{words.title}</h2>
      <p id={bodyId} className="mt-1.5 text-body text-muted">{words.body}</p>
      {step.href ? (
        <Link href={step.href} className="mt-3 inline-flex items-center gap-1 text-small font-medium text-brand-ink hover:underline">
          {copy.open}
          <IconArrowRight size={14} aria-hidden />
        </Link>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {last ? null : <Button variant="ghost" size="sm" onClick={skip} className="-ml-2">{copy.skip}</Button>}
        <span className="ml-auto flex gap-2">
          {index > 0 ? <Button variant="secondary" size="sm" onClick={back}>{copy.back}</Button> : null}
          <Button ref={nextButton} variant="primary" size="sm" onClick={next}>{last ? copy.done : copy.next}</Button>
        </span>
      </div>
    </div>
  );
}
