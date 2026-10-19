// Behaviour shared by overlays: Escape on the topmost layer, outside press, focus return, scroll lock.
import { useEffect, useRef, type RefObject } from 'react';
import { isFilledTextField } from './keys';
import { closeLayer, isTopLayer, openLayer } from './layers';

/** Keeps the latest callback in a ref, so listeners need not be re-attached on every render. */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => { ref.current = value; });
  return ref;
}

type EscapeOptions = { ignoreFilledFields?: boolean };

/**
 * Calls onEscape when Escape is pressed while this overlay is the topmost open layer and nothing
 * inside already handled the key (defaultPrevented). Optionally leaves Escape to a filled text field.
 */
export function useEscape(active: boolean, onEscape: () => void, options: EscapeOptions = {}): void {
  const handler = useLatest(onEscape);
  const ignoreFilled = options.ignoreFilledFields === true;
  useEffect(() => {
    if (!active) return;
    const id = openLayer();
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTopLayer(id)) return;
      if (ignoreFilled && isFilledTextField(e.target)) return;
      e.preventDefault();
      handler.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      closeLayer(id);
    };
  }, [active, ignoreFilled, handler]);
}

/** Calls onOutside for a pointer press that lands outside every given element. */
export function useOutsidePress(active: boolean, refs: readonly RefObject<HTMLElement | null>[], onOutside: () => void): void {
  const handler = useLatest(onOutside);
  const targets = useLatest(refs);
  useEffect(() => {
    if (!active) return;
    function onDown(e: PointerEvent): void {
      const node = e.target instanceof Node ? e.target : null;
      if (node && targets.current.some((r) => r.current?.contains(node))) return;
      handler.current();
    }
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active, handler, targets]);
}

/**
 * Remembers the focused element when `active` turns on and gives focus back when it turns off,
 * unless the user has already moved focus somewhere outside the overlay.
 */
export function useReturnFocus(active: boolean, container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const now = document.activeElement;
      const lost = !now || now === document.body || Boolean(container.current?.contains(now));
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, container]);
}

let locks = 0;
let savedOverflow = '';

/** Stops the page behind a modal from scrolling; nested modals share one lock. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    if (locks === 0) {
      savedOverflow = html.style.overflow;
      html.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) html.style.overflow = savedOverflow;
    };
  }, [active]);
}
