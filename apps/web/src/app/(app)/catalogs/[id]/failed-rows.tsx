'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Button, ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import type { FailedRowsData } from './ws-types';

type Props = { catalogId: string; data: FailedRowsData; canRetry: boolean };

/**
 * The "Technical failure" filter: rows the audit could not check after its retries, with why, and
 * "Re-check failed rows" (POST /retry), which checks only these rows again and keeps every decision.
 */
export function FailedRows({ catalogId, data, canRetry }: Props) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.failed;
  const router = useRouter();
  const retry = useMutation({
    mutationFn: () => api.catalogs.retry({ catalogId }),
    onSuccess: (result) => { if (result.ok) router.refresh(); },
  });
  const back = <ButtonLink href={`/catalogs/${catalogId}?v=0`} variant="ghost" size="sm">{x.back}</ButtonLink>;

  if (data.total === 0) return <EmptyState title={x.none} action={back} />;

  return (
    <section aria-labelledby="failed-rows-title" className="px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="failed-rows-title" className="text-section text-fg">{x.title}</h2>
          <p className="mt-1 text-small text-muted">{x.intro(data.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {back}
          {canRetry ? <Button variant="primary" size="sm" loading={retry.isPending} onClick={() => retry.mutate()}>{x.retry}</Button> : null}
        </div>
      </div>
      {retry.data && !retry.data.ok ? <Alert tone="danger" className="mt-3">{x.retryFailed}</Alert> : null}
      <div className="mt-4 overflow-x-auto rounded-md border border-line">
        <table className="w-full text-small">
          <thead className="bg-surface text-left text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">{x.row}</th>
              <th scope="col" className="px-3 py-2 font-medium">{x.name}</th>
              <th scope="col" className="px-3 py-2 font-medium">{x.code}</th>
              <th scope="col" className="px-3 py-2 font-medium">{x.reason}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.itemId} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums text-muted">{fmtNumber(locale, r.rowIndex + 1)}</td>
                <td className="px-3 py-2 text-fg">{r.productName}</td>
                <td className="px-3 py-2 tabular-nums">{r.currentMxik ?? '—'}</td>
                <td className="px-3 py-2 text-danger-ink">{x.kind[r.kind]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.total > data.rows.length ? <p className="mt-2 text-micro text-muted">{x.more(data.rows.length, data.total)}</p> : null}
    </section>
  );
}
