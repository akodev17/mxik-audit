'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';
import { focusables, trapTab } from './focus';
import { IconButton } from './icon-button';
import { IconX } from './icons';
import { useEscape, useReturnFocus, useScrollLock } from './overlay';
import { Portal } from './portal';

type Size = 'sm' | 'md' | 'lg';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One or two sentences under the title; linked as the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons, right-aligned; put the primary action last. */
  footer?: ReactNode;
  size?: Size;
  /** Element to focus on open; otherwise the first field or button in the body, then the footer. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** False while something is in flight: Escape, the backdrop and the close button do nothing. */
  dismissible?: boolean;
  /** alertdialog for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  /** Leading mark next to the title, e.g. a warning icon. */
  icon?: ReactNode;
  /** top: the panel keeps its top edge while its content grows (search palettes). */
  placement?: 'center' | 'top';
};

const WIDTH: Record<Size, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/**
 * Modal dialog: rendered in a portal inside .app, page behind dimmed and not scrollable, Tab kept
 * inside, Escape and a backdrop click close it, focus returns to the opener.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', initialFocus, dismissible = true, role = 'dialog', icon, placement = 'center' }: DialogProps) {
  const { ta } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useReturnFocus(open, panel);
  useScrollLock(open);
  useEscape(open, () => { if (dismissible) onClose(); });

  // The panel mounts one render after open (the portal needs the DOM), so retry until it exists.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let tries = 0;
    const place = (): void => {
      const box = panel.current;
      if (!box) {
        tries += 1;
        if (tries < 10) frame = requestAnimationFrame(place);
        return;
      }
      const target = initialFocus?.current
        ?? (body.current ? focusables(body.current)[0] : undefined)
        ?? (footerRef.current ? focusables(footerRef.current)[0] : undefined)
        ?? box;
      target.focus({ preventScroll: true });
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (panel.current) trapTab(e, panel.current);
  };

  return (
    <Portal>
      <div className={cx('fixed inset-0 z-modal flex justify-center p-3 sm:p-6', placement === 'top' ? 'items-start pt-[8dvh] sm:pt-[12dvh]' : 'items-end sm:items-center')}>
        <div
          aria-hidden
          className="absolute inset-0 bg-overlay motion-safe:animate-fade-in"
          onPointerDown={(e) => { pressStartedOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (dismissible && pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
        />
        <div
          ref={panel}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cx(
            'relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-lg border border-line bg-raised text-fg shadow-overlay',
            'focus-visible:outline-none motion-safe:animate-pop-in sm:max-h-[calc(100dvh-3rem)]',
            WIDTH[size],
          )}
        >
          {/* The icon sits on the title line only; description and body share the dialog's full width and left edge. */}
          <header className="px-5 pb-2 pt-4">
            <div className="flex items-start gap-2.5">
              {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
              <h2 id={titleId} className="min-w-0 flex-1 text-section">{title}</h2>
              <IconButton label={ta.shell.close} icon={<IconX size={18} />} onClick={onClose} disabled={!dismissible} tooltipAlign="end" className="-mr-1 -mt-1" />
            </div>
            {description ? <div id={descriptionId} className="mt-1.5 text-data text-muted">{description}</div> : null}
          </header>
          {children ? <div ref={body} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">{children}</div> : null}
          {footer ? <div ref={footerRef} className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
