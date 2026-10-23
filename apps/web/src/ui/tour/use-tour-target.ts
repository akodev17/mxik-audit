'use client';

// Tracks the current step's target on screen: waits for it, scrolls it into view once and follows it
// through resizes, scrolling and DOM changes. A tab that moves into the "more" menu is found again by its
// next key; a target that renders after the wait (a slow page) still gets its spotlight then.
import { useLayoutEffect, useState } from 'react';
import { findVisible, resolveTarget, sameRect, TARGET_WAIT_MS, type Rect } from './tour-target';

export type TargetState = { rect: Rect | null; searching: boolean };

function inView(r: DOMRect): boolean {
  const root = document.documentElement;
  return r.top >= 0 && r.left >= 0 && r.bottom <= root.clientHeight && r.right <= root.clientWidth;
}

/** The viewport rect of the first visible target of `keys`; null while searching or when none appears. */
export function useTourTarget(keys: readonly string[], active: boolean, spotlight: boolean, stepId: number): TargetState {
  const [state, setState] = useState<TargetState>({ rect: null, searching: false });
  const joined = keys.join(' ');

  useLayoutEffect(() => {
    if (!active || !spotlight || joined === '') {
      setState({ rect: null, searching: false });
      return;
    }
    const list = joined.split(' ');
    const started = performance.now();
    let element: HTMLElement | null = null;
    let scrolled = false;
    let poll = 0;
    let frame = 0;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    const mutations = new MutationObserver(() => schedule());

    function measure(): void {
      frame = 0;
      const next = resolveTarget(list, (key) => findVisible(key))?.found ?? null;
      if (next !== element) {
        if (element) observer?.unobserve(element);
        if (next) observer?.observe(next);
        element = next;
      }
      if (element && !scrolled) {
        scrolled = true;
        if (!inView(element.getBoundingClientRect())) element.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const box = element?.getBoundingClientRect();
      const rect = box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null;
      const searching = !element && performance.now() - started < TARGET_WAIT_MS;
      setState((cur) => (cur.searching === searching && sameRect(cur.rect, rect) ? cur : { rect, searching }));
      if (searching) poll = requestAnimationFrame(measure);
    }
    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    measure();
    mutations.observe(document.querySelector('.app') ?? document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(poll);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
      mutations.disconnect();
    };
  }, [active, spotlight, joined, stepId]);

  return state;
}
