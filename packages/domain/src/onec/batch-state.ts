// A batch's derived state: its counts by record status (import_batch.counts) and the status a
// record falls back to from its issues. Every place that changes records calls refreshCounts so
// lists and the review grid agree.
import type { Prisma, RecordStatus } from '@prisma/client';
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

export const EMPTY_COUNTS: BatchCounts = { total: 0, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 };

/** Recounts the batch's records by status and stores the counts; answers them. */
export async function refreshCounts(batchId: string, tx: Prisma.TransactionClient = db): Promise<BatchCounts> {
  const groups = await tx.importRecord.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } });
  const counts = { ...EMPTY_COUNTS };
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.total += g._count._all;
  }
  await tx.importBatch.update({ where: { id: batchId }, data: { counts } });
  return counts;
}
