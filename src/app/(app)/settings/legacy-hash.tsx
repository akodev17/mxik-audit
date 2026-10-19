'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { goTo } from '@/ui/shell/same-route-links';

/** Old links pointed at /settings#plan; the plan is now its own tab. */
export function LegacyHash() {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.hash === '#plan' && !url.searchParams.has('tab')) goTo('/settings?tab=plan', (href) => router.replace(href));
  }, [router]);
  return null;
}
