// Measures an open panel against the viewport (see placement.ts); re-measures on resize, on scroll
// of any container and when the panel itself changes size.
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { placePanel, type Align, type Placement, type Side } from './placement';

/** Placement of the panel inside `anchor` (its positioned wrapper); null until measured or while closed. */
export function usePlacement(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  side: Side,
  align: Align,
): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      const root = document.documentElement;
      // offsetWidth/Height ignore the entrance transform, so the pop-in scale does not skew them.
      const next = placePanel(
        a.getBoundingClientRect(),
        { width: p.offsetWidth, height: p.offsetHeight },
        { width: root.clientWidth, height: root.clientHeight },
        { side, align },
      );
      setPlacement((cur) => (cur && cur.side === next.side && cur.x === next.x ? cur : next));
    };
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [open, anchor, panel, side, align]);

  return open ? placement : null;
}

/** Classes and style that put the panel on its side (4 px gap) and at its measured left edge. */
export function panelPosition(placement: Placement | null, side: Side, align: Align): { className: string; style?: CSSProperties } {
  const vertical = (placement?.side ?? side) === 'top' ? 'bottom-full mb-1' : 'top-full mt-1';
  if (!placement) return { className: `${vertical} ${align === 'end' ? 'right-0' : 'left-0'}` };
  return { className: vertical, style: { left: placement.x } };
}
