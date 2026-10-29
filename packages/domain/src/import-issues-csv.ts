// The upload diagnostics row by row, as one CSV the user can open next to their file: where (file
// line as Excel shows it, data row, column), why, and the cell as read. What the reader could not
// read at all (rows past the row limit, cells past the column limit) is one line each. Pure.
import type { ColumnField, ColumnMap } from './column-map.js';
import { formulaSafe } from './csv-safe.js';
import { eachImportIssue, type ImportIssueKind } from './import-diagnostics.js';
import { fileLine, MAX_COLUMNS } from './sheet-shape.js';
import type { ParseMeta } from './spreadsheet.js';

export type ImportIssuesCsvLabels = {
  columns: { line: string; row: string; column: string; reason: string; value: string };
  reasons: Record<Exclude<ImportIssueKind, 'duplicate'>, string>;
  duplicate: (row: string) => string;
  notRead: (n: number) => string;
  pastColumns: (n: number, max: number) => string;
};

export type ImportIssuesInput = {
  headers: readonly string[];
  /** Every data row of the file, in order. */
  rows: readonly (readonly string[])[];
  mapping: ColumnMap;
  parse: Pick<ParseMeta, 'headerRow' | 'lineJumps' | 'truncated' | 'totalSeen' | 'cellsPastColumnLimit'> | null;
};

const cell = (v: string | number): string => {
  const s = typeof v === 'number' ? String(v) : formulaSafe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// Digits only (codes, barcodes) as a text formula, so Excel keeps leading zeros and all 17 digits.
const valueCell = (v: string): string => (/^\d+$/.test(v) ? `"=""${v}"""` : cell(v));

/** UTF-8 with a byte-order mark (Excel reads Uzbek and Cyrillic), CRLF lines, every cell formula-safe. */
export function importIssuesCsv(input: ImportIssuesInput, labels: ImportIssuesCsvLabels): string {
  const { headers, rows, mapping, parse } = input;
  const c = labels.columns;
  const columnName = (field: ColumnField): string => headers[mapping[field]] ?? field;
  const lineOf = (row: number): string => {
    const line = parse ? fileLine(parse, row) : null;
    return line === null ? '' : String(line);
  };
  const lines: string[] = [[c.line, c.row, c.column, c.reason, c.value].map(cell).join(',')];

  eachImportIssue(rows, mapping, (issue) => {
    const reason = issue.kind === 'duplicate'
      ? labels.duplicate(lineOf(issue.firstRow ?? issue.row) || `#${issue.firstRow ?? issue.row}`)
      : labels.reasons[issue.kind];
    lines.push([cell(lineOf(issue.row)), cell(issue.row), cell(columnName(issue.field)), cell(reason), valueCell(issue.value)].join(','));
  });

  if (parse?.truncated && parse.totalSeen > rows.length) {
    lines.push([cell(''), cell(`${rows.length + 1}–${parse.totalSeen}`), cell(''), cell(labels.notRead(parse.totalSeen - rows.length)), cell('')].join(','));
  }
  if (parse?.cellsPastColumnLimit) {
    lines.push([cell(''), cell(''), cell(`> ${MAX_COLUMNS}`), cell(labels.pastColumns(parse.cellsPastColumnLimit, MAX_COLUMNS)), cell('')].join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
