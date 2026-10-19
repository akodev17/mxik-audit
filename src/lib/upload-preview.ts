// The upload wizard's view of one catalogue: the preview to map (also when the
// user comes back to /upload?catalog=…), and discarding it. Scoped to what the
// user may see. Server-only.
import { canWrite, catalogScope } from './access.js';
import type { Role } from './session.js';
import { StoredAttrs } from './catalog-import.js';
import { COLUMN_FIELDS, ColumnMapSchema, type ColumnField, type ColumnMap } from './column-map.js';
import { db } from './db.js';
import { readImportMeta, type ImportDiagnostics } from './import-diagnostics.js';
import type { FieldSource, MemorySource } from './mapping-memory.js';
import type { ParseMeta } from './spreadsheet.js';

/** Who is asking: the org and, for a scoped accountant, the clients they may open. */
export type ScopedActor = { orgId: string; clientIds?: string[] | null };

/** Rows shown in the preview table. */
export const SAMPLE_ROWS = 8;

export type PreviousVersion = { id: string; filename: string; createdAt: string; rowCount: number };

export type UploadPreview = {
  catalogId: string;
  filename: string;
  client: { id: string; name: string };
  headers: string[];
  sample: string[][];
  /** Data rows stored for this upload. */
  rows: number;
  parse: ParseMeta | null;
  mapping: ColumnMap;
  remembered: MemorySource | null;
  fields: Record<ColumnField, FieldSource>;
  diagnostics: ImportDiagnostics | null;
  /** The client's latest audited catalogue: the version this one will be compared with. */
  previous: PreviousVersion | null;
};

const guessedFields = (mapping: ColumnMap): Record<ColumnField, FieldSource> =>
  Object.fromEntries(COLUMN_FIELDS.map((f) => [f, mapping[f] >= 0 ? 'guess' : 'none'])) as Record<ColumnField, FieldSource>;

export async function previousVersion(orgId: string, clientId: string | null, excludeId: string): Promise<PreviousVersion | null> {
  if (!clientId) return null;
  const prev = await db.catalog.findFirst({
    where: { orgId, clientId, status: 'ready', id: { not: excludeId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, filename: true, createdAt: true, rowCount: true },
  });
  return prev ? { ...prev, createdAt: prev.createdAt.toISOString() } : null;
}

/** The preview of an upload still waiting for its mapping; null when it is not one, or not the user's. */
export async function uploadPreview(actor: ScopedActor, catalogId: string): Promise<UploadPreview | null> {
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(actor), status: 'uploaded' },
    select: { id: true, filename: true, headers: true, columnMap: true, importMeta: true, rowCount: true, client: { select: { id: true, name: true } } },
  });
  if (!catalog?.client) return null;
  const mapping = ColumnMapSchema.safeParse(catalog.columnMap);
  if (!mapping.success) return null;
  const [items, previous] = await Promise.all([
    db.catalogItem.findMany({ where: { catalogId }, orderBy: { rowIndex: 'asc' }, take: SAMPLE_ROWS, select: { attrs: true } }),
    previousVersion(actor.orgId, catalog.client.id, catalogId),
  ]);
  const meta = readImportMeta(catalog.importMeta);
  return {
    catalogId: catalog.id,
    filename: catalog.filename,
    client: catalog.client,
    headers: catalog.headers,
    sample: items.map((i) => StoredAttrs.safeParse(i.attrs).data?.original ?? []),
    rows: catalog.rowCount,
    parse: meta?.parse ?? null,
    mapping: mapping.data,
    remembered: meta?.remembered ?? null,
    fields: meta?.fields ?? guessedFields(mapping.data),
    diagnostics: meta?.diagnostics ?? null,
    previous,
  };
}

/** Deletes an upload that was never committed. Committed catalogues are not touched here. */
export async function discardUpload(actor: ScopedActor & { userId: string; role?: Role }, catalogId: string): Promise<boolean> {
  // Viewers never delete uploads; callers without a role are trusted server code (the daily sweep).
  if (actor.role !== undefined && !canWrite({ role: actor.role })) return false;
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(actor), status: 'uploaded' },
    select: { id: true, clientId: true, filename: true, rowCount: true },
  });
  if (!catalog) return false;
  const removed = await db.catalog.deleteMany({ where: { id: catalog.id, status: 'uploaded' } });
  if (removed.count === 0) return false;
  await db.auditEvent.create({
    data: {
      orgId: actor.orgId, actorId: actor.userId, action: 'catalog.upload_discarded', targetId: catalog.id,
      payload: { catalogId: catalog.id, clientId: catalog.clientId, filename: catalog.filename, rowCount: catalog.rowCount },
    },
  });
  return true;
}
