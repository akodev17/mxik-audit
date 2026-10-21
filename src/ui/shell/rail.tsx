'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '../cx';
import { IconUpload } from '../icons';
import { Tooltip } from '../tooltip';
import { isActive } from './nav';
import { useNav } from './nav-items';

const RAIL_ICON = 'grid size-9 place-items-center rounded-ctl transition-colors duration-(--duration-fast)';

/**
 * Slim icon rail (from md): help and settings at the top, "upload a catalogue" (the upload icon) as the
 * one action at the bottom, for people who may upload. Every icon has a text name and a tooltip; nothing here duplicates a header tab.
 */
export function Rail({ canWrite, canTeam, canUpload, activePath }: { canWrite: boolean; canTeam: boolean; canUpload: boolean; activePath?: string }) {
  const current = usePathname();
  const pathname = activePath ?? current;
  const items = useNav(canWrite, canTeam).flatMap((g) => g.items);
  const top = items.filter((i) => i.key === 'help' || i.key === 'settings');
  // Not in a demo: uploading is switched off there, and a shortcut to a dead end is worse than none.
  const upload = canUpload ? items.find((i) => i.key === 'upload') : undefined;
  return (
    <div className="no-print hidden w-16 shrink-0 flex-col items-center justify-between border-r border-line bg-base py-4 md:flex">
      <ul className="flex flex-col items-center gap-2">
        {top.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.key}>
              <Tooltip content={item.label} side="bottom" describe={false}>
                <Link
                  href={item.href} aria-label={item.label} aria-current={active ? 'page' : undefined}
                  className={cx(RAIL_ICON, active ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}
                >
                  {item.icon}
                </Link>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {upload ? (
        <Tooltip content={upload.label} side="top" describe={false}>
          <Link
            href={upload.href} aria-label={upload.label}
            className={cx(RAIL_ICON, 'border border-line-strong bg-raised text-fg shadow-sm hover:bg-surface', isActive(pathname, upload.href) && 'bg-surface')}
          >
            <IconUpload size={18} />
          </Link>
        </Tooltip>
      ) : <span />}
    </div>
  );
}
