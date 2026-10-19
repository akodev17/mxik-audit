import type { ReactNode } from 'react';

/**
 * Text for screen readers only. Pinned to the top-left of its containing block, so it can never
 * widen or lengthen the page when no ancestor is positioned (the plain sr-only class can).
 */
export function VisuallyHidden({ children, id }: { children: ReactNode; id?: string }) {
  return <span id={id} className="sr-only top-0 left-0">{children}</span>;
}
