'use client';

import { useEffect, useReducer } from 'react';
import { isServerResponse, settleNudge, type Timer } from './navigation';

/**
 * Delays after a response: soon, and once more later in case React reached the held state only
 * after the first nudge.
 */
const NUDGE_DELAYS_MS = [50, 1000];

const timer: Timer = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * Lets refreshes and server actions commit where React would hold them (see ./navigation): after
 * each server response it makes an unrelated state update, which retries a transition React stopped
 * waiting on. When nothing is held, a nudge only re-renders this empty component.
 */
export function ResponseNudge(): null {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('resource')) return;
    const nudges = NUDGE_DELAYS_MS.map((ms) => settleNudge(tick, ms, timer));
    // A resource entry is reported once the whole body has arrived.
    const observer = new PerformanceObserver((list) => {
      const origin = window.location.origin;
      if (!list.getEntries().some((entry) => isServerResponse(entry as PerformanceResourceTiming, origin))) return;
      for (const nudge of nudges) nudge.responded();
    });
    observer.observe({ type: 'resource' });
    return () => {
      observer.disconnect();
      for (const nudge of nudges) nudge.stop();
    };
  }, []);
  return null;
}
