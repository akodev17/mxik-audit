// Rows of an audited catalogue as the exports write them: original cells, the
// effective code and review state per row, and the unit and packaging an
// accepted code binds; and the file rows the commit skipped, so every row of the
// file is written back in its place. Server-only; one query for all accepted codes.
import { db } from '@tasnivo/db';
import { effectiveRow, type EffectiveRow } from './export-effective.js';
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

export async function exportItems(catalogId: string): Promise<ExportItem[]> {
  const items = await db.catalogItem.findMany({
    where: { catalogId },
    orderBy: { rowIndex: 'asc' },
    select: {
      rowIndex: true, rawName: true, barcode: true, unit: true, existingMxik: true, attrs: true, checkError: true,
      findings: { select: { severity: true, decision: true, chosenMxik: true, decidedAt: true } },
    },
  });
  return items.map((item) => ({
    rowIndex: item.rowIndex,
    rawName: item.rawName,
    barcode: item.barcode,
    unit: item.unit,
    existingMxik: item.existingMxik,
    original: StoredAttrs.safeParse(item.attrs).data?.original ?? [],
    effective: effectiveRow(item.existingMxik, item.findings),
    checkError: item.checkError,
  }));
}

/** The unit to write: an accepted code with a strictly bound unit fixes it; otherwise the file's own. */
export function exportUnit(item: Pick<ExportItem, 'unit' | 'effective'>, units: Map<string, CodeUnit>): string {
  const accepted = item.effective.acceptedCode ? units.get(item.effective.acceptedCode) : undefined;
  return accepted?.unitBinding === 'strict' && accepted.unitCanonical[0] ? accepted.unitCanonical[0] : (item.unit ?? '');
}

export function exportPackaging(item: Pick<ExportItem, 'effective'>, units: Map<string, CodeUnit>): string {
  return item.effective.acceptedCode ? units.get(item.effective.acceptedCode)?.unitContainer ?? '' : '';
}
