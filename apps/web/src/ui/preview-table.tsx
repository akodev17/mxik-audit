import { Table, Td, Th } from './table';

type Props = {
  headers: string[];
  rows: string[][];
  /** [column index, label] pairs; the label shows under that header. */
  roles: [number, string][];
  limit?: number;
  /** Name of the table's scroll region. */
  label?: string;
};

/** First rows of an uploaded file, each mapped column labelled. */
export function PreviewTable({ headers, rows, roles, limit = 5, label }: Props) {
  const roleOf = new Map(roles.filter(([i]) => i >= 0));
  return (
    <Table label={label}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <Th key={i} className="align-bottom">
              <span className="block">{h}</span>
              {roleOf.has(i) ? <span className="block font-semibold text-good-ink">{roleOf.get(i)}</span> : null}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((row, r) => (
          <tr key={r}>
            {headers.map((_, c) => <Td key={c} className="whitespace-nowrap text-muted">{row[c] ?? ''}</Td>)}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
