'use client';

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { IconButton } from './icon-button';
import { IconX } from './icons';
import { useEscape, useReturnFocus } from './overlay';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Dims the page behind and closes on a click there; the drawer stays non-modal either way. */
  backdrop?: boolean;
  /** Any CSS length. Sets --drawer-width; without it an ancestor's --drawer-width, else 460px, applies. */
  width?: string;
};

/**
 * Right-side panel; the page behind stays visible and interactive (non-modal). Opening moves focus
 * to its heading, closing returns it to the opener. Escape closes it, except while a filled text
 * field inside has focus or something else already handled the key.
 */
export function Drawer({ open, title, onClose, children, footer, backdrop = false, width }: Props) {
  const { ta } = useI18n();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEscape(open, onClose, { ignoreFilledFields: true });
  useReturnFocus(open, panel);
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  const style = width ? ({ '--drawer-width': width } as CSSProperties) : undefined;
  return (
    <>
      {backdrop ? <div aria-hidden className="no-print fixed inset-x-0 bottom-0 top-14 z-drawer bg-overlay motion-safe:animate-fade-in" onClick={onClose} /> : null}
      <aside
        ref={panel}
        aria-labelledby={titleId}
        style={style}
        className="no-print fixed bottom-0 right-0 top-14 z-drawer flex w-[var(--drawer-width,460px)] max-w-full flex-col border-l border-line bg-raised shadow-overlay motion-safe:animate-slide-in"
      >
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2 pl-5 pr-3">
          <h2 ref={heading} id={titleId} tabIndex={-1} className="truncate text-section focus-visible:outline-none">{title}</h2>
          <IconButton label={ta.shell.close} icon={<IconX size={18} />} onClick={onClose} tooltipSide="bottom" tooltipAlign="end" />
        </header>
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        {footer ? <footer className="border-t border-line bg-surface px-5 py-3">{footer}</footer> : null}
      </aside>
    </>
  );
}
