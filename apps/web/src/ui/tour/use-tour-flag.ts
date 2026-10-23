'use client';

import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { saveWithRetry } from './tour-save';

/**
 * The account's tour flag as the frame holds it: pending until the tour closes here (finished or
 * skipped), then saved once. Kept locally, so a later navigation or a refreshed shell that still
 * says pending (a lost write) does not open it again in this session. A tour re-opened from the user
 * menu or Settings closes without a write.
 */
export function useTourFlag(initial: 'pending' | 'done'): { pending: boolean; onDone: () => void } {
  const [pending, setPending] = useState(initial === 'pending');
  const unsaved = useRef(pending);

  const onDone = useCallback(() => {
    if (!unsaved.current) return;
    unsaved.current = false;
    setPending(false);
    void saveWithRetry(() => api.account.setTour({ done: true }));
  }, []);

  return { pending, onDone };
}
