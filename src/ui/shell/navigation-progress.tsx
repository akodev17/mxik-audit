'use client';

import { useSyncExternalStore } from 'react';
import { cx } from '../cx';
import { navigationPending, subscribeNavigation } from './same-route-links';

/**
 * A thin bar along the top of the page while a watched navigation (./same-route-links) has not
 * committed. Pages that change their query in place (settings tabs, workspace filters: see
 * ./navigation) keep the old content until the new one is ready, so this is their sign that the
 * click was taken. It fades in after a moment (CSS delay), so a page served from memory shows nothing.
 */
export function NavigationProgress() {
  const busy = useSyncExternalStore(subscribeNavigation, navigationPending, () => false);
  return (
    <span
      aria-hidden
      className={cx(
        'pointer-events-none absolute inset-x-0 top-0 z-dropdown h-0.5 bg-brand transition-opacity',
        busy ? 'opacity-100 delay-150 duration-200 motion-safe:animate-pulse' : 'opacity-0 duration-0',
      )}
    />
  );
}
