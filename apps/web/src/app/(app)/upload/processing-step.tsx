'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { retryCatalogAudit } from '@/app/actions/catalog';
import { useI18n } from '@/lib/locale-client';
import type { CompletionSummary, UploadProgress } from '@/lib/upload-progress';
import { Button, ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Progress } from '@/ui/progress';
import { Notice } from './notice';

const POLL_MS = 1500;
const MAX_BACKOFF_MS = 15_000;

async function fetchProgress(catalogId: string): Promise<UploadProgress | null> {
  const response = await fetch(`/upload/progress?catalog=${encodeURIComponent(catalogId)}`, { cache: 'no-store' });
  if (!response.ok) return null;
  return (await response.json()) as UploadProgress;
}

/** Step 5: rows audited so far, polled from a small JSON endpoint; failure with a retry. */
export function ProcessingStep({ catalogId, onDone }: { catalogId: string; onDone: (summary: CompletionSummary) => void }) {
  const { ta } = useI18n();
  const p = ta.importX.processing;
  const [state, setState] = useState<UploadProgress | null>(null);
  const [pollError, setPollError] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  const [round, setRound] = useState(0);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    const tick = async (): Promise<void> => {
      try {
        const next = await fetchProgress(catalogId);
        if (stopped) return;
        if (!next) throw new Error('progress');
        setPollError(false);
        delay = POLL_MS;
        setState(next);
        if (next.status === 'ready') { done.current(next.summary); return; }
        if (next.status === 'failed' || next.status === 'uploaded') return;
      } catch {
        if (stopped) return;
        setPollError(true);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      timer = setTimeout(() => { void tick(); }, delay);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [catalogId, round]);

  const retry = (): void => {
    setRetryError(null);
    startRetry(async () => {
      const result = await retryCatalogAudit(catalogId).catch(() => ({ ok: false }));
      if (!result.ok) { setRetryError(p.retryFailed); return; }
      setState(null);
      setRound((r) => r + 1);
    });
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
