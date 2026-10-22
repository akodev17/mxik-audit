'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { DRAWER_MAX, DRAWER_MIN } from './use-drawer-width';

type Props = { width: number; onWidth: (px: number) => void };

/** Drag handle on the drawer's left edge (a vertical separator); arrows resize from the keyboard. */
export function DrawerResize({ width, onWidth }: Props) {
  const { ta } = useI18n();
  const drag = useRef<{ x: number; width: number } | null>(null);

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    onWidth(drag.current.width + (drag.current.x - e.clientX));
  };
  const onUp = (): void => { drag.current = null; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onWidth(width + step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onWidth(width - step); }
    if (e.key === 'Home') { e.preventDefault(); onWidth(DRAWER_MAX); }
    if (e.key === 'End') { e.preventDefault(); onWidth(DRAWER_MIN); }
  };

  return (
    <div
      role="separator" aria-orientation="vertical" aria-label={ta.wsX.drawer.resize}
      aria-valuenow={width} aria-valuemin={DRAWER_MIN} aria-valuemax={DRAWER_MAX} tabIndex={0}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
      style={{ right: width - 3 }}
      className="no-print fixed bottom-0 top-14 z-drawer hidden w-1.5 cursor-col-resize touch-none bg-transparent hover:bg-brand focus-visible:bg-brand focus-visible:outline-none lg:block"
    />
  );
}
