'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { useEscape, useOutsidePress } from '../overlay';

/**
 * State of a header dropdown (client switcher, bell, user menu): Escape returns focus to the
 * trigger, a press outside or tabbing away closes it, and so does moving to another page.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEscape(open, () => close(true));
  useOutsidePress(open, [root], () => close(false));

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  const onBlur = (e: FocusEvent<HTMLElement>): void => {
    if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) close(false);
  };

  return { open, setOpen, close, root, trigger, panel, panelId, onBlur };
}
