'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Live result of a media query; `serverValue` is used for the server render and hydration. */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}
