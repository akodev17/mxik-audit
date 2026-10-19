'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'mxik.drawer.width';
export const DRAWER_MIN = 360;
export const DRAWER_MAX = 900;
const DEFAULT = 460;

export const clampWidth = (px: number): number => Math.round(Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, px)));

/** The row drawer's width in px, remembered per browser; storage failures fall back to the default. */
export function useDrawerWidth(): [number, (px: number) => void] {
  const [width, setWidth] = useState(DEFAULT);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampWidth(saved));
    } catch { /* storage blocked */ }
  }, []);
  const set = useCallback((px: number) => {
    const next = clampWidth(px);
    setWidth(next);
    try { localStorage.setItem(KEY, String(next)); } catch { /* storage blocked */ }
  }, []);
  return [width, set];
}
