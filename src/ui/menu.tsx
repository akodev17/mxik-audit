'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { buttonClass, iconButtonClass, type ButtonSize, type ButtonVariant } from './button';
import { cx } from './cx';
import { IconChevronDown } from './icons';
import { nextIndex, typeaheadIndex } from './keys';
import { useEscape, useOutsidePress } from './overlay';
import { Tooltip } from './tooltip';

export type MenuItem = {
  label: string;
  /** Runs on click, Enter or Space; the menu closes first. */
  onSelect?: () => void;
  /** Makes the item a link instead. */
  href?: string;
  icon?: ReactNode;
  /** Destructive items are red and should open a ConfirmDialog. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
};

type Props = {
  /** Trigger text; with iconOnly it becomes the trigger's accessible name and tooltip. */
  label: string;
  items: MenuItem[];
  icon?: ReactNode;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: 'start' | 'end';
};

/**
 * Action menu (WAI-ARIA menu button): arrow keys, Home, End and the first letter move between
 * items; Escape closes and returns focus to the button; Tab closes and moves on.
 */
export function Menu({ label, items, icon, iconOnly = false, variant = 'secondary', size = 'md', align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const triggerId = useId();
  const menuId = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const openAt = (position: 'first' | 'last'): void => {
    setActive(position === 'first' ? (enabled[0] ?? -1) : (enabled[enabled.length - 1] ?? -1));
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    setActive(-1);
    if (refocus) trigger.current?.focus();
  };

  useEscape(open, () => close(true));
  useOutsidePress(open, [root], () => close(false));

  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [open, active]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt('first'); }
    if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last'); }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Focus the button first, so the browser's Tab continues from there once the menu is gone.
    if (e.key === 'Tab') { trigger.current?.focus(); close(false); return; }
    const at = enabled.indexOf(active);
    const step = nextIndex(e.key, at, enabled.length);
    const typed = step === null ? typeaheadIndex(enabled.map((i) => items[i]?.label ?? ''), e.key, at) : null;
    const target = step ?? typed;
    if (target === null) return;
    e.preventDefault();
    setActive(enabled[target] ?? -1);
  };

  const select = (item: MenuItem): void => {
    close(!item.href);
    item.onSelect?.();
  };

  const triggerButton = (
    <button
      ref={trigger}
      id={triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={iconOnly ? label : undefined}
      onClick={() => (open ? close(false) : openAt('first'))}
      onKeyDown={onTriggerKey}
      className={iconOnly ? iconButtonClass(variant === 'secondary' ? 'ghost' : variant, size) : buttonClass(variant, size)}
    >
      {icon}
      {iconOnly ? null : label}
      {iconOnly ? null : <IconChevronDown size={14} className={cx('transition-transform duration-(--duration-fast)', open && 'rotate-180')} />}
    </button>
  );

  const itemClass = (item: MenuItem): string => cx(
    'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-data',
    'focus:bg-surface focus-visible:outline-offset-[-2px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
    item.tone === 'danger' ? 'text-danger-ink focus:bg-danger-tint' : 'text-fg',
  );

  return (
    <div ref={root} className="relative inline-block">
      {iconOnly ? <Tooltip content={label} describe={false}>{triggerButton}</Tooltip> : triggerButton}
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKey}
          className={cx(
            'absolute top-full z-dropdown mt-1 w-max min-w-48 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-raised p-1 shadow-pop motion-safe:animate-pop-in',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => {
            const common = {
              ref: (el: HTMLElement | null) => { itemRefs.current[i] = el; },
              role: 'menuitem',
              tabIndex: -1,
              'aria-disabled': item.disabled || undefined,
              className: itemClass(item),
              onPointerMove: () => { if (!item.disabled && active !== i) setActive(i); },
            } as const;
            const body = <>{item.icon ? <span className="shrink-0 text-muted">{item.icon}</span> : null}<span className="min-w-0 flex-1 truncate">{item.label}</span></>;
            if (item.href && !item.disabled) {
              return <Link key={i} href={item.href} {...common} onClick={() => select(item)}>{body}</Link>;
            }
            return (
              <button key={i} type="button" {...common} onClick={() => { if (!item.disabled) select(item); }}>
                {body}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
