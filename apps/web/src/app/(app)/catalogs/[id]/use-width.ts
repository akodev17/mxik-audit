'use client';

import { useEffect, useState } from 'react';

/** An element's inner width in px, kept current with a ResizeObserver; null until measured. */
export function useWidth(el: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [el]);
  return width;
}
