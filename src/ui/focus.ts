// Focus helpers for dialogs and other trapped regions.
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { trapIndex } from './keys';

export const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(', ');

/** Visible, enabled, tabbable elements inside `container`, in DOM order. */
export function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

/** Keeps Tab and Shift+Tab inside `container`. */
export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, container: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = focusables(container);
  if (items.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const target = trapIndex(current, items.length, e.shiftKey);
  if (target === null) return;
  e.preventDefault();
  items[target]?.focus();
}
