'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { cx } from '../cx';
import { useEscape } from '../overlay';
import { useIntentPrefetch } from './intent-prefetch';
import type { NavItemView } from './nav-items';

type Props = {
  item: NavItemView;
  active: boolean;
  /** Classes for the text label; in a collapsed rail they make it screen-reader only. */
  labelClass?: string;
  onNavigate?: () => void;
};

const HOVER_DELAY_MS = 300;

/** The label is shown on screen (expanded rail); then no tooltip is needed. */
const labelShown = (el: HTMLElement | null): boolean => Boolean(el && el.getBoundingClientRect().width > 2);

function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A sidebar link. In a collapsed rail the label stays for screen readers and appears as a tooltip
 * on hover and keyboard focus; the tooltip is fixed-positioned so the scrolling list cannot clip it.
 */
export function NavLink({ item, active, labelClass, onNavigate }: Props) {
  const link = useRef<HTMLAnchorElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const intent = useIntentPrefetch()(item.href);

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = (): void => {
    clear();
    setTip(null);
  };
  const show = (): void => {
    if (labelShown(label.current) || !link.current) return;
    const r = link.current.getBoundingClientRect();
    setTip({ top: r.top + r.height / 2, left: r.right });
  };
  const onPointerEnter = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    clear();
    timer.current = setTimeout(show, HOVER_DELAY_MS);
  };
  const onFocus = (e: FocusEvent): void => {
    intent.onFocus(e);
    if (focusVisible(e.target)) show();
  };

  useEffect(() => clear, []);
  useEscape(tip !== null, hide);

  return (
    <li onPointerEnter={onPointerEnter} onPointerLeave={hide}>
      <Link
        ref={link}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onPointerEnter={intent.onPointerEnter}
        onPointerLeave={intent.onPointerLeave}
        onPointerDown={intent.onPointerDown}
        onFocus={onFocus}
        onBlur={hide}
        onClick={() => { hide(); onNavigate?.(); }}
        className={cx(
          'relative flex h-9 items-center gap-3 rounded-ctl px-2.5 text-data font-medium transition-colors duration-(--duration-fast)',
          active ? 'bg-raised text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:bg-sunken/70 hover:text-fg',
        )}
      >
        <span className={cx('shrink-0', active && 'text-brand-ink')}>{item.icon}</span>
        <span ref={label} className={cx('truncate', labelClass)}>{item.label}</span>
      </Link>
      {tip ? (
        // Visual only: the link already carries the label. Padding, not margin, so the pointer can cross onto it.
        <span aria-hidden style={{ top: tip.top, left: tip.left }} className="fixed z-dropdown -translate-y-1/2 pl-2">
          <span className="block w-max max-w-64 rounded-sm bg-fg px-2 py-1 text-micro font-medium text-inverse shadow-pop motion-safe:animate-fade-in">
            {item.label}
          </span>
        </span>
      ) : null}
    </li>
  );
}
