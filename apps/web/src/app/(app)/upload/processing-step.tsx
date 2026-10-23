'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { catalogKeys } from '@/lib/catalogs/client';
import type { CompletionSummary, UploadProgress } from '@/lib/catalogs/types';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Progress } from '@/ui/progress';
import { Notice } from './notice';

const POLL_MS = 1500;
const MAX_BACKOFF_MS = 15_000;

const settled = (p: UploadProgress | undefined): boolean => p?.status === 'ready' || p?.status === 'failed' || p?.status === 'uploaded';

/** Step 5: rows audited so far, polled from GET /api/catalogs/{id}/progress; failure with a retry. */
export function ProcessingStep({ catalogId, onDone }: { catalogId: string; onDone: (summary: CompletionSummary) => void }) {
  const { ta } = useI18n();
  const p = ta.importX.processing;
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
      <div className="space-y-3">
        <EmptyState
          tone="danger" title={p.failed} hint={p.failedHint}
          action={<Button variant="primary" loading={retrying} onClick={retry}>{p.retry}</Button>}
        />
        {retryError ? <Notice tone="danger">{retryError}</Notice> : null}
      </div>
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
  const heading = analyzing ? (finishing ? p.finishing : p.progress(analyzing.done, analyzing.total)) : p.waiting;
  return (
    <section aria-labelledby="processing-title" aria-live="polite" className="mx-auto max-w-xl space-y-3 py-6">
      <h2 id="processing-title" className="text-section">{p.title}</h2>
      <p className="text-data font-medium">{heading}</p>
      <Progress
        label={p.title} hideLabel
        value={analyzing && !finishing ? analyzing.done : undefined}
        max={Math.max(analyzing?.total ?? 1, 1)}
        valueText={analyzing && !finishing ? p.progress(analyzing.done, analyzing.total) : undefined}
      />
      {analyzing && !finishing && analyzing.etaSeconds !== null ? <p className="text-small text-muted">{p.eta(analyzing.etaSeconds)}</p> : null}
      <p className="text-small text-muted">{p.hint}</p>
      {pollError ? <Notice tone="warn">{p.pollFailed}</Notice> : null}
      <div><ButtonLink href={`/catalogs/${catalogId}`} variant="ghost" size="sm">{p.openWorkspace}</ButtonLink></div>
    </section>
  );
}
