'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auditCatalog } from '@/lib/audit-runner';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { parseUpload } from '@/lib/spreadsheet';
import { currentUser } from '@/lib/session';
import { normalizeName } from '@/core/normalize/index';
import { readCode } from '@/core/audit/checks';
import { ColumnMapSchema, type ColumnMap } from '@/lib/column-map';

export type PreviewState = {
  error?: string;
  preview?: {
    /** The catalogue is created up front; the mapping is applied on commit. */
    catalogId: string;
    filename: string;
    headers: string[];
    /** First five rows only — the rest stay on the server. */
    rows: string[][];
    totalRows: number;
    truncated: boolean;
    suggested: ColumnMap;
  };
};

/** Header keywords, in both scripts, that identify each field. */
const HINTS: Record<keyof ColumnMap, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'продукт', 'name', 'product'],
  barcode: ['shtrix', 'shtrih', 'штрих', 'barcode', 'ean', 'gtin', 'bar code'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic', 'tasnif'],
  unit: ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit', 'uom'],
  price: ['narx', 'цена', 'price', 'summa', 'сумма', 'стоим'],
};

function guessMapping(headers: readonly string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (field: keyof ColumnMap): number => {
    const hints = HINTS[field];
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i] ?? '';
      if (hints.some((hint) => h.includes(hint))) return i;
    }
    return -1;
  };
  const name = find('name');
  // The name column is required; fall back to the first column.
  return {
    name: name === -1 ? 0 : name,
    barcode: find('barcode'),
    mxik: find('mxik'),
    unit: find('unit'),
    price: find('price'),
  };
}

const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK = 1000;

/** Rows as stored on the item: every original cell, for re-export and remapping. */
const StoredAttrs = z.object({ original: z.array(z.string()) });

function pick(row: readonly string[], index: number): string | null {
  if (index < 0) return null;
  const value = row[index];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

function deriveItem(catalogId: string, row: readonly string[], rowIndex: number, mapping: ColumnMap) {
  const rawName = pick(row, mapping.name) ?? '';
  const priceRaw = pick(row, mapping.price);
  const price = priceRaw === null
    ? null
    : Number(priceRaw.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return {
    catalogId,
    rowIndex,
    rawName,
    normalizedName: normalizeName(rawName).matchKey,
    barcode: pick(row, mapping.barcode),
    existingMxik: readCode(pick(row, mapping.mxik)),
    unit: pick(row, mapping.unit),
    price: price !== null && Number.isFinite(price) ? price : null,
    attrs: { original: [...row] },
  };
}

/**
 * Parses the upload, stores every row, and returns a five-row preview. The file
 * is read exactly once: the mapping is applied later against the stored cells,
 * so changing it does not mean re-uploading.
 */
export async function previewUpload(_prev: PreviewState, form: FormData): Promise<PreviewState> {
  const user = await currentUser();
  if (!user) return { error: t.errorGeneric };

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Fayl tanlanmadi.' };
  if (file.size > MAX_BYTES) return { error: 'Fayl juda katta (20 MB dan oshmasligi kerak).' };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseUpload(buffer, file.name);
    if (parsed.rows.length === 0) return { error: 'Faylda maʼlumot qatorlari topilmadi.' };

    const org = await db.organization.findUnique({
      where: { id: user.orgId },
      select: { columnMap: true },
    });
    const remembered = ColumnMapSchema.safeParse(org?.columnMap);
    // A remembered mapping only applies if it still fits this file's width.
    const fits = remembered.success
      && Object.values(remembered.data).every((i) => i < parsed.headers.length);
    const mapping = fits && remembered.success ? remembered.data : guessMapping(parsed.headers);

    const catalog = await db.catalog.create({
      data: {
        orgId: user.orgId,
        filename: file.name,
        rowCount: parsed.rows.length,
        status: 'uploaded',
        headers: parsed.headers,
        columnMap: mapping,
      },
    });

    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      await db.catalogItem.createMany({
        data: parsed.rows.slice(i, i + CHUNK).map((row, j) =>
          deriveItem(catalog.id, row, i + j, mapping)),
      });
    }

    await db.auditEvent.create({
      data: {
        orgId: user.orgId, actorId: user.userId, action: 'catalog.uploaded',
        targetId: catalog.id,
        payload: { filename: file.name, rowCount: parsed.rows.length, truncated: parsed.truncated },
      },
    });

    return {
      preview: {
        catalogId: catalog.id,
        filename: file.name,
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 5),
        totalRows: parsed.rows.length,
        truncated: parsed.truncated,
        suggested: mapping,
      },
    };
  } catch (error) {
    return { error: `Faylni oʻqishda xatolik: ${error instanceof Error ? error.message : ''}` };
  }
}

const CommitInput = z.object({
  catalogId: z.string().min(1),
  mapping: ColumnMapSchema,
});

export type CommitState = { error?: string; catalogId?: string };

/**
 * Applies the confirmed mapping to the stored rows and audits them. Only the
 * catalogue id and the mapping cross the wire — the row data never leaves the
 * server.
 */
export async function commitUpload(payload: unknown): Promise<CommitState> {
  const user = await currentUser();
  if (!user) return { error: t.errorGeneric };

  const parsed = CommitInput.safeParse(payload);
  if (!parsed.success) return { error: t.errorGeneric };
  const { catalogId, mapping } = parsed.data;

  // Scope by org: a catalogue id alone must not be enough to reach another org's data.
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, orgId: user.orgId },
    select: { id: true },
  });
  if (!catalog) return { error: t.errorGeneric };

  const stored = await db.catalogItem.findMany({
    where: { catalogId },
    orderBy: { rowIndex: 'asc' },
    select: { rowIndex: true, attrs: true },
  });

  // Re-derive from the original cells under the confirmed mapping. Replacing the
  // rows in bulk is far cheaper than updating each one.
  const rebuilt = stored.flatMap((item) => {
    const attrs = StoredAttrs.safeParse(item.attrs);
    if (!attrs.success) return [];
    const derived = deriveItem(catalogId, attrs.data.original, item.rowIndex, mapping);
    return derived.rawName === '' ? [] : [derived];
  });

  if (rebuilt.length === 0) {
    return { error: 'Tanlangan ustunda tovar nomlari topilmadi.' };
  }

  await db.$transaction(async (tx) => {
    await tx.catalogItem.deleteMany({ where: { catalogId } });
    for (let i = 0; i < rebuilt.length; i += CHUNK) {
      await tx.catalogItem.createMany({ data: rebuilt.slice(i, i + CHUNK) });
    }
    await tx.catalog.update({
      where: { id: catalogId },
      data: { status: 'analyzing', rowCount: rebuilt.length, columnMap: mapping },
    });
    await tx.organization.update({ where: { id: user.orgId }, data: { columnMap: mapping } });
  }, { timeout: 120_000 });

  try {
    const outcome = await auditCatalog(catalogId);
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'ready' } });
    await db.auditEvent.create({
      data: {
        orgId: user.orgId, actorId: user.userId, action: 'catalog.audited',
        targetId: catalogId,
        payload: {
          itemsAudited: outcome.itemsAudited,
          findingsCreated: outcome.findingsCreated,
          degraded: outcome.degraded,
          degradedReasons: outcome.degradedReasons,
          llm: outcome.llm,
          mapping,
        },
      },
    });
  } catch (error) {
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'failed' } });
    return { error: `Tahlil qilishda xatolik: ${error instanceof Error ? error.message : ''}` };
  }

  revalidatePath('/report');
  revalidatePath('/review');
  revalidatePath('/export');
  return { catalogId };
}
