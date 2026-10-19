'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';
import { IconChevron } from './icons';

export type Crumb = { label: string; href?: string };

type Props = {
  /** Ancestors first; the last item is the current page and is not a link. */
  items: Crumb[];
  /** Name of the navigation landmark; defaults to the translated "Page path". */
  label?: string;
  className?: string;
};

/** Where this page sits: nav landmark, ordered list, aria-current on the last item. */
export function Breadcrumbs({ items, label, className }: Props) {
  const { ta } = useI18n();
  if (items.length === 0) return null;
  const last = items.length - 1;
  return (
    <nav aria-label={label ?? ta.shellX.ui.breadcrumbs} className={cx('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-small text-muted">
        {items.map((item, i) => (
          <li key={`${i}-${item.label}`} className="flex min-w-0 items-center gap-1">
            {i === last || !item.href ? (
              <span aria-current={i === last ? 'page' : undefined} className={cx('max-w-[24ch] truncate', i === last && 'text-fg')}>{item.label}</span>
            ) : (
              <Link href={item.href} className="max-w-[24ch] truncate rounded-sm hover:text-fg hover:underline">{item.label}</Link>
            )}
            {i < last ? <IconChevron size={12} className="shrink-0 text-subtle" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
