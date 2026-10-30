// Rows of an audited catalogue as the exports write them: original cells, the
// effective code and review state per row, and the unit and packaging an
// accepted code binds; and the file rows the commit skipped, so every row of the
// file is written back in its place. Server-only. The catalogue exports read them in
// batches of file rows (exportLineBatches), so memory holds a batch, not the catalogue.
import { db } from '@tasnivo/db';
import { effectiveRow, type EffectiveFinding, type EffectiveRow } from './export-effective.js';
import { skippedRows, StoredAttrs } from './catalog-import.js';

export type CodeUnit = { unitBinding: string; unitCanonical: string[]; unitContainer: string | null };

export type ExportItem = {
  rowIndex: number;
  rawName: string;
  barcode: string | null;
  unit: string | null;
  existingMxik: string | null;
  original: string[];
  effective: EffectiveRow;
  /** The row's check failed after its retries (S3): not checked, never written as clean or corrected. */
  checkError: string | null;
};

/** A file row that is not an item (no name): written unchanged, with only the status cell filled. */
export type ExportSkipped = { rowIndex: number; reason: string; original: string[] };

export type ExportLine = { kind: 'item'; item: ExportItem } | { kind: 'skipped'; row: ExportSkipped };

/** Items and skipped rows in file order (both carry the file's rowIndex). */
export function inFileOrder(items: readonly ExportItem[], skipped: readonly ExportSkipped[]): ExportLine[] {
  const out: ExportLine[] = [];
  let s = 0;
  for (const item of items) {
    while (s < skipped.length && (skipped[s]?.rowIndex ?? Infinity) < item.rowIndex) out.push({ kind: 'skipped', row: skipped[s++] as ExportSkipped });
    out.push({ kind: 'item', item });
  }
  while (s < skipped.length) out.push({ kind: 'skipped', row: skipped[s++] as ExportSkipped });
  return out;
}

/** Every line of the export: the items with their review state and the skipped rows, in file order. */
export async function exportLines(catalogId: string): Promise<{ items: ExportItem[]; lines: ExportLine[] }> {
  const [items, skipped] = await Promise.all([exportItems(catalogId), skippedRows(catalogId)]);
  return { items, lines: inFileOrder(items, skipped) };
}

/** File rows per batch of the catalogue exports. */
export const EXPORT_BATCH = 2_000;

const itemSelect = {
  rowIndex: true, rawName: true, barcode: true, unit: true, existingMxik: true, attrs: true, checkError: true,
  findings: { select: { severity: true, decision: true, chosenMxik: true, decidedAt: true } },
} as const;

type ItemRecord = Omit<ExportItem, 'original' | 'effective'> & { attrs: unknown; findings: EffectiveFinding[] };

const toExportItem = (item: ItemRecord): ExportItem => ({
  rowIndex: item.rowIndex,
  rawName: item.rawName,
  barcode: item.barcode,
  unit: item.unit,
  existingMxik: item.existingMxik,
  original: StoredAttrs.safeParse(item.attrs).data?.original ?? [],
  effective: effectiveRow(item.existingMxik, item.findings),
  checkError: item.checkError,
});

// Keyset pages on rowIndex ((catalogId, rowIndex) is unique in both tables): file order, no OFFSET scan.
async function* itemsInPages(catalogId: string, take: number): AsyncGenerator<ExportItem> {
  for (let after = -1; ;) {
    const page = await db.catalogItem.findMany({ where: { catalogId, rowIndex: { gt: after } }, orderBy: { rowIndex: 'asc' }, take, select: itemSelect });
    for (const item of page) yield toExportItem(item);
    const last = page.at(-1);
    if (!last || page.length < take) return;
    after = last.rowIndex;
  }
}

async function* skippedInPages(catalogId: string, take: number): AsyncGenerator<ExportSkipped> {
  for (let after = -1; ;) {
    const page = await skippedRows(catalogId, { after, take });
    yield* page;
    const last = page.at(-1);
    if (!last || page.length < take) return;
    after = last.rowIndex;
  }
}

/**
 * The lines of exportLines, in the same order, `batchSize` file rows at a time. Items and skipped
 * rows are read in pages of that size and merged as inFileOrder merges them.
 */
export async function* exportLineBatches(catalogId: string, options: { batchSize?: number } = {}): AsyncGenerator<ExportLine[]> {
  const size = Math.max(1, options.batchSize ?? EXPORT_BATCH);
  const items = itemsInPages(catalogId, size);
  const skipped = skippedInPages(catalogId, size);
  let item = await items.next();
  let row = await skipped.next();
  let batch: ExportLine[] = [];
  while (!item.done || !row.done) {
    // Same tie rule as inFileOrder: a skipped row goes first only when its rowIndex is smaller.
    if (!row.done && (item.done || row.value.rowIndex < item.value.rowIndex)) {
      batch.push({ kind: 'skipped', row: row.value });
      row = await skipped.next();
    } else if (!item.done) {
      batch.push({ kind: 'item', item: item.value });
      item = await items.next();
    }
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

/** Unit binding and packaging of each code, in one ANY($1) query. */
export async function codeUnits(codes: readonly string[]): Promise<Map<string, CodeUnit>> {
  const wanted = [...new Set(codes)].filter((c) => /^\d{17}$/.test(c));
  if (wanted.length === 0) return new Map();
  const rows = await db.$queryRaw<{ code: string; unitBinding: string; unitCanonical: string[]; unitContainer: string | null }[]>`
    SELECT code, "unitBinding"::text AS "unitBinding", "unitCanonical", "unitContainer"
    FROM mxik_code WHERE code = ANY(${wanted}::bpchar[])`;
  return new Map(rows.map((r) => [r.code.trim(), { unitBinding: r.unitBinding, unitCanonical: r.unitCanonical, unitContainer: r.unitContainer }]));
}

/** When EHF stops accepting each of `codes` that is on the restricted list (restricted_code). */
export async function codeRestrictions(codes: readonly string[]): Promise<Map<string, Date>> {
  const wanted = [...new Set(codes)].filter((c) => /^\d{17}$/.test(c));
  if (wanted.length === 0) return new Map();
  const rows = await db.restrictedCode.findMany({ where: { code: { in: wanted } }, select: { code: true, effectiveFrom: true } });
  return new Map(rows.map((r) => [r.code, r.effectiveFrom]));
}

/** Every item at once (products, tests); the catalogue exports read exportLineBatches. */
export async function exportItems(catalogId: string): Promise<ExportItem[]> {
  const items = await db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' }, select: itemSelect });
  return items.map(toExportItem);
}

/** The unit to write: an accepted code with a strictly bound unit fixes it; otherwise the file's own. */
export function exportUnit(item: Pick<ExportItem, 'unit' | 'effective'>, units: Map<string, CodeUnit>): string {
  const accepted = item.effective.acceptedCode ? units.get(item.effective.acceptedCode) : undefined;
  return accepted?.unitBinding === 'strict' && accepted.unitCanonical[0] ? accepted.unitCanonical[0] : (item.unit ?? '');
}

export function exportPackaging(item: Pick<ExportItem, 'effective'>, units: Map<string, CodeUnit>): string {
  return item.effective.acceptedCode ? units.get(item.effective.acceptedCode)?.unitContainer ?? '' : '';
}
