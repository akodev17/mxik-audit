// Turning an uploaded file into a stored catalogue: column-mapping guess, row
// derivation, storage, and applying a confirmed mapping. Shared by the web
// upload and the Telegram bot. Server-only.
import { z } from 'zod';
import { readCode } from '../core/audit/checks.js';
import { normalizeName } from '../core/normalize/index.js';
import { ColumnMapSchema, type ColumnMap } from './column-map.js';
import { db } from './db.js';
import type { ParseResult } from './spreadsheet.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const CHUNK = 1000;

/** Header keywords, in both scripts, that identify each field. */
const HINTS: Record<keyof ColumnMap, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'продукт', 'name', 'product'],
  barcode: ['shtrix', 'shtrih', 'штрих', 'barcode', 'ean', 'gtin', 'bar code'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic', 'tasnif'],
  unit: ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit', 'uom'],
  price: ['narx', 'цена', 'price', 'summa', 'сумма', 'стоим'],
};

export function guessMapping(headers: readonly string[]): ColumnMap {
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

/** The org's remembered mapping when it still fits this file's width, else a guess. */
export async function mappingFor(orgId: string, headers: readonly string[]): Promise<ColumnMap> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { columnMap: true } });
  const remembered = ColumnMapSchema.safeParse(org?.columnMap);
  const fits = remembered.success && Object.values(remembered.data).every((i) => i < headers.length);
  return fits && remembered.success ? remembered.data : guessMapping(headers);
}

/** Rows as stored on the item: every original cell, for re-export and remapping. */
export const StoredAttrs = z.object({ original: z.array(z.string()) });

function pick(row: readonly string[], index: number): string | null {
  if (index < 0) return null;
  const value = row[index];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/** "1 234 567,50" or "1,234,567.50" → 1234567.5; null when not a number. */
export function parseAmount(raw: string | null): number | null {
  if (raw === null) return null;
  // \s also covers the no-break space Excel uses to group thousands.
  const compact = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  // The last separator is the decimal one; the others group thousands.
  const lastSep = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
  const normalized = lastSep === -1
    ? compact
    : `${compact.slice(0, lastSep).replace(/[.,]/g, '')}.${compact.slice(lastSep + 1)}`;
  const n = Number(normalized);
  return normalized !== '' && Number.isFinite(n) ? n : null;
}

export function deriveItem(catalogId: string, row: readonly string[], rowIndex: number, mapping: ColumnMap) {
  const rawName = pick(row, mapping.name) ?? '';
  return {
    catalogId,
    rowIndex,
    rawName,
    normalizedName: normalizeName(rawName).matchKey,
    barcode: pick(row, mapping.barcode),
    existingMxik: readCode(pick(row, mapping.mxik)),
    unit: pick(row, mapping.unit),
    price: parseAmount(pick(row, mapping.price)),
    attrs: { original: [...row] },
  };
}

export type StoreInput = {
  orgId: string;
  userId: string | null;
  clientId: string;
  filename: string;
  parsed: ParseResult;
  mapping: ColumnMap;
  telegramChatId?: string | null;
};

/** Stores the catalogue and every row; the audit starts once the mapping is confirmed. */
export async function storeCatalog(input: StoreInput): Promise<{ catalogId: string }> {
  const { orgId, userId, clientId, filename, parsed, mapping } = input;
  const catalog = await db.catalog.create({
    data: {
      orgId, clientId, filename,
      rowCount: parsed.rows.length,
      status: 'uploaded',
      headers: parsed.headers,
      columnMap: mapping,
      telegramChatId: input.telegramChatId ?? null,
    },
  });
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    await db.catalogItem.createMany({
      data: parsed.rows.slice(i, i + CHUNK).map((row, j) => deriveItem(catalog.id, row, i + j, mapping)),
    });
  }
  await db.auditEvent.create({
    data: {
      orgId, actorId: userId, action: 'catalog.uploaded', targetId: catalog.id,
      payload: {
        filename, rowCount: parsed.rows.length, truncated: parsed.truncated, clientId,
        ...(input.telegramChatId ? { via: 'telegram' } : {}),
      },
    },
  });
  return { catalogId: catalog.id };
}

/**
 * Re-derives every stored row under the confirmed mapping and remembers the
 * mapping for the org. Replacing rows in bulk is far cheaper than updating each.
 */
export async function applyMapping(orgId: string, catalogId: string, mapping: ColumnMap): Promise<{ rows: number } | { error: string }> {
  const stored = await db.catalogItem.findMany({
    where: { catalogId },
    orderBy: { rowIndex: 'asc' },
    select: { rowIndex: true, attrs: true },
  });
  const rebuilt = stored.flatMap((item) => {
    const attrs = StoredAttrs.safeParse(item.attrs);
    if (!attrs.success) return [];
    const derived = deriveItem(catalogId, attrs.data.original, item.rowIndex, mapping);
    return derived.rawName === '' ? [] : [derived];
  });
  if (rebuilt.length === 0) return { error: 'Tanlangan ustunda tovar nomlari topilmadi.' };

  await db.$transaction(async (tx) => {
    await tx.catalogItem.deleteMany({ where: { catalogId } });
    for (let i = 0; i < rebuilt.length; i += CHUNK) {
      await tx.catalogItem.createMany({ data: rebuilt.slice(i, i + CHUNK) });
    }
    await tx.catalog.update({ where: { id: catalogId }, data: { status: 'analyzing', rowCount: rebuilt.length, columnMap: mapping } });
    await tx.organization.update({ where: { id: orgId }, data: { columnMap: mapping } });
  }, { timeout: 120_000 });
  return { rows: rebuilt.length };
}
