'use client';

import { useEffect, useState } from 'react';
import { Button } from '../button';
import { IconArrowLeft } from './icons';

/** "Go back" for the not-found and error pages; shown only when this tab has a page to go back to. */
export function BackButton({ label }: { label: string }) {
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(window.history.length > 1), []);
  if (!canGoBack) return null;
  return (
    <Button variant="ghost" onClick={() => window.history.back()}>
      <IconArrowLeft size={16} />
      {label}
    </Button>
  );
}
