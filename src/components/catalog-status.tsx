import Link from 'next/link';
import { t } from '@/lib/i18n';
import { AutoRefresh, RetryAuditButton } from './catalog-status-client';

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
      <section aria-live="polite" className="border-l-4 border-ink bg-paper-tint px-6 py-5">
        <h1 className="font-serif text-2xl tnum">{t.catalogAnalyzing(catalog.progressDone, catalog.rowCount)}</h1>
        <div className="mt-4 h-2 w-full max-w-xl bg-rule" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 max-w-xl text-sm text-ink-soft">{t.catalogAnalyzingHint}</p>
        <AutoRefresh intervalMs={2000} />
      </section>
    );
  }

  if (catalog.status === 'failed') {
    return (
      <section className="border-l-4 border-risk bg-risk-tint px-6 py-5">
        <h1 className="font-serif text-2xl text-risk">{t.catalogFailed}</h1>
        {catalog.auditError ? <p className="mt-2 text-sm text-ink-soft">{catalog.auditError}</p> : null}
        <RetryAuditButton catalogId={catalog.id} />
      </section>
    );
  }

  return (
    <section className="border-l-4 border-rule bg-paper-tint px-6 py-5">
      <p className="text-ink-soft">
        {t.catalogNotAudited}{' '}
        <Link href="/upload" className="underline">{t.navUpload}</Link>
      </p>
    </section>
  );
}
