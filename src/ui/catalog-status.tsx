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
  const { t, ta } = await getI18n();
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
    // The raw error can carry internals (SQL, paths, provider replies): it stays in the server log.
    if (catalog.auditError) console.warn(`[catalog ${catalog.id}] audit failed: ${catalog.auditError}`);
    return (
      <EmptyState
        tone="danger" title={t.catalogFailed} hint={ta.importX.processing.failedHint}
        action={<RetryAuditButton catalogId={catalog.id} />}
      />
    );
  }

  // Uploaded but never committed: the mapping screen picks it up where it was left.
  return (
    <EmptyState
      title={t.catalogNotAudited}
      action={<ButtonLink href={`/upload?catalog=${encodeURIComponent(catalog.id)}`} variant="primary">{ta.importX.status.resume}</ButtonLink>}
    />
  );
}
