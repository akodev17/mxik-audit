'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { retryCatalogAudit } from '@/app/actions/catalog';
import { t } from '@/lib/i18n';
import { Button } from './button';

/** Re-renders the server page on an interval, while an audit is running. */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

export function RetryAuditButton({ catalogId }: { catalogId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <Button
      variant="primary" disabled={busy} className="mt-4"
      onClick={() => start(async () => { await retryCatalogAudit(catalogId); router.refresh(); })}
    >
      {busy ? t.loading : t.catalogRetry}
    </Button>
  );
}
