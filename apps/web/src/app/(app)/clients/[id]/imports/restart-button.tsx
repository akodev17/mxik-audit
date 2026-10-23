'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Notice } from '@/app/(app)/upload/notice';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';

/** Restarts a failed or stalled cheque/sales check; the failure is said, not swallowed. */
export function RestartDocButton({ listId }: { listId: string }) {
  const { ta } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        variant="primary" loading={busy}
        onClick={() => {
          setError(null);
          start(async () => {
            const result = await orRefused(api.imports.restartDoc({ listId }), ta.importX.errors.network);
            if (!result.ok) { setError(result.error); return; }
            router.refresh();
          });
        }}
      >
        {ta.importX.docs.restart}
      </Button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
