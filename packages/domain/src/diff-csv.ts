// The comparison of two catalogue versions as one CSV file: every added, removed and changed row,
// and every row whose risk status changed, with the previous values beside the new ones. Pure.
import { csvCell, csvCodeCell } from './accuracy.js';
import type { DiffMatch, DiffNote, DiffRow } from './version-diff.js';

export type DiffCsvLabels = {
  columns: { kind: string; row: string; name: string; unit: string; code: string; beforeName: string; beforeUnit: string; beforeCode: string; what: string; match: string };
  kinds: { added: string; removed: string; changed: string; statusChanged: string };
  matches: Record<DiffMatch, string>;
  notes: Record<DiffNote, string>;
};

type Lists = { added: readonly DiffRow[]; removed: readonly DiffRow[]; changed: readonly DiffRow[]; statusChanged: readonly DiffRow[] };

/**
 * UTF-8 with a byte-order mark, so Excel reads Uzbek and Cyrillic text correctly; every cell is formula-safe,
 * and codes are written as text so Excel keeps their leading zeros (B5).
 */
export function diffCsv(lists: Lists, labels: DiffCsvLabels): string {
  const c = labels.columns;
  const head = [c.kind, c.row, c.name, c.unit, c.code, c.beforeName, c.beforeUnit, c.beforeCode, c.what, c.match];
  const line = (kind: string, r: DiffRow): string => [
    csvCell(kind), csvCell(String(r.rowIndex + 1)), csvCell(r.name), csvCell(r.unit ?? ''), csvCodeCell(r.code ?? null),
    csvCell(r.before?.name ?? ''), csvCell(r.before?.unit ?? ''), csvCodeCell(r.before?.code ?? null),
    csvCell((r.notes ?? []).map((n) => labels.notes[n]).join('; ')),
    csvCell(r.match ? labels.matches[r.match === 'row' ? 'row' : r.match] : ''),
  ].join(',');
  const rows = [
    ...lists.added.map((r) => line(labels.kinds.added, r)),
    ...lists.removed.map((r) => line(labels.kinds.removed, r)),
    ...lists.changed.map((r) => line(labels.kinds.changed, r)),
    ...lists.statusChanged.map((r) => line(labels.kinds.statusChanged, r)),
  ];
  return `\uFEFF${[head.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
}
