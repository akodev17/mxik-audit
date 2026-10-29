'use client';

import type { ImportDiagnostics, ParseMeta } from '@/lib/catalogs/types';
import { fileLine } from '@/lib/catalogs/upload';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { StatusIcon } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { Spinner } from '@/ui/spinner';
import { Notice } from './notice';

type Props = {
  diagnostics: ImportDiagnostics | null;
  /** How the file was read: turns data-row samples into the file lines Excel shows. */
  parse: ParseMeta | null;
  updating: boolean;
  error: string | null;
};

type Severity = 'danger' | 'warn' | 'info';
type Item = { tone: Severity; text: string; sample: number[] };

const SEVERITIES: readonly Severity[] = ['danger', 'warn', 'info'];
const RULE: Record<Severity, string> = { danger: 'border-danger', warn: 'border-warn', info: 'border-info' };
const INK: Record<Severity, string> = { danger: 'text-danger-ink', warn: 'text-warn-ink', info: 'text-info-ink' };

/** What the import will do under the current mapping, computed on the server, grouped by how much it matters. */
export function DiagnosticsPanel({ diagnostics: d, parse, updating, error }: Props) {
  const { locale, t, ta } = useI18n();
  const g = ta.importX.diag;
  const f = ta.importX.flow;
  const n = (v: number): string => fmtNumber(locale, v);
  // File lines when the upload kept them; otherwise data rows, and the label says so.
  const rowsAt = (sample: number[]): string => {
    const lines = parse ? sample.map((r) => fileLine(parse, r)) : [];
    if (lines.length === sample.length && lines.every((l) => l !== null)) return g.atLines(lines.map((l) => n(l ?? 0)).join(', '));
    return g.atRows(sample.map((r) => `#${n(r)}`).join(', '));
  };
  // Named as the workspace names the finding each row will get.
  const badCodes = d ? g.badCodes(d.badCodes.count, t.typeNotFound) : '';

  const items: Item[] = d ? [
    ...(d.noName.count > 0 ? [{ tone: 'danger' as const, text: g.noName(d.noName.count), sample: d.noName.sample }] : []),
    ...(d.badCodes.count > 0 ? [{ tone: 'warn' as const, text: d.lostZero.count > 0 ? `${badCodes} ${g.lostZero(d.lostZero.count)}` : badCodes, sample: d.badCodes.sample }] : []),
    ...(d.noCode.count > 0 ? [{ tone: 'info' as const, text: g.noCode(d.noCode.count, t.typeMissing), sample: d.noCode.sample }] : []),
    ...(d.badTnved.count > 0 ? [{ tone: 'warn' as const, text: g.badTnved(d.badTnved.count), sample: d.badTnved.sample }] : []),
    ...(d.tnvedZero.count > 0 ? [{ tone: 'info' as const, text: g.tnvedZero(d.tnvedZero.count), sample: d.tnvedZero.sample }] : []),
    ...(d.ambiguousAmounts.count > 0 ? [{ tone: 'warn' as const, text: g.ambiguous(d.ambiguousAmounts.count), sample: d.ambiguousAmounts.sample }] : []),
    ...(d.duplicates.count > 0 ? [{ tone: 'info' as const, text: g.duplicates(d.duplicates.count, d.duplicates.groups), sample: d.duplicates.sample }] : []),
  ] : [];
  const share = d && d.rows > 0 ? Math.min(1, d.importable / d.rows) : 0;

  return (
    <section aria-labelledby="diag-title" aria-busy={updating || undefined} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="diag-title" className="text-data font-semibold">{g.title}</h3>
        {updating ? <span className="inline-flex items-center gap-1.5 text-small text-muted"><Spinner size={12} />{g.updating}</span> : null}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {d ? (
        <div aria-live="polite" className={cx('space-y-4 transition-opacity duration-(--duration-fast)', updating && 'opacity-60')}>
          <div>
            <p className="text-data font-medium">{g.importable(d.importable, d.rows)}</p>
            <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken inset-ring inset-ring-line-input">
              <div className={cx('h-full rounded-full', share >= 1 ? 'bg-good' : share > 0 ? 'bg-brand' : 'bg-danger')} style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
          </div>
          {items.length === 0 ? <Notice tone="good">{g.clean}</Notice> : SEVERITIES.map((tone) => {
            const group = items.filter((it) => it.tone === tone);
            if (group.length === 0) return null;
            return (
              <div key={tone}>
                <h4 className={cx('flex items-center gap-1.5 text-small font-semibold', INK[tone])}>
                  <StatusIcon tone={tone} size={14} />{f.diagGroups[tone]}
                </h4>
                <ul className="mt-1.5 space-y-2">
                  {group.map((it) => (
                    <li key={it.text} className={cx('border-l-2 pl-3 text-small', RULE[tone])}>
                      <p className="text-fg">{it.text}</p>
                      {it.sample.length > 0 ? <p className="mt-0.5 text-micro text-muted">{rowsAt(it.sample)}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
