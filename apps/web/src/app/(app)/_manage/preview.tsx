import { Table, Td, Th } from '@/ui/table';

type Props = {
  headers: string[];
  rows: string[][];
  /** [column index, label] pairs; the label shows under that header. */
  roles: [number, string][];
  label: string;
};

/** First rows of an uploaded list, each chosen column labelled and tinted. */
export function ListPreview({ headers, rows, roles, label }: Props) {
  const roleOf = new Map(roles.filter(([i]) => i >= 0));
  return (
    <Table label={label}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <Th key={i} className={roleOf.has(i) ? 'bg-good-tint! align-bottom' : 'align-bottom'}>
              <span className="block max-w-48 truncate" title={h}>{h}</span>
              {roleOf.has(i) ? <span className="block font-semibold text-good-ink">{roleOf.get(i)}</span> : null}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {headers.map((_, c) => <Td key={c} className={roleOf.has(c) ? 'max-w-56 truncate text-fg' : 'max-w-56 truncate text-muted'} title={row[c] ?? ''}>{row[c] ?? ''}</Td>)}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
