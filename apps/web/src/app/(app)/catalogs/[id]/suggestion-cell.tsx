'use client';

import { useI18n } from '@/lib/locale-client';
import type { GridRow } from '@tasnivo/domain/workspace-rows';
import { Badge } from '@/ui/badge';
import { CodeCell } from './code-cell';

/**
 * The "Taklif" cell. A code-suggesting check shows its code (or that none
 * fits); other checks propose no code and say what to verify instead. A code
 * the reviewer chose is shown in place of the suggestion.
 */
export function SuggestionCell({ row, compact }: { row: GridRow; compact: boolean }) {
  const { ta } = useI18n();
  const x = ta.wsX;
  const chose = row.decision === 'accepted' && row.chosenMxik !== null && row.chosenMxik !== row.suggestedMxik && row.chosenMxik !== row.currentMxik;
  let body: React.ReactNode;
  if (chose) body = <CodeCell code={row.chosenMxik} name={row.chosenName} empty="—" compact={compact} />;
  else if (row.type === 'MISSING' || row.type === 'NOT_FOUND' || row.type === 'MISMATCH') {
    body = row.noSuggestion
      ? <span className="block truncate text-small italic text-muted" title={x.noSuggestionWhy}>{x.noSuggestion}</span>
      : <CodeCell code={row.suggestedMxik} name={row.suggestedName} empty="—" compact={compact} />;
  } else {
    body = <span className="block truncate text-small text-muted" title={x.explain[row.type]}>{x.check[row.type] ?? '—'}</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {body}
      <span className="flex min-w-0 flex-wrap gap-1">
        {chose ? <Badge tone="brand">{x.act.chosen}</Badge> : null}
        {row.flag === 'ask_client' ? <Badge tone="warn">{x.filter.flagOpt.ask_client}</Badge> : null}
        {row.flag === 'resolved' ? <Badge tone="good">{x.filter.flagOpt.resolved}</Badge> : null}
      </span>
    </span>
  );
}
