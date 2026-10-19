'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Old links pointed at /settings#plan; the plan is now its own tab. */
export function LegacyHash() {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.hash === '#plan' && !url.searchParams.has('tab')) router.replace('/settings?tab=plan');
  }, [router]);
  return null;
}
