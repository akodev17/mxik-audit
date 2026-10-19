// Turning an uploaded file into a stored catalogue: storage of the preview,
// row derivation, and applying a confirmed mapping. Shared by the web upload,
// the Telegram bot and the public API. Server-only.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { readCode } from '../core/audit/checks.js';
import { normalizeName } from '../core/normalize/index.js';
import { parseAmount } from './amount.js';
import { mappingIssues, type ColumnField, type ColumnMap } from './column-map.js';
import { db } from './db.js';
import { importDiagnostics, type ImportMeta } from './import-diagnostics.js';
import { suggestMapping, type FieldSource, type MemorySource } from './mapping-memory.js';
import type { ParseResult } from './spreadsheet.js';

export { guessMapping } from './mapping-guess.js';
export { parseAmount } from './amount.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const CHUNK = 1000;
/** Long enough for 60 000 rows; the claim's heartbeat keeps the stale-audit sweep away meanwhile. */
const TX_TIMEOUT = 180_000;

/** The remembered or guessed mapping for these headers (client first, then org, then the header guess). */
export async function mappingFor(orgId: string, headers: readonly string[], clientId: string | null = null): Promise<ColumnMap> {
  return (await suggestMapping(orgId, clientId, headers)).mapping;
}

/** Rows as stored on the item: every original cell, for re-export and remapping. */
export const StoredAttrs = z.object({ original: z.array(z.string()) });

function pick(row: readonly string[], index: number): string | null {
  if (index < 0) return null;
  const value = row[index];
  return value === undefined || value.trim() === '' ? null : value.trim();
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
    salesAmount: parseAmount(pick(row, mapping.sales)),
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
  /** How the suggested mapping was made, kept for the mapping screen. */
  suggestion?: { remembered: MemorySource | null; fields: Record<ColumnField, FieldSource> };
};

export function initialImportMeta(parsed: ParseResult, mapping: ColumnMap, suggestion: StoreInput['suggestion']): ImportMeta {
  return {
    parse: parsed.meta,
    diagnostics: importDiagnostics(parsed.rows, mapping),
    remembered: suggestion?.remembered ?? null,
    ...(suggestion ? { fields: suggestion.fields } : {}),
  };
}

/**
 * Stores the catalogue and every row in one transaction, so a failure leaves
 * no half-stored preview. The audit starts once the mapping is confirmed.
 */
export async function storeCatalog(input: StoreInput): Promise<{ catalogId: string }> {
  const { orgId, userId, clientId, filename, parsed, mapping } = input;
  const importMeta = initialImportMeta(parsed, mapping, input.suggestion) as unknown as Prisma.InputJsonValue;
  return db.$transaction(async (tx) => {
    const catalog = await tx.catalog.create({
      data: {
        orgId, clientId, filename,
        rowCount: parsed.rows.length,
        status: 'uploaded',
        headers: parsed.headers,
        columnMap: mapping,
        importMeta,
        telegramChatId: input.telegramChatId ?? null,
      },
    });
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      await tx.catalogItem.createMany({
        data: parsed.rows.slice(i, i + CHUNK).map((row, j) => deriveItem(catalog.id, row, i + j, mapping)),
      });
    }
    await tx.auditEvent.create({
      data: {
        orgId, actorId: userId, action: 'catalog.uploaded', targetId: catalog.id,
        payload: {
          catalogId: catalog.id, clientId, filename, rowCount: parsed.rows.length,
          totalSeen: parsed.totalSeen, truncated: parsed.truncated,
          ...(input.telegramChatId ? { via: 'telegram' } : {}),
        },
      },
    });
    return { catalogId: catalog.id };
  }, { timeout: TX_TIMEOUT });
}

/** Every stored row's original cells, in file order. */
export async function storedRows(catalogId: string): Promise<string[][]> {
  const stored = await db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' }, select: { attrs: true } });
  return stored.map((item) => StoredAttrs.safeParse(item.attrs).data?.original ?? []);
}

export type ApplyError = 'not_uploaded' | 'bad_mapping' | 'no_names' | 'failed';

/** Puts a claimed catalogue back to "uploaded" so its mapping can be fixed. */
async function release(catalogId: string): Promise<void> {
  await db.catalog.updateMany({ where: { id: catalogId, status: 'analyzing' }, data: { status: 'uploaded', auditHeartbeatAt: null } }).catch(() => undefined);
}

/**
 * Claims the catalogue (uploaded → analyzing, atomically) and re-derives every
 * stored row under the confirmed mapping. A second commit of the same upload,
 * a double click or a commit of an audited catalogue finds nothing to claim and
 * changes nothing, so no decision can be lost. On any failure the claim is
 * released and the preview stays as it was.
 */
export async function applyMapping(orgId: string, catalogId: string, mapping: ColumnMap): Promise<{ rows: number } | { error: ApplyError }> {
  const claimed = await db.catalog.updateMany({
    where: { id: catalogId, orgId, status: 'uploaded' },
    // The heartbeat keeps resumeStaleAudits from launching an audit while rows are rebuilt.
    data: { status: 'analyzing', progressDone: 0, auditHeartbeatAt: new Date(), auditError: null },
  });
  if (claimed.count === 0) return { error: 'not_uploaded' };

  try {
    const catalog = await db.catalog.findUniqueOrThrow({ where: { id: catalogId }, select: { headers: true, importMeta: true } });
    if (mappingIssues(mapping, catalog.headers.length).length > 0) {
      await release(catalogId);
      return { error: 'bad_mapping' };
    }
    const rows = await storedRows(catalogId);
    const rebuilt = rows.flatMap((original, rowIndex) => {
      const derived = deriveItem(catalogId, original, rowIndex, mapping);
      return derived.rawName === '' ? [] : [derived];
    });
    if (rebuilt.length === 0) {
      await release(catalogId);
      return { error: 'no_names' };
    }
    const previous = (catalog.importMeta ?? {}) as Record<string, unknown>;
    const importMeta = { ...previous, diagnostics: importDiagnostics(rows, mapping) } as Prisma.InputJsonValue;

    await db.$transaction(async (tx) => {
      await tx.catalogItem.deleteMany({ where: { catalogId } });
      for (let i = 0; i < rebuilt.length; i += CHUNK) {
        await tx.catalogItem.createMany({ data: rebuilt.slice(i, i + CHUNK) });
      }
      await tx.catalog.update({ where: { id: catalogId }, data: { rowCount: rebuilt.length, columnMap: mapping, importMeta } });
    }, { timeout: TX_TIMEOUT });
    return { rows: rebuilt.length };
  } catch {
    await release(catalogId);
    return { error: 'failed' };
  }
}
