'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { fmtPercent } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { catalogKeys } from '@/lib/catalogs/client';
import type { CompletionSummary, UploadProgress } from '@/lib/catalogs/types';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconInfo } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import { Spinner } from '@/ui/spinner';
import { Notice } from './notice';
import { StepCard } from './step-card';

const POLL_MS = 1500;
const MAX_BACKOFF_MS = 15_000;

const settled = (p: UploadProgress | undefined): boolean => p?.status === 'ready' || p?.status === 'failed' || p?.status === 'uploaded';

/** Step 5: rows audited so far, polled from GET /api/catalogs/{id}/progress; failure with a retry. */
export function ProcessingStep({ catalogId, onDone }: { catalogId: string; onDone: (summary: CompletionSummary) => void }) {
  const { locale, ta } = useI18n();
  const p = ta.importX.processing;
  const f = ta.importX.flow;
  const [retryError, setRetryError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  // Every 1.5 s until the audit settles; after a failed poll the wait doubles up to 15 s.
  const progress = useQuery({
    queryKey: catalogKeys.progress(catalogId),
    queryFn: () => api.catalogs.progress({ catalogId }),
    refetchInterval: (query) => {
      if (query.state.status === 'success' && settled(query.state.data)) return false;
      const failures = query.state.fetchFailureCount;
      return failures > 0 ? Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) : POLL_MS;
    },
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const state = progress.data ?? null;
  const pollError = progress.isError;

  useEffect(() => {
    if (progress.data?.status === 'ready') done.current(progress.data.summary);
  }, [progress.data]);

  const retrier = useMutation({
    mutationFn: () => api.catalogs.retry({ catalogId }),
    onSuccess: (result) => {
      if (!result.ok) { setRetryError(p.retryFailed); return; }
      // Polling starts over from "waiting".
      void queryClient.resetQueries({ queryKey: catalogKeys.progress(catalogId) });
    },
    onError: () => setRetryError(p.retryFailed),
  });
  const retrying = retrier.isPending;

  const retry = (): void => {
    setRetryError(null);
    retrier.mutate();
  };

  if (state?.status === 'failed') {
    return (
      <StepCard titleId="processing-title" title={p.title}>
        <EmptyState
          tone="danger" title={p.failed} hint={p.failedHint} as="h3"
          action={<Button variant="primary" loading={retrying} onClick={retry}>{p.retry}</Button>}
        />
        {retryError ? <Notice tone="danger">{retryError}</Notice> : null}
      </StepCard>
    );
  }

  if (state?.status === 'uploaded') {
    // The commit did not go through (its claim was released): the mapping is still open. The wizard
    // keeps its step in state and the address is already this one, so start it over as a document.
    return (
      <Notice tone="warn" action={<ButtonLink href={`/upload?catalog=${catalogId}`} variant="primary" size="sm" reload>{ta.importX.check.next}</ButtonLink>}>
        {ta.importX.errors.commitFailed}
      </Notice>
    );
  }

  const analyzing = state?.status === 'analyzing' ? state : null;
  const finishing = analyzing !== null && analyzing.total > 0 && analyzing.done >= analyzing.total;
  const live = analyzing !== null && !finishing ? analyzing : null;
  const heading = analyzing ? (finishing ? p.finishing : p.progress(analyzing.done, analyzing.total)) : p.waiting;
  const ratio = live && live.total > 0 ? live.done / live.total : null;

  return (
    <StepCard
      titleId="processing-title" title={p.title} className="mx-auto max-w-2xl"
      icon={<span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-info-tint text-info-ink"><Spinner size={16} /></span>}
    >
      <div aria-live="polite" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <p className="text-data font-medium">{heading}</p>
          {ratio !== null ? <p aria-hidden className="text-title tabular-nums text-fg">{fmtPercent(locale, ratio, { maximumFractionDigits: 0 })}</p> : null}
        </div>
        <Progress
          label={p.title} hideLabel
          value={live ? live.done : undefined}
          max={Math.max(analyzing?.total ?? 1, 1)}
          valueText={live ? p.progress(live.done, live.total) : undefined}
        />
        {live && live.etaSeconds !== null ? <p className="text-small text-muted">{p.eta(live.etaSeconds)}</p> : null}
      </div>
      <div className="flex gap-3 rounded-md bg-surface p-4">
        <IconInfo size={18} className="mt-px shrink-0 text-info-ink" />
        <div className="min-w-0 text-small">
          <p className="font-semibold text-fg">{f.leaveTitle}</p>
          <p className="mt-0.5 text-muted">{p.hint}</p>
        </div>
      </div>
      {pollError ? <Notice tone="warn">{p.pollFailed}</Notice> : null}
      <div><ButtonLink href={`/catalogs/${catalogId}`} variant="secondary" size="sm">{p.openWorkspace}</ButtonLink></div>
    </StepCard>
  );
}
