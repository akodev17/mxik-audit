// Sales of risky rows, when the file had a sales column: an estimate from the file's own numbers,
// shown above the workspace grid. No fine or penalty figure is computed here.
import { db } from '@tasnivo/db';
import { catalogScope } from './access.js';
import { ColumnMapSchema } from './column-map.js';
import { RISKY_ITEM } from './risk.js';

/** Sums of the sales column: of rows with a risky finding, and of every row. */
export type MoneyAtRisk = { risky: number; total: number };

/** Null when the mapping has no sales column or the file's sales add up to nothing. */
export async function moneyAtRisk(catalogId: string, columnMap: unknown): Promise<MoneyAtRisk | null> {
  const mapping = ColumnMapSchema.safeParse(columnMap);
  if (!mapping.success || mapping.data.sales < 0) return null;
  const [risky, total] = await Promise.all([
    db.catalogItem.aggregate({ where: { catalogId, ...RISKY_ITEM }, _sum: { salesAmount: true } }),
    db.catalogItem.aggregate({ where: { catalogId }, _sum: { salesAmount: true } }),
  ]);
  const sums = { risky: Number(risky._sum.salesAmount ?? 0), total: Number(total._sum.salesAmount ?? 0) };
  return sums.total > 0 ? sums : null;
}

/** The same for a catalogue the user may see; undefined when they may not. */
export async function catalogMoneyAtRisk(user: { orgId: string; clientIds?: string[] | null }, catalogId: string): Promise<MoneyAtRisk | null | undefined> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) }, select: { id: true, columnMap: true } });
  return catalog ? moneyAtRisk(catalog.id, catalog.columnMap) : undefined;
}
