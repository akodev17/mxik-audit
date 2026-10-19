'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { buttonClass, iconButtonClass, type ButtonSize, type ButtonVariant } from './button';
import { cx } from './cx';
import { IconChevronDown } from './icons';
import { nextIndex, typeaheadIndex } from './keys';
import { useEscape, useOutsidePress } from './overlay';
import { Tooltip } from './tooltip';
import { panelPosition, usePlacement } from './use-placement';

export type MenuItem = {
  label: string;
  /** Second line in small muted text; it becomes the item's accessible description. */
  description?: string;
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
 * items; Escape closes and returns focus to the button; Tab closes and moves on. The list opens
 * below the button, flips above it when there is no room and shifts to stay inside the viewport.
 */
export function Menu({ label, items, icon, iconOnly = false, variant = 'secondary', size = 'md', align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
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
  const position = panelPosition(usePlacement(open, root, list, 'bottom', align), 'bottom', align);

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
    'flex w-full gap-2 rounded-sm px-2.5 py-1.5 text-left text-data',
    item.description ? 'items-start' : 'items-center',
    'focus:bg-surface focus-visible:outline-offset-[-2px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
    item.tone === 'danger' ? 'text-danger-ink focus:bg-danger-tint' : 'text-fg',
  );
  // Descriptions wrap, so a menu that has them gets a narrower cap than one-line menus.
  const described = items.some((item) => item.description);

  return (
    <div ref={root} className="relative inline-block">
      {iconOnly ? <Tooltip content={label} describe={false}>{triggerButton}</Tooltip> : triggerButton}
      {open ? (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKey}
          style={position.style}
          className={cx(
            'absolute z-dropdown w-max min-w-48 rounded-md border border-line bg-raised p-1 shadow-pop motion-safe:animate-pop-in',
            described ? 'max-w-[min(22rem,calc(100vw-2rem))]' : 'max-w-[calc(100vw-2rem)]',
            position.className,
          )}
        >
          {items.map((item, i) => {
            // With a description the label alone names the item and the second line describes it.
            const labelId = item.description ? `${menuId}-${i}` : undefined;
            const descriptionId = item.description ? `${menuId}-${i}-d` : undefined;
            const common = {
              ref: (el: HTMLElement | null) => { itemRefs.current[i] = el; },
              role: 'menuitem',
              tabIndex: -1,
              'aria-disabled': item.disabled || undefined,
              'aria-labelledby': labelId,
              'aria-describedby': descriptionId,
              className: itemClass(item),
              onPointerMove: () => { if (!item.disabled && active !== i) setActive(i); },
            } as const;
            const body = (
              <>
                {item.icon ? <span className={cx('shrink-0 text-muted', item.description && 'mt-0.5')}>{item.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span id={labelId} className="block truncate">{item.label}</span>
                  {item.description ? <span id={descriptionId} className="block text-small text-muted">{item.description}</span> : null}
                </span>
              </>
            );
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
