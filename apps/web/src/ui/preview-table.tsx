import { cx } from './cx';
import { columnKinds, type ColumnKind } from './preview-columns';
import { Table, Td, Th } from './table';

type Props = {
  headers: string[];
  rows: string[][];
  /** [column index, label] pairs; the label shows under that header. */
  roles: [number, string][];
  limit?: number;
  /** Name of the table's scroll region. */
  label?: string;
  /** Words for the value kinds; given, each header says what its sample holds (text, number, code, empty). */
  kindLabels?: Record<ColumnKind, string>;
  /** Tooltip of the kind line: how the kind was judged. */
  kindHint?: string;
  /** Height of the scroll region; the header row stays in view. */
  maxHeight?: string;
};

const KIND_TONE: Record<ColumnKind, string> = {
  code: 'text-brand-ink', number: 'text-info-ink', text: 'text-muted', empty: 'text-subtle',
};

/** First rows of an uploaded file, each mapped column labelled: sticky header, striped rows, long values cut with a title. */
export function PreviewTable({ headers, rows, roles, limit = 5, label, kindLabels, kindHint, maxHeight = '24rem' }: Props) {
  const roleOf = new Map(roles.filter(([i]) => i >= 0));
  const shown = rows.slice(0, limit);
  const kinds = kindLabels ? columnKinds(headers.length, shown) : null;
  return (
    <Table label={label} stickyHeader maxHeight={maxHeight}>
      <thead>
        <tr>
          <Th numeric className="w-10 align-bottom">#</Th>
          {headers.map((h, i) => {
            const role = roleOf.get(i);
            return (
              <Th key={i} className={cx('min-w-32 align-bottom', role !== undefined && 'bg-brand-tint')}>
                {role !== undefined ? <span className="mb-0.5 block text-micro font-semibold text-brand-ink">{role}</span> : null}
                <span className="block max-w-64 truncate font-semibold text-fg" title={h}>{h}</span>
                {kinds && kindLabels ? (
                  <span className={cx('block text-micro font-normal', KIND_TONE[kinds[i] ?? 'text'])} title={kindHint}>{kindLabels[kinds[i] ?? 'text']}</span>
                ) : null}
              </Th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.map((row, r) => (
          <tr key={r} className={r % 2 === 1 ? '[&>td]:bg-surface' : undefined}>
            <Td numeric className="text-subtle">{r + 1}</Td>
            {headers.map((_, c) => {
              const value = row[c] ?? '';
              return (
                <Td key={c} className={cx('max-w-64 truncate whitespace-nowrap', roleOf.has(c) ? 'text-fg' : 'text-muted')} title={value.length > 24 ? value : undefined}>
                  {value}
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
