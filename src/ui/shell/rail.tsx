'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from '../cx';
import { IconBell, IconUpload } from '../icons';
import { Tooltip } from '../tooltip';
import { isActive } from './nav';
import { useNav } from './nav-items';

const ICON = 'relative grid size-9 place-items-center rounded-ctl transition-colors duration-(--duration-fast)';
const IDLE = 'text-muted hover:bg-surface hover:text-fg';
const CURRENT = 'bg-surface text-fg';

function RailLink({ href, label, active, children, className }: { href: string; label: string; active: boolean; children: ReactNode; className?: string }) {
  return (
    <Tooltip content={label} side="right" describe={false}>
      <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} className={cx(ICON, active ? CURRENT : IDLE, className)}>
        {children}
      </Link>
    </Tooltip>
  );
}

/**
 * The left sidebar (from md; a permanent part of the layout, below md the same destinations open in the
 * drawer). It carries the utilities that are not header tabs: notifications, help and settings at the top, and
 * "upload a catalogue" at the bottom for people who may upload. Icons share one size and hover state,
 * each has a text name and a tooltip, and the border on its right edge separates it from the page.
 */
export function Rail({ canWrite, canTeam, canUpload, unread, activePath }: {
  canWrite: boolean; canTeam: boolean; canUpload: boolean; unread: number | null; activePath?: string;
}) {
  const { ta } = useI18n();
  const current = usePathname();
  const pathname = activePath ?? current;
  const items = useNav(canWrite, canTeam).flatMap((g) => g.items);
  const help = items.find((i) => i.key === 'help');
  const settings = items.find((i) => i.key === 'settings');
  // Not in a demo: uploading is switched off there, and a shortcut to a dead end is worse than none.
  const upload = canUpload ? items.find((i) => i.key === 'upload') : undefined;
  const bell = ta.shellX.bell.title;
  return (
    <nav aria-label={ta.shellX.nav.utilities} className="no-print hidden w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-base py-4 md:flex">
      <ul className="flex flex-col items-center gap-2">
        <li>
          <RailLink href="/notifications" label={bell} active={isActive(pathname, '/notifications')}>
            <IconBell size={18} />
            {unread ? <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-base" /> : null}
            {unread ? <span className="sr-only">{unread}</span> : null}
          </RailLink>
        </li>
        {help ? <li><RailLink href={help.href} label={help.label} active={isActive(pathname, help.href)}>{help.icon}</RailLink></li> : null}
        {settings ? <li><RailLink href={settings.href} label={settings.label} active={isActive(pathname, settings.href)}>{settings.icon}</RailLink></li> : null}
      </ul>
      {upload ? (
        <RailLink href={upload.href} label={upload.label} active={isActive(pathname, upload.href)} className="border border-line-strong bg-raised shadow-sm">
          <IconUpload size={18} />
        </RailLink>
      ) : <span />}
    </nav>
  );
}
