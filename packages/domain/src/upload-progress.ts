// Where a committed upload stands, for the wizard's processing and done steps:
// rows audited so far with an estimate, a failure, or the completion summary.
// Scoped to what the user may see. Server-only.
import { catalogScope } from './access.js';
import { db } from '@tasnivo/db';
import { readImportMeta } from './import-diagnostics.js';
import { findingTypeCounts } from './finding-type-counts.js';
import { RISKY_ITEM } from './risk.js';
import type { ScopedActor } from './upload-preview.js';

export type CompletionSummary = {
  rows: number;
  riskyRows: number;
  byType: { type: string; count: number }[];
  /** Decisions copied from the client's previous version (still attributed to their decider). */
  carried: number;
  previousId: string | null;
  /** Rows of the file that were not imported: past the row limit, or without a name. */
  notRead: number;
  dropped: number;
};

export type UploadProgress =
  | { status: 'uploaded' }
  | { status: 'analyzing'; done: number; total: number; etaSeconds: number | null }
  | { status: 'failed' }
  | { status: 'ready'; summary: CompletionSummary };

/** Seconds left at the rate so far; null until there is enough to go on. */
export function etaSeconds(done: number, total: number, startedAt: Date | null, now: Date): number | null {
  if (!startedAt || done < 20 || done >= total) return null;
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  if (elapsed < 5) return null;
  return Math.ceil((total - done) / (done / elapsed));
}

async function summary(catalogId: string, rowCount: number, previousId: string | null, importMeta: unknown): Promise<CompletionSummary> {
  const [riskyRows, byType, carried] = await Promise.all([
    db.catalogItem.count({ where: { catalogId, ...RISKY_ITEM } }),
    findingTypeCounts(catalogId, { risky: true }),
    db.finding.count({ where: { item: { catalogId }, decisionSource: 'carry_over' } }),
  ]);
  const meta = readImportMeta(importMeta);
  return {
    rows: rowCount,
    riskyRows,
    byType: byType.sort((a, b) => b.count - a.count),
    carried,
    previousId,
    notRead: meta?.parse.truncated ? Math.max(0, meta.parse.totalSeen - meta.diagnostics.rows) : 0,
    dropped: meta?.diagnostics.noName.count ?? 0,
  };
}

export async function uploadProgress(actor: ScopedActor, catalogId: string, now = new Date()): Promise<UploadProgress | null> {
  const catalog = await db.catalog.findFirst({
    where: { id: catalogId, ...catalogScope(actor) },
    select: { status: true, rowCount: true, progressDone: true, auditStartedAt: true, previousId: true, importMeta: true },
  });
  if (!catalog) return null;
  if (catalog.status === 'uploaded') return { status: 'uploaded' };
  if (catalog.status === 'failed') return { status: 'failed' };
  if (catalog.status === 'analyzing') {
    return {
      status: 'analyzing', done: catalog.progressDone, total: catalog.rowCount,
      etaSeconds: etaSeconds(catalog.progressDone, catalog.rowCount, catalog.auditStartedAt, now),
    };
  }
  return { status: 'ready', summary: await summary(catalogId, catalog.rowCount, catalog.previousId, catalog.importMeta) };
}
