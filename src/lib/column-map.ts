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

/** Field order as the mapping UI presents it. */
export const COLUMN_FIELDS = ['name', 'barcode', 'mxik', 'unit', 'price', 'sales'] as const;
