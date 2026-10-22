'use client';

import { useSyncExternalStore } from 'react';
import { cx } from '../cx';
import { navigationPending, subscribeNavigation } from './same-route-links';

/**
 * A thin bar along the top of the page while a watched navigation (./same-route-links) has not
 * committed. Pages that change their query in place (settings tabs, workspace filters: see
 * ./navigation) keep the old content until the new one is ready, so this is their sign that the
 * click was taken, as for a click that waits for a page fetched ahead. It fades in from the first
 * frame, so a page served from memory, which commits within a frame or two, leaves no visible trace.
 */
export function NavigationProgress() {
  const busy = useSyncExternalStore(subscribeNavigation, navigationPending, () => false);
  return (
    <span
      aria-hidden
      data-navigation-pending={busy ? '' : undefined}
      className={cx(
        'pointer-events-none absolute inset-x-0 top-0 z-dropdown h-0.5 bg-brand transition-opacity',
        busy ? 'opacity-100 duration-200 motion-safe:animate-pulse' : 'opacity-0 duration-0',
      )}
    />
  );
}
