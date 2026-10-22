'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { Menu } from '../menu';
import { fittingTabs, isActive } from './nav';
import { useNav } from './nav-items';

/** Destinations shown as tabs. Upload, help and settings live in the left rail (the account menu repeats settings and help). */
const TAB_KEYS = new Set(['dashboard', 'queue', 'clients', 'team', 'catalogs', 'dictionary', 'activity']);

const TAB = 'relative flex items-center px-2.5 text-data font-medium transition-colors duration-(--duration-fast) focus-visible:rounded-ctl';
const UNDERLINE = 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand';

/**
 * The one primary navigation (from md): a row of tabs in the header. The current section is
 * underlined; a long label ("Koʻrib chiqish navbati") has a short tab form. Tabs that do not fit the
 * window move, in order, into a "more" menu at the end of the row, which is underlined when it holds
 * the current section. An invisible copy of the row measures every tab, so the split follows resizes.
 */
export function TopNav({ canWrite, canTeam, activePath }: { canWrite: boolean; canTeam: boolean; activePath?: string }) {
  const { ta } = useI18n();
  const current = usePathname();
  const pathname = activePath ?? current;
  const tabs = useNav(canWrite, canTeam).flatMap((g) => g.items).filter((i) => TAB_KEYS.has(i.key));
  const nav = useRef<HTMLElement>(null);
  const row = useRef<HTMLUListElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  // Before the first measurement (server render) every tab is in the row; the row clips, never scrolls.
  const [fit, setFit] = useState(tabs.length);

  useLayoutEffect(() => {
    const box = nav.current;
    const ul = row.current;
    const measure = ruler.current;
    if (!box || !ul || !measure) return;
    const update = (): void => {
      // The nav, not the row: the row narrows when the more button appears.
      const style = getComputedStyle(ul);
      const available = box.clientWidth - parseFloat(getComputedStyle(box).paddingRight) - parseFloat(style.paddingLeft);
      const gap = parseFloat(style.columnGap) || 0;
      const cells = [...measure.children] as HTMLElement[];
      const widths = cells.slice(0, -1).map((cell) => cell.getBoundingClientRect().width);
      const more = cells.at(-1)?.getBoundingClientRect().width ?? 0;
      setFit(fittingTabs(widths, available, more, gap));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tabs.length, ta]);

  const label = (key: string, full: string): string => (key === 'queue' ? ta.shellX.nav.queueTab : full);
  const shown = tabs.slice(0, fit);
  const rest = tabs.slice(fit);
  const restActive = rest.some((item) => isActive(pathname, item.href));

  return (
    <nav ref={nav} aria-label={ta.shellX.nav.label} className="relative hidden min-w-0 flex-1 self-stretch pr-2 md:flex lg:pr-3">
      <ul ref={row} className="flex h-full min-w-0 items-stretch gap-0.5 overflow-hidden pl-2 lg:gap-1 lg:pl-3">
        {shown.map((item) => {
          const active = isActive(pathname, item.href);
          const text = label(item.key, item.label);
          return (
            <li key={item.key} className="flex shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={text === item.label ? undefined : item.label}
                className={cx(TAB, active ? cx('text-fg', UNDERLINE) : 'text-muted hover:text-fg')}
              >
                {text}
              </Link>
            </li>
          );
        })}
      </ul>
      {rest.length ? (
        <div className={cx('relative ml-0.5 flex shrink-0 items-center lg:ml-1', restActive && UNDERLINE)}>
          <Menu
            label={ta.shellX.nav.more}
            align="end"
            triggerClassName={cx(TAB, 'h-9 gap-1 rounded-ctl', restActive ? 'text-fg' : 'text-muted hover:text-fg')}
            items={rest.map((item) => ({ label: item.label, href: item.href, icon: item.icon, current: isActive(pathname, item.href) }))}
          />
        </div>
      ) : null}
      {/* Same classes as the tabs, so the widths match; the last cell is the more button. */}
      <div ref={ruler} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex whitespace-nowrap">
        {tabs.map((item) => <span key={item.key} className={TAB}>{label(item.key, item.label)}</span>)}
        <span className={cx(TAB, 'gap-1')}>{ta.shellX.nav.more}<span className="inline-block w-3.5" /></span>
      </div>
    </nav>
  );
}
