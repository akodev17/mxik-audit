'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { focusables, trapTab } from '../focus';
import { IconButton } from '../icon-button';
import { IconX } from '../icons';
import { useEscape, useReturnFocus, useScrollLock } from '../overlay';
import { Portal } from '../portal';
import { useNav } from './nav-items';
import { LogoMark, NavGroups } from './sidebar';

type Props = { id: string; open: boolean; onClose: () => void; canWrite: boolean };

/**
 * Navigation below md: a modal panel from the left. Focus is trapped inside, Escape and the backdrop
 * close it, and it closes on navigation or when the window grows wide enough for the rail.
 */
export function MobileNav({ id, open, onClose, canWrite }: Props) {
  const { t, ta } = useI18n();
  const groups = useNav(canWrite);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const openedAt = useRef(pathname);

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
          <nav aria-label={ta.shellX.nav.label} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2">
            <NavGroups groups={groups} onNavigate={onClose} />
          </nav>
        </div>
      </div>
    </Portal>
  );
}
