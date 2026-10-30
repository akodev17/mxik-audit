// A batch's derived state: its counts by record status (import_batch.counts) and the status a
// record falls back to from its issues. Every place that changes records calls refreshCounts so
// lists and the review grid agree.
import { Prisma, type RecordStatus } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
export type BatchCounts = z.infer<typeof accounting.BatchCounts>;

/** An error keeps a record unresolved; a warning makes it suspicious; otherwise it is valid. */
export function statusFromIssues(issues: readonly ValidationIssue[]): RecordStatus {
  if (issues.some((i) => i.severity === 'error')) return 'unresolved';
  if (issues.some((i) => i.severity === 'warning')) return 'suspicious';
  return 'valid';
}

export function issuesOf(value: Prisma.JsonValue | null | undefined): ValidationIssue[] {
  return Array.isArray(value) ? (value as unknown as ValidationIssue[]) : [];
}

/** Valid or corrected with an approving decision (plan.ts `approved`, B5): what the next export sends. */
export const approvedWhere = (batchId: string): Prisma.ImportRecordWhereInput => ({
  batchId, status: { in: ['valid', 'corrected'] },
  OR: [{ decision: { path: ['action'], equals: 'approve' } }, { decision: { path: ['action'], equals: 'correct' } }],
});

export const EMPTY_COUNTS: BatchCounts = { total: 0, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 };

/**
 * Recounts the batch's records by status and stores the counts; answers them. `approved` (valid or
 * corrected with an approving decision) is recounted too; any other key a workstream keeps in
 * import_batch.counts (`progress` while a statement is read) is left as it was.
 */
export async function refreshCounts(batchId: string, tx: Prisma.TransactionClient = db): Promise<BatchCounts> {
  const [groups, approved, batch] = await Promise.all([
    tx.importRecord.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } }),
    tx.importRecord.count({ where: approvedWhere(batchId) }),
    tx.importBatch.findUnique({ where: { id: batchId }, select: { counts: true } }),
  ]);
  const kept = batch?.counts && typeof batch.counts === 'object' && !Array.isArray(batch.counts) ? batch.counts as Record<string, unknown> : {};
  const counts: BatchCounts = { ...(kept as Partial<BatchCounts>), ...EMPTY_COUNTS, approved };
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.total += g._count._all;
  }
  await tx.importBatch.update({ where: { id: batchId }, data: { counts: counts } });
  return counts;
}
