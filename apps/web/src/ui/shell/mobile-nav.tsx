'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { buttonClass } from '../button';
import { cx } from '../cx';
import { focusables, trapTab } from '../focus';
import { IconButton } from '../icon-button';
import { IconBell, IconUpload, IconX } from '../icons';
import { useEscape, useReturnFocus, useScrollLock } from '../overlay';
import { Portal } from '../portal';
import { emailInitials } from './initials';
import { isActive } from './nav';
import { useNav } from './nav-items';
import { LogoMark, NavGroups } from './sidebar';

type Props = { id: string; open: boolean; onClose: () => void; canWrite: boolean; canTeam: boolean; email: string; unread: number | null };

/**
 * Navigation below md: a modal panel from the left with every destination of the header tabs and the
 * sidebar (upload, notifications, the sections, help and settings). Focus is trapped inside, Escape and
 * the backdrop close it, and it closes on navigation or when the window grows wide enough for the sidebar.
 */
export function MobileNav({ id, open, onClose, canWrite, canTeam, email, unread }: Props) {
  const { locale, t, ta } = useI18n();
  // Upload has its own button at the top; the groups list everything else.
  const groups = useNav(canWrite, canTeam).map((g) => ({ ...g, items: g.items.filter((i) => i.key !== 'upload') }));
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const openedAt = useRef(pathname);
  const count = unread ?? 0;

  useReturnFocus(open, panel);
  useScrollLock(open);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    openedAt.current = pathname;
    let frame = 0;
    let tries = 0;
    // The portal mounts one render later; retry until the panel exists.
    const place = (): void => {
      const box = panel.current;
      if (!box) {
        tries += 1;
        if (tries < 10) frame = requestAnimationFrame(place);
        return;
      }
      (focusables(box)[0] ?? box).focus({ preventScroll: true });
    };
    place();
    return () => cancelAnimationFrame(frame);
    // Runs on opening only: the path it saw is what the next effect compares against.
  }, [open]);

  useEffect(() => {
    if (open && pathname !== openedAt.current) onClose();
  }, [open, pathname, onClose]);

  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia('(min-width: 768px)');
    const onChange = (): void => { if (wide.matches) onClose(); };
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [open, onClose]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (panel.current) trapTab(e, panel.current);
  };
  const noticesHere = isActive(pathname, '/notifications');

  return (
    <Portal>
      <div className="fixed inset-0 z-modal md:hidden">
        <div aria-hidden className="absolute inset-0 bg-overlay motion-safe:animate-fade-in" onClick={onClose} />
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label={ta.shellX.nav.label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface text-fg shadow-overlay focus-visible:outline-none motion-safe:animate-fade-in"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
            <Link href="/dashboard" onClick={onClose} aria-label={ta.shellX.nav.home} className="flex min-w-0 flex-1 items-center gap-2 rounded-ctl px-1 py-1">
              <LogoMark />
              <span className="truncate text-section font-semibold tracking-tight">{t.appName}</span>
            </Link>
            <IconButton label={ta.shellX.nav.close} icon={<IconX size={18} />} onClick={onClose} tooltipAlign="end" tooltipSide="bottom" />
          </div>
          <nav aria-label={ta.shellX.nav.label} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
            {canWrite ? (
              <Link href="/upload" onClick={onClose} className={buttonClass('secondary', 'md', 'mb-3 w-full justify-start gap-3 px-2.5 shadow-sm')}>
                <IconUpload size={18} className="text-brand-ink" />
                {ta.shellX.nav.upload}
              </Link>
            ) : null}
            <Link
              href="/notifications"
              onClick={onClose}
              aria-current={noticesHere ? 'page' : undefined}
              className={cx(
                'mb-3 flex h-9 items-center gap-3 rounded-ctl px-2.5 text-data font-medium transition-colors duration-(--duration-fast)',
                noticesHere ? 'bg-raised text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-sunken/70 hover:text-fg',
              )}
            >
              <IconBell size={18} className={noticesHere ? 'text-brand-ink' : undefined} />
              <span className="min-w-0 flex-1 truncate">{ta.shellX.bell.title}</span>
              {count > 0 ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-micro font-semibold tabular-nums text-on-fill">
                  <span aria-hidden>{count > 99 ? '99+' : fmtNumber(locale, count)}</span>
                  <span className="sr-only">{ta.shellX.bell.newCount(fmtNumber(locale, count))}</span>
                </span>
              ) : null}
            </Link>
            <NavGroups groups={groups} onNavigate={onClose} />
          </nav>
          <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-small font-semibold text-brand-ink">{emailInitials(email)}</span>
            <span className="min-w-0">
              <span className="block text-micro text-muted">{ta.shellX.user.signedInAs}</span>
              <span className="block truncate text-small font-medium" title={email}>{email}</span>
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
