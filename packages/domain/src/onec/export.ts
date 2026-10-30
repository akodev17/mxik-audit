// prepareExport and buildExport over the database (docs/TASNIVO_AI_PLAN_2026-10-23.md §4.3):
// load the batch and its records, plan (plan.ts), and for a build write the file, the onec_export
// row, each record's outcome and the batch's new state in one transaction, plus an AuditEvent like
// the catalogue export's. A repeat of the same request within IDEMPOTENCY_MS answers the export
// already made, as long as no record of the batch was decided since.
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { contentDisposition } from '../export-filename.js';
import type { FileOut } from '../catalog-exports.js';
import { issuesOf, refreshCounts } from './batch-state.js';
import { buildFile } from './files.js';
import { flagSameSet, formatAllowed, planExport, type OneCFormat, type Plan, type PlanBatch, type PlanRecord } from './plan.js';

type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
type RecordOutcome = z.infer<typeof accounting.RecordOutcome>;
type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;

export type PrepareInput = { orgId: string; batchId: string; format: OneCFormat; recordIds?: string[] };
export type Prepared =
  | { ok: true; records: number; issues: ValidationIssue[]; checks: ImportOutcome['checks'] }
  | { ok: false; error: string };
export type Built = { ok: true; exportId: string; file: FileOut; records: number; reused?: boolean } | { ok: false; error: string };

/** How long a repeat of the same export request answers the export already made. */
export const IDEMPOTENCY_MS = 10 * 60_000;

export type Loaded = { batch: PlanBatch & { orgId: string; clientId: string | null; filename: string | null; status: string }; records: PlanRecord[] };

/** The batch (of the org) and every record of it; null when the batch is not the org's. */
export async function loadBatch(orgId: string, batchId: string): Promise<Loaded | null> {
  const batch = await db.importBatch.findFirst({
    where: { id: batchId, orgId },
    select: { id: true, orgId: true, kind: true, meta: true, clientId: true, filename: true, status: true },
  });
  if (!batch) return null;
  const rows = await db.importRecord.findMany({
    where: { batchId }, orderBy: { rowIndex: 'asc' },
    select: { id: true, rowIndex: true, status: true, payload: true, issues: true, fingerprint: true, decision: true, outcome: true },
  });
  const records: PlanRecord[] = rows.map((r) => ({
    id: r.id, rowIndex: r.rowIndex, status: r.status, payload: r.payload, issues: issuesOf(r.issues), fingerprint: r.fingerprint,
    decision: r.decision && typeof r.decision === 'object' && !Array.isArray(r.decision) ? r.decision as { action?: string } : null,
    outcome: r.outcome && typeof r.outcome === 'object' && !Array.isArray(r.outcome) ? r.outcome as { result?: string; reason?: string | null } : null,
  }));
  return { batch, records };
}

/** Exported records of the org's other batches with any of these fingerprints. */
async function exportedElsewhere(orgId: string, batchId: string, fingerprints: string[]): Promise<Map<string, { batchId: string }>> {
  if (fingerprints.length === 0) return new Map();
  // One join on the fingerprint index; Prisma's relation filter took seconds for a 1 000-row statement.
  const rows = await db.$queryRaw<{ fingerprint: string; batchId: string }[]>`
    SELECT r.fingerprint, r."batchId"
    FROM import_record r JOIN import_batch b ON b.id = r."batchId"
    WHERE r.fingerprint = ANY(${fingerprints}) AND r.status = 'exported' AND r."batchId" <> ${batchId} AND b."orgId" = ${orgId}`;
  return new Map(rows.map((r) => [r.fingerprint, { batchId: r.batchId }]));
}

export type Planned = { ok: true; loaded: Loaded; plan: Plan } | { ok: false; error: string };

/** Loads and plans; the refusals every entry point shares. */
export async function planFor(input: PrepareInput): Promise<Planned> {
  if (!(accounting.ONEC_FORMATS as readonly string[]).includes(input.format)) return { ok: false, error: 'format_unknown' };
  const loaded = await loadBatch(input.orgId, input.batchId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { batch, records } = loaded;
  if (!formatAllowed(batch.kind, input.format)) return { ok: false, error: 'format_unsupported' };
  if (input.format === 'receipt_xlsx' && !accounting.IncomingInvoiceMeta.safeParse(batch.meta).success) return { ok: false, error: 'meta_invalid' };
  const fingerprints = [...new Set(records.flatMap((r) => (r.fingerprint ? [r.fingerprint] : [])))];
  let plan = planExport(batch, records, input.format, input.recordIds, { exportedElsewhere: await exportedElsewhere(input.orgId, batch.id, fingerprints) });
  if (plan.included.length > 0) {
    const earlier = await db.oneCExport.findFirst({
      where: { recordSetHash: plan.recordSetHash, format: input.format, batch: { orgId: input.orgId } },
      orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true },
    });
    if (earlier) plan = flagSameSet(plan, { exportId: earlier.id, createdAt: earlier.createdAt.toISOString() });
  }
  return { ok: true, loaded, plan };
}

/** Validates and de-duplicates the batch's approved records for `format`; reports what would go. Writes nothing. */
export async function prepareExport(input: PrepareInput): Promise<Prepared> {
  const planned = await planFor(input);
  if (!planned.ok) return planned;
  const { plan } = planned;
  return { ok: true, records: plan.included.length, issues: plan.issues, checks: plan.checks };
}

export function requestKey(format: OneCFormat, recordIds: readonly string[] | undefined): string {
  return createHash('sha256').update(`${format}|${recordIds ? [...recordIds].sort().join(',') : '*'}`).digest('hex');
}

const fileOut = (bytes: Uint8Array, filename: string, contentType: string): FileOut => ({
  body: new Uint8Array(bytes),
  headers: { 'content-type': contentType, 'content-disposition': contentDisposition('attachment', filename), 'cache-control': 'no-store' },
});

/** The outcome summary and per-reason counts of a plan. */
export function outcomeOf(format: OneCFormat, plan: Plan, imported: number, rejected = 0, extraReasons: Record<string, number> = {}): ImportOutcome {
  const reasons: Record<string, number> = { ...extraReasons };
  for (const l of plan.left) reasons[l.reason] = (reasons[l.reason] ?? 0) + 1;
  return { format, imported, skipped: plan.left.length, rejected, reasons, checks: plan.checks };
}

/**
 * Writes the per-record outcomes of an export: `imported` records become exported (primary formats
 * only), the left-out ones keep their status and get `skipped` with the reason. Records are
 * updated in groups that share one outcome, so a 1 000-row batch is a handful of statements.
 */
export async function recordOutcomes(
  tx: Prisma.TransactionClient, exportId: string, plan: Plan, imported: readonly { id: string; onecRef?: string | null; message?: string | null }[],
  rejected: readonly { id: string; reason: string; message: string | null }[] = [],
): Promise<void> {
  const base = { exportId, message: null, onecRef: null };
  const plain = imported.filter((r) => !r.onecRef && !r.message).map((r) => r.id);
  if (plain.length > 0) {
    const outcome: RecordOutcome = { ...base, result: 'imported', reason: null };
    await tx.importRecord.updateMany({ where: { id: { in: plain } }, data: { status: 'exported', outcome } });
  }
  // A transfer's record carries 1C's reference and what was left out of it (a reference not found, a refused posting).
  for (const r of imported.filter((x) => x.onecRef || x.message)) {
    const outcome: RecordOutcome = { ...base, result: 'imported', reason: null, onecRef: r.onecRef ?? null, message: r.message?.slice(0, 1000) ?? null };
    await tx.importRecord.update({ where: { id: r.id }, data: { status: 'exported', outcome } });
  }
  const byReason = new Map<string, string[]>();
  for (const l of plan.left) byReason.set(l.reason, [...(byReason.get(l.reason) ?? []), l.record.id]);
  for (const [reason, ids] of byReason) {
    const outcome: RecordOutcome = { ...base, result: 'skipped', reason };
    await tx.importRecord.updateMany({ where: { id: { in: ids } }, data: { outcome } });
  }
  for (const r of rejected) {
    const outcome: RecordOutcome = { ...base, result: 'rejected', reason: r.reason.slice(0, 60), message: r.message?.slice(0, 1000) ?? null };
    await tx.importRecord.update({ where: { id: r.id }, data: { outcome } });
  }
}

/** The owner's name for the bank file when the statement does not print one: the client's, else the org's. */
async function ownerName(orgId: string, clientId: string | null): Promise<string> {
  if (clientId) {
    const client = await db.client.findFirst({ where: { id: clientId, orgId }, select: { name: true } });
    if (client) return client.name;
  }
  return (await db.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name ?? '';
}

export async function bankKeysOf(orgId: string): Promise<'standard' | 'uz_mfo'> {
  const row = await db.oneCConnection.findUnique({ where: { orgId }, select: { bankKeys: true } });
  return row?.bankKeys === 'uz_mfo' ? 'uz_mfo' : 'standard';
}

/** Builds the 1C import file for the batch and records an onec_export row. */
export async function buildExport(input: PrepareInput & { actorId: string }): Promise<Built> {
  if (input.format === 'odata' || input.format === 'http') return { ok: false, error: 'format_not_file' };
  const key = requestKey(input.format, input.recordIds);
  const recent = await db.oneCExport.findFirst({
    where: { batchId: input.batchId, format: input.format, requestKey: key, createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_MS) }, batch: { orgId: input.orgId } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, file: true, filename: true, contentType: true, recordCount: true },
  });
  if (recent?.file) {
    const changed = await db.importRecord.count({ where: { batchId: input.batchId, decidedAt: { gt: recent.createdAt } } });
    if (changed === 0) return { ok: true, exportId: recent.id, file: fileOut(recent.file, recent.filename ?? 'export', recent.contentType ?? 'application/octet-stream'), records: recent.recordCount, reused: true };
  }

  const planned = await planFor(input);
  if (!planned.ok) return planned;
  const { loaded: { batch, records }, plan } = planned;
  if (plan.included.length === 0) return { ok: false, error: 'nothing_to_export' };
  const included = new Set(plan.included.map((i) => i.record.id));
  const statementLines = records.filter((r) => r.status !== 'skipped');
  const built = await buildFile(batch, plan, input.format, {
    bankKeys: await bankKeysOf(input.orgId),
    ownerName: await ownerName(input.orgId, batch.clientId),
    filename: batch.filename,
    wholeStatement: statementLines.every((r) => included.has(r.id)),
    now: new Date(),
    batchRecords: records.filter((r) => r.status !== 'skipped'),
  });

  const outcome = outcomeOf(input.format, plan, plan.included.length);
  const exportId = await db.$transaction(async (tx) => {
    const row = await tx.oneCExport.create({
      data: {
        batchId: batch.id, format: input.format, filename: built.filename, recordCount: plan.included.length, outcome,
        file: new Uint8Array(built.bytes), contentType: built.contentType, requestKey: key, recordSetHash: plan.recordSetHash, createdBy: input.actorId,
      },
      select: { id: true },
    });
    // A side file (an invoice's products, a statement's counterparties) leaves the records as they are.
    if (plan.primary) {
      await recordOutcomes(tx, row.id, plan, plan.included.map((i) => ({ id: i.record.id })));
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: 'exported', error: null } });
      await refreshCounts(batch.id, tx);
    }
    await tx.auditEvent.create({
      data: {
        orgId: input.orgId, actorId: input.actorId, action: 'onec.exported', targetId: batch.id,
        payload: { batchId: batch.id, clientId: batch.clientId, kind: batch.kind, format: input.format, exportId: row.id, imported: outcome.imported, skipped: outcome.skipped },
      },
    });
    return row.id;
  }, { timeout: 60_000 });
  return { ok: true, exportId, file: fileOut(built.bytes, built.filename, built.contentType), records: plan.included.length };
}

/** A stored export's file again (the history's download link); null when it is not the org's or has no file. */
export async function exportFile(orgId: string, exportId: string, clientIds: string[] | null = null): Promise<FileOut | null> {
  const row = await db.oneCExport.findFirst({
    where: { id: exportId, batch: { orgId, ...(clientIds !== null ? { clientId: { in: clientIds } } : {}) } },
    select: { file: true, filename: true, contentType: true },
  });
  if (!row?.file) return null;
  return fileOut(row.file, row.filename ?? 'export', row.contentType ?? 'application/octet-stream');
}
