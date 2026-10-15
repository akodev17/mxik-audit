'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { undo } from '@/app/actions/review';
import { t } from '@/lib/i18n';

export type HistoryRow = {
  id: string;
  action: string;
  createdAt: string;
  actorEmail: string | null;
  productName: string | null;
  chosenMxik: string | null;
  count: number;
  undoable: boolean;
};

function describe(row: HistoryRow): string {
  switch (row.action) {
    case 'finding.accepted': return `${t.historyAccepted}: ${row.productName ?? ''}${row.chosenMxik ? ` → ${row.chosenMxik}` : ''}`;
    case 'finding.rejected': return `${t.historyRejected}: ${row.productName ?? ''}`;
    case 'finding.bulk_accepted': return t.historyBulk(row.count);
    case 'finding.undone': return t.historyUndone(row.count);
    default: return row.action;
  }
}

/** Every decision on this catalogue, newest first; any still in effect can be undone. */
export function DecisionHistory({ entries }: { entries: HistoryRow[] }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revert(eventId: string): void {
    setError(null);
    startBusy(async () => {
      const result = await undo({ eventId });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <details className="no-print mt-8 border border-rule">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {t.reviewHistory} <span className="tnum text-ink-faint">({entries.length})</span>
      </summary>
      {error ? <p role="alert" className="px-4 pb-2 text-sm text-risk">{error}</p> : null}
      {entries.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-soft">{t.reviewHistoryEmpty}</p>
      ) : (
        <ol className="divide-y divide-rule border-t border-rule">
          {entries.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block break-words">{describe(row)}</span>
                <span className="block text-xs text-ink-faint tnum">
                  {new Date(row.createdAt).toLocaleString('uz-UZ')}{row.actorEmail ? ` · ${row.actorEmail}` : ''}
                </span>
              </span>
              {row.undoable ? (
                <button
                  type="button" disabled={busy} onClick={() => revert(row.id)}
                  className="whitespace-nowrap text-xs text-ink-soft underline hover:text-ink disabled:opacity-50"
                >
                  {t.reviewUndo}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
