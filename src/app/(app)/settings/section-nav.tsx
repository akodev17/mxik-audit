import Link from 'next/link';
import { cx } from '@/ui/cx';
import { Tabs } from '@/ui/tabs';
import { TabStrip } from './tab-strip';

export type SectionLink = { href: string; label: string; active: boolean };

/**
 * The settings sections. From md a vertical menu beside the content (sticky, so it stays in view while a
 * long section scrolls); on a phone the same links are the scrolling tab row above it. Both are plain links
 * to ?tab=…, so the open section survives reloads, history and direct URLs; only one of the two is rendered
 * for the browser (the other is display:none), so each section is listed once for assistive technology.
 */
export function SectionNav({ label, items }: { label: string; items: SectionLink[] }) {
  return (
    <>
      <div className="md:hidden">
        <TabStrip label={label}>
          <Tabs items={items} />
        </TabStrip>
      </div>
      <nav aria-label={label} className="hidden md:sticky md:top-6 md:block md:self-start">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={cx(
                  'relative flex h-9 items-center rounded-ctl px-3 text-data font-medium transition-colors duration-(--duration-fast)',
                  item.active
                    ? 'bg-surface text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand'
                    : 'text-muted hover:bg-surface hover:text-fg',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
