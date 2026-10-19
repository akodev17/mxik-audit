'use client';

import type { ImportDiagnostics } from '@/lib/import-diagnostics';
import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import { Spinner } from '@/ui/spinner';
import { Notice } from './notice';

type Props = {
  diagnostics: ImportDiagnostics | null;
  updating: boolean;
  error: string | null;
};

/** What the import will do under the current mapping, computed on the server. */
export function DiagnosticsPanel({ diagnostics: d, updating, error }: Props) {
  const { locale, t, ta } = useI18n();
  const g = ta.importX.diag;
  const rowsAt = (sample: number[]): string => g.atRows(sample.map((r) => `#${fmtNumber(locale, r)}`).join(', '));
  // Named as the workspace names the finding each row will get.
  const badCodes = d ? g.badCodes(d.badCodes.count, t.typeNotFound) : '';

  const items: { tone: 'danger' | 'warn' | 'info'; text: string; sample: number[] }[] = d ? [
    ...(d.noName.count > 0 ? [{ tone: 'danger' as const, text: g.noName(d.noName.count), sample: d.noName.sample }] : []),
    ...(d.badCodes.count > 0 ? [{ tone: 'warn' as const, text: d.lostZero.count > 0 ? `${badCodes} ${g.lostZero(d.lostZero.count)}` : badCodes, sample: d.badCodes.sample }] : []),
    ...(d.noCode.count > 0 ? [{ tone: 'info' as const, text: g.noCode(d.noCode.count, t.typeMissing), sample: d.noCode.sample }] : []),
    ...(d.ambiguousAmounts.count > 0 ? [{ tone: 'warn' as const, text: g.ambiguous(d.ambiguousAmounts.count), sample: d.ambiguousAmounts.sample }] : []),
    ...(d.duplicates.count > 0 ? [{ tone: 'info' as const, text: g.duplicates(d.duplicates.count, d.duplicates.groups), sample: d.duplicates.sample }] : []),
  ] : [];

  return (
    <section aria-labelledby="diag-title" aria-busy={updating || undefined} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="diag-title" className="text-data font-semibold">{g.title}</h3>
        {updating ? <span className="inline-flex items-center gap-1.5 text-small text-muted"><Spinner size={12} />{g.updating}</span> : null}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {d ? (
        <div aria-live="polite" className="space-y-2">
          <p className="text-data font-medium">{g.importable(d.importable, d.rows)}</p>
          {items.length === 0 ? <Notice tone="good">{g.clean}</Notice> : items.map((it) => (
            <Notice key={it.text} tone={it.tone}>
              <p>{it.text}</p>
              {it.sample.length > 0 ? <p className="mt-0.5 opacity-90">{rowsAt(it.sample)}</p> : null}
            </Notice>
          ))}
        </div>
      ) : null}
    </section>
  );
}
