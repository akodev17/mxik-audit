'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { navigationPending, subscribeNavigation } from './same-route-links';

type Phase = 'idle' | 'reset' | 'run' | 'end';

/** Width, opacity and their transitions per phase. Opacity waits 150 ms, so a commit within a frame or two leaves no trace. */
const STYLE: Record<Phase, CSSProperties> = {
  idle: { width: '0%', opacity: 0, transition: 'none' },
  reset: { width: '0%', opacity: 0, transition: 'none' },
  // Fast at first, then slower and slower: it never reaches the end on its own.
  run: { width: '85%', opacity: 1, transition: 'width 8s cubic-bezier(.08,.7,.2,1), opacity 150ms linear 150ms' },
  end: { width: '100%', opacity: 0, transition: 'width 200ms ease-out, opacity 200ms linear 180ms' },
};

/**
 * A thin bar along the top of the page while a watched navigation (./same-route-links) has not
 * committed. Pages that change their query in place (settings tabs, workspace filters: see
 * ./navigation) keep the old content until the new one is ready, so this is their sign that the
 * click was taken, as for a click that waits for a page fetched ahead. It grows while waiting, runs
 * to the end and fades when the page commits.
 */
export function NavigationProgress() {
  const busy = useSyncExternalStore(subscribeNavigation, navigationPending, () => false);
  const [phase, setPhase] = useState<Phase>('idle');
  const running = useRef(false);

  useEffect(() => {
    if (busy) {
      running.current = true;
      setPhase('reset');
      // Two frames: the reset must be painted before the growth starts, or the bar jumps.
      let second = 0;
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setPhase('run')); });
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }
    if (!running.current) return;
    running.current = false;
    setPhase('end');
    const done = setTimeout(() => setPhase('idle'), 450);
    return () => clearTimeout(done);
  }, [busy]);

  return (
    <span
      aria-hidden
      data-navigation-pending={busy ? '' : undefined}
      className="pointer-events-none absolute inset-x-0 top-0 z-dropdown h-0.5"
    >
      <span className="block h-full rounded-r-full bg-brand shadow-[0_0_8px_var(--color-brand)]" style={STYLE[phase]} />
    </span>
  );
}
