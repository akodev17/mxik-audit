'use client';

import { useEffect, useState } from 'react';

/** Matches a media query on the client; false during server render and the first paint. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const sync = (): void => setMatches(list.matches);
    sync();
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, [query]);
  return matches;
}

/** Phone-width layout: cards instead of the grid, filters in a sheet, full-screen drawer. */
export const PHONE_QUERY = '(max-width: 767px)';
/** No hover and a coarse pointer: keyboard hints are noise. */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';
