'use client';

import { useI18n } from '@/lib/locale-client';
import type { GridRow } from './ws-types';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { CodeCell } from './code-cell';
import { ConfidenceMeter } from './confidence-meter';

type Props = {
  row: GridRow;
  /** Grid rows are one line high: code, marks and the meter side by side. Cards stack them. */
  compact: boolean;
  /** The grid's match column is hidden: the cell carries the confidence bars itself. */
  meter?: boolean;
};

/** Whether a row's suggestion is shown with a match band (a code-suggesting check, or a decided row that took one). */
export const showsMatch = (row: GridRow): boolean =>
  row.mode === 'suggest' || (row.decision !== 'pending' && !row.noSuggestion && row.mode !== 'confirm' && row.suggestedMxik !== null);

/**
 * The "Taklif" cell. A code-suggesting check shows its code (or that none
 * fits); other checks propose no code and say what to verify instead. A code
 * the reviewer chose is shown in place of the suggestion.
 */
export function SuggestionCell({ row, compact, meter = false }: Props) {
  const { ta } = useI18n();
  const x = ta.wsX;
  const chose = row.decision === 'accepted' && row.chosenMxik !== null && row.chosenMxik !== row.suggestedMxik && row.chosenMxik !== row.currentMxik;
  let body: React.ReactNode;
  let code = false;
  if (chose) { body = <CodeCell code={row.chosenMxik} name={row.chosenName} empty="—" compact={compact} />; code = true; }
  else if (row.type === 'MISSING' || row.type === 'NOT_FOUND' || row.type === 'MISMATCH') {
    code = !row.noSuggestion;
    body = row.noSuggestion
      ? <span className="block truncate text-small italic text-muted" title={x.noSuggestionWhy}>{x.noSuggestion}</span>
      : <CodeCell code={row.suggestedMxik} name={row.suggestedName} empty="—" compact={compact} />;
  } else {
    body = <span className="block truncate text-small text-muted" title={x.explain[row.type]}>{x.check[row.type] ?? '—'}</span>;
  }
  const marks = (
    <>
      {chose ? <Badge tone="brand">{x.act.chosen}</Badge> : null}
      {row.flag === 'ask_client' ? <Badge tone="warn">{x.filter.flagOpt.ask_client}</Badge> : null}
      {row.flag === 'resolved' ? <Badge tone="good">{x.filter.flagOpt.resolved}</Badge> : null}
    </>
  );
  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx('min-w-0', !code && 'flex-1')}>{body}</span>
        {meter && code && !chose ? <ConfidenceMeter confidence={row.confidence} stage={row.stage} show={showsMatch(row)} barsOnly /> : null}
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">{marks}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {body}
      <span className="flex min-w-0 flex-wrap gap-1">{marks}</span>
    </span>
  );
}
