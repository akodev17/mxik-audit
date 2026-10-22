'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Renders children at the end of the .app element, so overlays keep the app's tokens and theme. */
export function Portal({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setRoot(document.querySelector<HTMLElement>('.app') ?? document.body);
  }, []);
  return root ? createPortal(children, root) : null;
}
