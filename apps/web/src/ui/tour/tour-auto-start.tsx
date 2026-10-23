'use client';

// Opens the tour by itself once, for a user who has neither finished nor skipped it, and only on the
// dashboard: a deep link (an invite, a shared catalogue) lands on its page without an overlay.
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isActive } from '../shell/nav';
import { useTour } from './tour-context';

/** How long the dashboard has been on screen before the tour covers it. */
const SETTLE_MS = 600;

export function TourAutoStart({ pending }: { pending: boolean }) {
  const pathname = usePathname();
  const { start } = useTour();
  const fired = useRef(false);
  const wanted = pending && isActive(pathname, '/dashboard');

  useEffect(() => {
    if (!wanted || fired.current) return;
    let timer = 0;
    const attempt = (): void => {
      // Another dialog owns the screen (a confirmation, the palette): wait until it closes.
      if (document.querySelector('.app [aria-modal="true"]')) {
        timer = window.setTimeout(attempt, SETTLE_MS);
        return;
      }
      fired.current = true;
      start();
    };
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [wanted, start]);

  return null;
}
