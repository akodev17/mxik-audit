'use client';

// Temporary dev and QA trigger: /dashboard?tour=1 opens the tour. T1.4 removes it with the first-login start.
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isActive } from '../shell/nav';
import { useTour } from './tour-context';

export function TourDevTrigger() {
  const params = useSearchParams();
  const pathname = usePathname();
  const { start } = useTour();
  const fired = useRef(false);
  const wanted = params.get('tour') === '1' && isActive(pathname, '/dashboard');

  useEffect(() => {
    if (!wanted || fired.current) return;
    fired.current = true;
    start();
  }, [wanted, start]);

  return null;
}
