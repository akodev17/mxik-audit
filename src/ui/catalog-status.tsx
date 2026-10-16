import Link from 'next/link';
import { t } from '@/lib/i18n';
import { AutoRefresh, RetryAuditButton } from './catalog-status-client';
import { EmptyState } from './empty-state';

export type CatalogState = {
  id: string;
  status: 'uploaded' | 'analyzing' | 'ready' | 'failed';
  rowCount: number;
  progressDone: number;
  auditError: string | null;
};

/**
 * What a screen shows instead of results while a catalogue is not audited.
 * Without it an unaudited catalogue would read as "no risks found".
 */
export function CatalogStatus({ catalog }: { catalog: CatalogState }) {
  if (catalog.status === 'ready') return null;

  if (catalog.status === 'analyzing') {
    const pct = catalog.rowCount === 0 ? 0 : Math.min(100, Math.round((catalog.progressDone / catalog.rowCount) * 100));
    return (
      <section aria-live="polite" className="mx-auto max-w-xl px-6 py-16">
        <h2 className="text-xl">{t.catalogAnalyzing(catalog.progressDone, catalog.rowCount)}</h2>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">{t.catalogAnalyzingHint}</p>
        <AutoRefresh intervalMs={2000} />
      </section>
    );
  }

  if (catalog.status === 'failed') {
    return (
      <EmptyState
        tone="danger" title={t.catalogFailed} hint={catalog.auditError ?? undefined}
        action={<RetryAuditButton catalogId={catalog.id} />}
      />
    );
  }

  return (
    <EmptyState
      title={t.catalogNotAudited}
      action={<Link href="/upload" className="text-brand hover:underline">{t.navUpload}</Link>}
    />
  );
}
