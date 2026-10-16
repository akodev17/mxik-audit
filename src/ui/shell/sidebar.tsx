'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { cx } from '../cx';
import { IconGear, IconTable, IconUpload, IconUsers, IconMenu } from '../icons';

const ITEMS = [
  { href: '/clients', label: ta.nav.clients, icon: <IconUsers /> },
  { href: '/catalogs', label: ta.nav.catalogs, icon: <IconTable /> },
  { href: '/upload', label: ta.nav.upload, icon: <IconUpload /> },
  { href: '/settings', label: ta.nav.settings, icon: <IconGear /> },
] as const;

type Props = { collapsed: boolean; onToggle: () => void };

export function Sidebar({ collapsed, onToggle }: Props) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Asosiy"
      className={cx('no-print flex shrink-0 flex-col border-r border-line bg-surface transition-[width]', collapsed ? 'w-14' : 'w-56')}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <button
          type="button" onClick={onToggle}
          aria-label={collapsed ? ta.shell.expand : ta.shell.collapse}
          className="grid size-8 shrink-0 place-items-center rounded-ctl text-muted hover:bg-line hover:text-fg"
        >
          <IconMenu />
        </button>
        {collapsed ? null : <Link href="/catalogs" className="truncate text-[17px] font-bold tracking-tight">{t.appName}</Link>}
      </div>
      <ul className="mt-2 flex flex-col gap-0.5 px-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-10 items-center gap-3 rounded-ctl px-2.5 text-[15px] font-medium',
                  active ? 'bg-base text-brand shadow-[inset_3px_0_0_var(--color-brand)]' : 'text-muted hover:bg-line hover:text-fg',
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                {collapsed ? null : <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
