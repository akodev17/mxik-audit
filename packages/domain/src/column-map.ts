// The upload column mapping, kept out of the 'use server' action file: a
// "use server" module may only export async functions, and a zod schema is an
// object. Exporting it from there fails at runtime, not at build time.
import { z } from 'zod';

/** Which uploaded column feeds which field. -1 means "not mapped". */
export const ColumnMapSchema = z.object({
  name: z.number().int().min(0),
  barcode: z.number().int().min(-1),
  mxik: z.number().int().min(-1),
  unit: z.number().int().min(-1),
  price: z.number().int().min(-1),
  /** Sales amount per row, for the money-at-risk estimate. Older mappings lack it. */
  sales: z.number().int().min(-1).default(-1),
});

export type ColumnMap = z.infer<typeof ColumnMapSchema>;
export type ColumnField = keyof ColumnMap;

/** Field order as the mapping UI presents it. */
export const COLUMN_FIELDS = ['name', 'barcode', 'mxik', 'unit', 'price', 'sales'] as const;

export type MappingIssue =
  | { kind: 'out_of_range'; field: ColumnField }
  | { kind: 'duplicate'; fields: ColumnField[]; column: number };

/**
 * Problems that make a mapping unusable for this file: a column index past the
 * header row, or one column feeding two fields. The name column is required by
 * the schema itself. Pure, so the browser shows the same warnings the server enforces.
 */
export function mappingIssues(mapping: ColumnMap, width: number): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const byColumn = new Map<number, ColumnField[]>();
  for (const field of COLUMN_FIELDS) {
    const index = mapping[field];
    if (index < 0) continue;
    if (index >= width) { issues.push({ kind: 'out_of_range', field }); continue; }
    byColumn.set(index, [...(byColumn.get(index) ?? []), field]);
  }
  for (const [column, fields] of byColumn) {
    if (fields.length > 1) issues.push({ kind: 'duplicate', fields, column });
  }
  return issues;
}
