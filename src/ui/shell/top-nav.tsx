'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { isActive } from './nav';
import { useNav } from './nav-items';

/** Destinations shown as tabs. Upload is a button beside them; help sits in the account menu, which also repeats settings. */
const TAB_KEYS = new Set(['dashboard', 'queue', 'clients', 'team', 'catalogs', 'dictionary', 'activity', 'settings']);

/**
 * The one primary navigation (from md): a row of tabs in the header. The current section is
 * underlined; a long label ("Koʻrib chiqish navbati") has a short tab form; the row scrolls sideways
 * when the window is too narrow for every tab.
 */
export function TopNav({ canWrite, canTeam, activePath }: { canWrite: boolean; canTeam: boolean; activePath?: string }) {
  const { ta } = useI18n();
  const current = usePathname();
  const pathname = activePath ?? current;
  const tabs = useNav(canWrite, canTeam).flatMap((g) => g.items).filter((i) => TAB_KEYS.has(i.key));
  return (
    <nav aria-label={ta.shellX.nav.label} className="hidden min-w-0 flex-1 self-stretch md:block">
      <ul className="flex h-full items-stretch gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] lg:gap-1 lg:px-3 [&::-webkit-scrollbar]:hidden">
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          const label = item.key === 'queue' ? ta.shellX.nav.queueTab : item.label;
          return (
            <li key={item.key} className="flex shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={label === item.label ? undefined : item.label}
                className={cx(
                  'relative flex items-center px-2.5 text-data font-medium transition-colors duration-(--duration-fast) focus-visible:rounded-ctl',
                  active
                    ? 'text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand'
                    : 'text-muted hover:text-fg',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
