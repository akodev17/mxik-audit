type Props = {
  headers: string[];
  rows: string[][];
  /** [column index, label] pairs; the label shows under that header. */
  roles: [number, string][];
  limit?: number;
};

/** First rows of an uploaded file, each mapped column labelled. */
export function PreviewTable({ headers, rows, roles, limit = 5 }: Props) {
  const roleOf = new Map(roles.filter(([i]) => i >= 0));
  return (
    <div className="overflow-x-auto rounded-ctl border border-line">
      <table className="dense min-w-full text-left">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="border-b border-line-strong bg-surface px-3 py-2 align-bottom text-xs font-bold text-muted">
                <span className="block">{h}</span>
                {roleOf.has(i) ? <span className="block font-medium text-good">{roleOf.get(i)}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, r) => (
            <tr key={r}>
              {headers.map((_, c) => <td key={c} className="whitespace-nowrap border-b border-line px-3 py-2 text-muted">{row[c] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
