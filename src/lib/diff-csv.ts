// The comparison of two catalogue versions as one CSV file: every added, removed and changed row,
// and every row whose risk status changed, with the previous values beside the new ones. Pure.
import { csvCell } from './accuracy.js';
import type { DiffMatch, DiffNote, DiffRow } from './version-diff.js';

export type DiffCsvLabels = {
  columns: { kind: string; row: string; name: string; unit: string; code: string; beforeName: string; beforeUnit: string; beforeCode: string; what: string; match: string };
  kinds: { added: string; removed: string; changed: string; statusChanged: string };
  matches: Record<DiffMatch, string>;
  notes: Record<DiffNote, string>;
};

type Lists = { added: readonly DiffRow[]; removed: readonly DiffRow[]; changed: readonly DiffRow[]; statusChanged: readonly DiffRow[] };

/** UTF-8 with a byte-order mark, so Excel reads Uzbek and Cyrillic text correctly; every cell is formula-safe. */
export function diffCsv(lists: Lists, labels: DiffCsvLabels): string {
  const c = labels.columns;
  const head = [c.kind, c.row, c.name, c.unit, c.code, c.beforeName, c.beforeUnit, c.beforeCode, c.what, c.match];
  const line = (kind: string, r: DiffRow): string => [
    kind, String(r.rowIndex + 1), r.name, r.unit ?? '', r.code ?? '',
    r.before?.name ?? '', r.before?.unit ?? '', r.before?.code ?? '',
    (r.notes ?? []).map((n) => labels.notes[n]).join('; '),
    r.match ? labels.matches[r.match === 'row' ? 'row' : r.match] : '',
  ].map(csvCell).join(',');
  const rows = [
    ...lists.added.map((r) => line(labels.kinds.added, r)),
    ...lists.removed.map((r) => line(labels.kinds.removed, r)),
    ...lists.changed.map((r) => line(labels.kinds.changed, r)),
    ...lists.statusChanged.map((r) => line(labels.kinds.statusChanged, r)),
  ];
  return `\uFEFF${[head.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
}
