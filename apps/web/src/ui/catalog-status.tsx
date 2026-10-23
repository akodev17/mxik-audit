'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { fmtPercent } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { catalogKeys } from '@/lib/catalogs/client';
import type { UploadProgress } from '@/lib/catalogs/types';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from './button';
import { EmptyState } from './empty-state';
import { Progress } from './progress';
import { Spinner } from './spinner';

export type CatalogState = {
  id: string;
  status: 'uploaded' | 'analyzing' | 'ready' | 'failed';
  rowCount: number;
  progressDone: number;
};

/** The server page's state of the catalogue, as the progress read answers it. */
function progressOf(catalog: CatalogState): UploadProgress | null {
  if (catalog.status === 'analyzing') return { status: 'analyzing', done: catalog.progressDone, total: catalog.rowCount, etaSeconds: null };
  if (catalog.status === 'failed' || catalog.status === 'uploaded') return { status: catalog.status };
  return null;
}

/**
 * What a screen shows instead of results while a catalogue is not audited.
 * Without it an unaudited catalogue would read as "no risks found". A running audit is polled
 * every 2 s (GET /api/catalogs/{id}/progress); once it is ready the page renders again with the results.
 */
export function CatalogStatus({ catalog }: { catalog: CatalogState }) {
  const { locale, t, ta } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = catalogKeys.progress(catalog.id);
  const initial = progressOf(catalog);

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api.catalogs.progress({ catalogId: catalog.id }),
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
    refetchInterval: (query) => (query.state.data?.status === 'analyzing' ? 2000 : false),
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const state = data ?? initial;

  // The results are rendered by the server page: render it again once the audit is done.
  useEffect(() => {
    if (state?.status === 'ready') router.refresh();
  }, [state?.status, router]);

  const retry = useMutation({
    mutationFn: () => api.catalogs.retry({ catalogId: catalog.id }),
    onSuccess: (result) => { if (result.ok) void queryClient.invalidateQueries({ queryKey: key }); },
  });

  if (!state || state.status === 'ready') return null;

  if (state.status === 'analyzing') {
    const heading = t.catalogAnalyzing(state.done, state.total);
    const ratio = state.total > 0 ? Math.min(1, state.done / state.total) : null;
    return (
      <div className="px-4 py-10 sm:py-16">
        <section aria-live="polite" className="mx-auto max-w-xl rounded-lg border border-line bg-raised p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-info-tint text-info-ink"><Spinner size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-section">{heading}</h2>
                {ratio !== null ? <span aria-hidden className="text-title tabular-nums">{fmtPercent(locale, ratio, { maximumFractionDigits: 0 })}</span> : null}
              </div>
              <Progress className="mt-3" label={heading} hideLabel value={state.done} max={Math.max(state.total, 1)} />
              <p className="mt-3 text-small text-muted">{t.catalogAnalyzingHint}</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (state.status === 'failed') {
    // The raw error can carry internals (SQL, paths, provider replies), so it is never shown; it
    // stays in catalog.auditError, written once when the audit failed.
    return (
      <EmptyState
        tone="danger" title={t.catalogFailed} hint={ta.importX.processing.failedHint}
        action={<Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>{t.catalogRetry}</Button>}
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
