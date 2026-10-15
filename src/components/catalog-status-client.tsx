'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { retryCatalogAudit } from '@/app/actions/catalog';
import { t } from '@/lib/i18n';

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
    <button
      type="button" disabled={busy}
      onClick={() => start(async () => { await retryCatalogAudit(catalogId); router.refresh(); })}
      className="mt-4 bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
    >
      {busy ? t.loading : t.catalogRetry}
    </button>
  );
}
