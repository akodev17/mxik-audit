import { getI18n } from '@/lib/locale';
import { ButtonLink } from './button';
import { AutoRefresh, RetryAuditButton } from './catalog-status-client';
import { EmptyState } from './empty-state';
import { Progress } from './progress';

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
export async function CatalogStatus({ catalog }: { catalog: CatalogState }) {
  const { t } = await getI18n();
  if (catalog.status === 'ready') return null;

  if (catalog.status === 'analyzing') {
    const heading = t.catalogAnalyzing(catalog.progressDone, catalog.rowCount);
    return (
      <section aria-live="polite" className="mx-auto max-w-xl px-6 py-16">
        <h2 className="text-section">{heading}</h2>
        <Progress
          className="mt-4"
          label={heading}
          hideLabel
          value={catalog.progressDone}
          max={Math.max(catalog.rowCount, 1)}
        />
        <p className="mt-3 text-small text-muted">{t.catalogAnalyzingHint}</p>
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
      action={<ButtonLink href="/upload" variant="primary">{t.navUpload}</ButtonLink>}
    />
  );
}
