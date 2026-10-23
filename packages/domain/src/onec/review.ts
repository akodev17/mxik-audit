// The review side of a batch: the history list, one batch with a page of its records, and the
// reviewer's decisions (approve, correct, skip, reopen) on one record or many. Every read is scoped
// like the catalogue pages: another org's batch, or a client the accountant may not open, is the
// same "not found" as a missing one.
import type { Prisma, RecordStatus } from '@prisma/client';
import { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { issuesOf, refreshCounts, statusFromIssues, type BatchCounts } from './batch-state.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type ReviewDecision = z.infer<typeof accounting.ReviewDecision>;
type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
type RecordOutcome = z.infer<typeof accounting.RecordOutcome>;
type ImportKind = (typeof accounting.IMPORT_KINDS)[number];
type ImportStatus = (typeof accounting.IMPORT_STATUSES)[number];
type OneCFormat = (typeof accounting.ONEC_FORMATS)[number];

/** Who is reading: the org and the clients they may open (null = all). */
export type Reader = { orgId: string; clientIds: string[] | null };
export type Actor = Reader & { userId: string };

export const BATCH_PAGE = 25;
export const RECORD_PAGE = 100;

function batchScope(r: Reader): Prisma.ImportBatchWhereInput {
  return r.clientIds === null ? { orgId: r.orgId } : { orgId: r.orgId, clientId: { in: r.clientIds } };
}

/** accounting.ImportBatchRow, as JSON. */
export type BatchRow = {
  id: string; kind: ImportKind; clientId: string | null; clientName: string | null; source: string; filename: string | null; externalRef: string | null;
  status: ImportStatus; counts: BatchCounts | null; error: string | null; createdAt: string; updatedAt: string;
  exports: { id: string; format: OneCFormat; filename: string | null; recordCount: number; createdAt: string; outcome: ImportOutcome | null; hasFile: boolean }[];
};

/** accounting.ImportRecordRow with the payload as stored (a record a reviewer must fix may not parse yet). */
export type RecordRow = {
  id: string; rowIndex: number; status: RecordStatus; payload: Record<string, unknown>; issues: ValidationIssue[];
  decision: ReviewDecision | null; decidedAt: string | null; outcome: RecordOutcome | null;
};

const batchSelect = {
  id: true, kind: true, clientId: true, source: true, filename: true, externalRef: true, status: true, counts: true, error: true, createdAt: true, updatedAt: true,
  client: { select: { name: true } },
  exports: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, format: true, filename: true, recordCount: true, createdAt: true, outcome: true, contentType: true } },
} satisfies Prisma.ImportBatchSelect;

type BatchSelected = Prisma.ImportBatchGetPayload<{ select: typeof batchSelect }>;

const jsonObject = <T>(v: Prisma.JsonValue | null): T | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as T : null);
const formatOf = (f: string): OneCFormat => ((accounting.ONEC_FORMATS as readonly string[]).includes(f) ? f as OneCFormat : 'odata');

function batchRow(b: BatchSelected): BatchRow {
  return {
    id: b.id, kind: b.kind, clientId: b.clientId, clientName: b.client?.name ?? null, source: b.source, filename: b.filename, externalRef: b.externalRef,
    status: b.status, counts: jsonObject<BatchCounts>(b.counts), error: b.error, createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    exports: b.exports.map((e) => ({
      id: e.id, format: formatOf(e.format), filename: e.filename, recordCount: e.recordCount, createdAt: e.createdAt.toISOString(),
      outcome: jsonObject<ImportOutcome>(e.outcome), hasFile: e.contentType !== null,
    })),
  };
}

function recordRow(r: { id: string; rowIndex: number; status: RecordStatus; payload: Prisma.JsonValue; issues: Prisma.JsonValue; decision: Prisma.JsonValue | null; decidedAt: Date | null; outcome: Prisma.JsonValue | null }): RecordRow {
  return {
    id: r.id, rowIndex: r.rowIndex, status: r.status, payload: jsonObject<Record<string, unknown>>(r.payload) ?? {}, issues: issuesOf(r.issues),
    decision: jsonObject<ReviewDecision>(r.decision), decidedAt: r.decidedAt?.toISOString() ?? null, outcome: jsonObject<RecordOutcome>(r.outcome),
  };
}

/** Whether the reader may open the batch (the API checks this before prepare, export and transfer). */
export async function visibleBatch(reader: Reader, batchId: string): Promise<boolean> {
  return (await db.importBatch.count({ where: { id: batchId, ...batchScope(reader) } })) > 0;
}

/** Whether the reader may work with this client's data (null = the org's own: only an unrestricted reader). */
export async function visibleClient(reader: Reader, clientId: string | null): Promise<boolean> {
  if (clientId === null) return reader.clientIds === null;
  if (reader.clientIds !== null && !reader.clientIds.includes(clientId)) return false;
  return (await db.client.count({ where: { id: clientId, orgId: reader.orgId } })) > 0;
}

export type BatchQuery = { kind?: ImportKind; status?: ImportStatus; client?: string; page: number };

/** `/onec`: every batch of the org the reader may see, newest first. */
export async function listBatches(reader: Reader, q: BatchQuery): Promise<{ rows: BatchRow[]; total: number; pageSize: number }> {
  const where: Prisma.ImportBatchWhereInput = {
    ...batchScope(reader),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.client ? { clientId: reader.clientIds === null || reader.clientIds.includes(q.client) ? q.client : '__none__' } : {}),
  };
  const [rows, total] = await Promise.all([
    db.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.page * BATCH_PAGE, take: BATCH_PAGE, select: batchSelect }),
    db.importBatch.count({ where }),
  ]);
  return { rows: rows.map(batchRow), total, pageSize: BATCH_PAGE };
}

export type RecordQuery = { status?: RecordStatus; page: number };

/** One batch, a page of its records, and the formats it can become. Null when the reader may not see it. */
export async function batchDetail(reader: Reader, batchId: string, q: RecordQuery): Promise<{
  batch: BatchRow; meta: unknown; records: RecordRow[]; total: number; pageSize: number; formats: OneCFormat[]; primary: OneCFormat;
} | null> {
  const batch = await db.importBatch.findFirst({ where: { id: batchId, ...batchScope(reader) }, select: { ...batchSelect, meta: true } });
  if (!batch) return null;
  const where: Prisma.ImportRecordWhereInput = { batchId, ...(q.status ? { status: q.status } : {}) };
  const [records, total] = await Promise.all([
    db.importRecord.findMany({
      where, orderBy: { rowIndex: 'asc' }, skip: q.page * RECORD_PAGE, take: RECORD_PAGE,
      select: { id: true, rowIndex: true, status: true, payload: true, issues: true, decision: true, decidedAt: true, outcome: true },
    }),
    db.importRecord.count({ where }),
  ]);
  return {
    batch: batchRow(batch), meta: batch.meta, records: records.map(recordRow), total, pageSize: RECORD_PAGE,
    formats: [...accounting.ONEC_FORMATS_BY_KIND[batch.kind]], primary: accounting.PRIMARY_FORMAT[batch.kind],
  };
}

// ── Decisions ──────────────────────────────────────────────────────────────────────────────

export type DecisionError = 'not_found' | 'already_exported' | 'has_errors' | 'invalid_correction' | 'invalid';
export type Decided = { ok: true; record: RecordRow; counts: BatchCounts; batchStatus: ImportStatus } | { ok: false; error: DecisionError; field?: string };

const PATH = /^[A-Za-z_][\w]*(\.(\d+|[A-Za-z_][\w]*))*$/;

/** Sets `path` (dot path, numeric segments index arrays) on a deep copy of `payload`. */
export function setPath(payload: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const root = structuredClone(payload);
  const parts = path.split('.');
  let node: Record<string, unknown> | unknown[] = root;
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const key: string | number = /^\d+$/.test(part) ? Number(part) : part;
    const bag = node as Record<string | number, unknown>;
    if (last) {
      bag[key] = value;
    } else {
      const next = bag[key];
      if (next === null || typeof next !== 'object') bag[key] = typeof parts[i + 1] === 'string' && /^\d+$/.test(parts[i + 1] ?? '') ? [] : {};
      node = bag[key] as Record<string, unknown>;
    }
  }
  return root;
}

/** An issue a correction answers: on the corrected field, inside it, or on the object that holds it. */
const answered = (issue: ValidationIssue, paths: readonly string[]): boolean =>
  issue.field !== undefined && paths.some((p) => p === issue.field || p.startsWith(`${issue.field}.`) || (issue.field ?? '').startsWith(`${p}.`));

/** The status a batch shows after its records changed. */
export function batchStatusFor(counts: BatchCounts, current: ImportStatus): ImportStatus {
  if (current === 'uploaded' || current === 'failed') return current;
  if (counts.unresolved + counts.suspicious > 0) return 'review';
  if (counts.valid + counts.corrected > 0) return 'approved';
  if (counts.exported > 0) return 'exported';
  return 'approved';
}

type Loaded = { id: string; batchId: string; status: RecordStatus; payload: Prisma.JsonValue; issues: Prisma.JsonValue; batch: { kind: ImportKind; status: ImportStatus } };

function applyDecision(rec: Loaded, d: ReviewDecision): { ok: true; status: RecordStatus; payload?: Record<string, unknown>; issues?: ValidationIssue[] } | { ok: false; error: DecisionError; field?: string } {
  if (rec.status === 'exported') return { ok: false, error: 'already_exported' };
  const issues = issuesOf(rec.issues);
  switch (d.action) {
    case 'skip':
      return { ok: true, status: 'skipped' };
    case 'reopen':
      return { ok: true, status: statusFromIssues(issues) };
    case 'approve':
      // An error stands until it is corrected (or the record skipped); warnings are accepted.
      if (issues.some((i) => i.severity === 'error')) return { ok: false, error: 'has_errors' };
      return { ok: true, status: rec.status === 'corrected' ? 'corrected' : 'valid' };
    case 'correct': {
      const entries = Object.entries(d.corrections ?? {});
      if (entries.length === 0 || entries.length > 50) return { ok: false, error: 'invalid' };
      let payload = jsonObject<Record<string, unknown>>(rec.payload) ?? {};
      for (const [path, value] of entries) {
        if (!PATH.test(path) || path.length > 120) return { ok: false, error: 'invalid', field: path };
        payload = setPath(payload, path, value);
      }
      const parsed = accounting.RECORD_SCHEMAS[rec.batch.kind].safeParse(payload);
      if (!parsed.success) return { ok: false, error: 'invalid_correction', field: parsed.error.issues[0]?.path.join('.') };
      const left = issues.filter((i) => !answered(i, entries.map(([p]) => p)));
      return { ok: true, status: left.some((i) => i.severity === 'error') ? 'unresolved' : 'corrected', payload, issues: left };
    }
  }
}

async function settleBatch(batchId: string, current: ImportStatus): Promise<{ counts: BatchCounts; batchStatus: ImportStatus }> {
  const counts = await refreshCounts(batchId);
  const batchStatus = batchStatusFor(counts, current);
  if (batchStatus !== current) await db.importBatch.update({ where: { id: batchId }, data: { status: batchStatus } });
  return { counts, batchStatus };
}

const recordSelect = { id: true, batchId: true, status: true, payload: true, issues: true, batch: { select: { kind: true, status: true } } } as const;

/** `PUT /api/onec/records/{recordId}/decision`. */
export async function decideRecord(actor: Actor, recordId: string, body: unknown): Promise<Decided> {
  const decision = accounting.ReviewDecision.safeParse(body);
  if (!decision.success) return { ok: false, error: 'invalid' };
  const rec = await db.importRecord.findFirst({ where: { id: recordId, batch: batchScope(actor) }, select: recordSelect });
  if (!rec) return { ok: false, error: 'not_found' };
  const applied = applyDecision(rec, decision.data);
  if (!applied.ok) return applied;
  const row = await db.importRecord.update({
    where: { id: rec.id },
    data: {
      status: applied.status, decision: decision.data, decidedBy: actor.userId, decidedAt: new Date(),
      ...(applied.payload ? { payload: applied.payload as Prisma.InputJsonValue } : {}),
      ...(applied.issues ? { issues: applied.issues } : {}),
    },
    select: { id: true, rowIndex: true, status: true, payload: true, issues: true, decision: true, decidedAt: true, outcome: true },
  });
  const settled = await settleBatch(rec.batchId, rec.batch.status);
  return { ok: true, record: recordRow(row), ...settled };
}

export type ManyDecided = { ok: true; count: number; refused: { id: string; error: DecisionError }[]; counts: BatchCounts; batchStatus: ImportStatus } | { ok: false; error: DecisionError };

/**
 * `POST /api/onec/batches/{batchId}/decisions`: approve, skip or reopen many records at once
 * (a correction is per record). Records the action cannot apply to (an error on approve, already
 * exported) are listed as refused; the rest change.
 */
export async function decideMany(actor: Actor, batchId: string, body: unknown): Promise<ManyDecided> {
  const parsed = accounting.ReviewDecision.safeParse((body as { decision?: unknown } | null)?.decision);
  const ids = (body as { recordIds?: unknown } | null)?.recordIds;
  if (!parsed.success || parsed.data.action === 'correct' || !Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || !ids.every((i) => typeof i === 'string')) {
    return { ok: false, error: 'invalid' };
  }
  const batch = await db.importBatch.findFirst({ where: { id: batchId, ...batchScope(actor) }, select: { id: true, status: true, kind: true } });
  if (!batch) return { ok: false, error: 'not_found' };
  const records = await db.importRecord.findMany({ where: { batchId, id: { in: ids as string[] } }, select: recordSelect });
  const refused: { id: string; error: DecisionError }[] = [];
  const byStatus = new Map<RecordStatus, string[]>();
  for (const rec of records) {
    const applied = applyDecision(rec, parsed.data);
    if (!applied.ok) refused.push({ id: rec.id, error: applied.error });
    else byStatus.set(applied.status, [...(byStatus.get(applied.status) ?? []), rec.id]);
  }
  const now = new Date();
  await db.$transaction([...byStatus].map(([status, idsFor]) => db.importRecord.updateMany({
    where: { id: { in: idsFor } }, data: { status, decision: parsed.data, decidedBy: actor.userId, decidedAt: now },
  })));
  const settled = await settleBatch(batchId, batch.status);
  const count = [...byStatus.values()].reduce((n, l) => n + l.length, 0);
  return { ok: true, count, refused: refused.slice(0, 200), ...settled };
}
