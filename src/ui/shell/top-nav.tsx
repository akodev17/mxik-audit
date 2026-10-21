'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { useIntentPrefetch } from './intent-prefetch';
import { isActive } from './nav';
import { useNav } from './nav-items';

/** Destinations shown as tabs; upload, help and settings live in the rail. */
const TAB_KEYS = new Set(['dashboard', 'queue', 'clients', 'team', 'catalogs', 'dictionary', 'activity']);

/**
 * Primary navigation as a row of tabs in the header (from md). The current section is underlined; the
 * row scrolls sideways when the window is too narrow for every label.
 */
export function TopNav({ canWrite, canTeam, activePath }: { canWrite: boolean; canTeam: boolean; activePath?: string }) {
  const { ta } = useI18n();
  const current = usePathname();
  const pathname = activePath ?? current;
  const tabs = useNav(canWrite, canTeam).flatMap((g) => g.items).filter((i) => TAB_KEYS.has(i.key));
  const intent = useIntentPrefetch();
  return (
    <nav aria-label={ta.shellX.nav.label} className="hidden min-w-0 flex-1 self-stretch md:block">
      <ul className="flex h-full items-stretch gap-1 overflow-x-auto px-3 [scrollbar-width:none] lg:gap-2 lg:px-4 [&::-webkit-scrollbar]:hidden">
        {tabs.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key} className="flex shrink-0">
              <Link
                href={item.href}
                {...intent(item.href)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex items-center px-2 text-data font-medium transition-colors duration-(--duration-fast) focus-visible:rounded-ctl',
                  active
                    ? 'text-fg after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-fg'
                    : 'text-muted hover:text-fg',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
