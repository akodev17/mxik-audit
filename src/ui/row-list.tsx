import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * An open list: hairlines between rows and none around the list. For secondary content (recent
 * activity, ranked issues) that must not look like a table or compete with the primary work.
 */
export function RowList({ children, className, ordered = false }: { children: ReactNode; className?: string; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return <Tag className={cx('divide-y divide-line border-y border-line', className)}>{children}</Tag>;
}
