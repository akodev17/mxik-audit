import Link from 'next/link';
import { cx } from './cx';

export type TabItem = { href: string; label: string; active: boolean; count?: number };

/** Link-based tabs: the active one is a URL, so it survives reloads. */
export function Tabs({ items }: { items: TabItem[] }) {
  return (
    <nav className="flex gap-1 border-b border-line">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? 'page' : undefined}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            i.active ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {i.label}
          {i.count !== undefined ? <span className="ml-1.5 text-xs text-muted">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
