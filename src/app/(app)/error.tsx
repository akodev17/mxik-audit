'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';

/** Any failure inside the app frame: say what happened and what to do. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const { ta } = useI18n();
  return (
    <EmptyState
      tone="danger"
      title={ta.msg.pageFailed}
      hint={ta.msg.pageFailedHint}
      action={<Button variant="primary" onClick={reset}>{ta.msg.retry}</Button>}
    />
  );
}
