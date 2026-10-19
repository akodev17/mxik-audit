import type { ReactNode } from 'react';
import { cx } from './cx';

/** A key the user presses, e.g. <Kbd>J</Kbd>; group several with plain text between them. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx(
      'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface px-1',
      'font-mono text-micro font-medium text-muted shadow-[inset_0_-1px_0_var(--color-line-strong)]',
      className,
    )}>
      {children}
    </kbd>
  );
}
