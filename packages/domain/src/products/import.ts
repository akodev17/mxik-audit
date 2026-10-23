// The product catalogue import: read a file (XLSX/CSV, a 1C «Номенклатура» list saved to Excel),
// suggest the column mapping (remembered → 1C preset → guess), then on commit store it as an
// import_batch of kind product_catalog with one ProductRecord per row, and classify + match the rows
// in chunks of CHUNK with the progress in import_batch.meta. The reviewer accepts suggestions or
// skips rows, then saves the batch into the product catalogue (upsertProducts). Server-only.
//
// Two optional keys ride on a record's payload next to the ProductRecord fields: `match` (the
// MatchResult against existing products) and `alternatives` (runner-up codes). Proposed for the
// shared contract in docs/accounting-2026-10-23/handoff-agent4.md.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { z } from 'zod';
import { canSeeClient, canWrite } from '../access.js';
import { auditContext } from '../audit-runner.js';
import type { UploadedFile } from '../catalog-upload.js';
import { MAX_UPLOAD_BYTES } from '../catalog-import.js';
import { isDemoOrg } from '../demo.js';
import type { CurrentUser } from '../session.js';
import { parseErrorCode, parseUpload } from '../spreadsheet.js';
import { hasUploadExtension } from '../upload-file-types.js';
import { classifyDetailed, type DetailedClassification } from './classify.js';
import { prepareExport, productFingerprint, refreshCounts } from '../onec/index.js';
import { handOverBatch, type Handover } from './catalog.js';
import {
  applyProductPreset, EMPTY_MAP, guessProductMapping, mappingProblem, namedMapping, PRODUCT_FIELDS, PRODUCT_PRESETS, resolveNamed, type ProductColumnMap,
} from './import-map.js';
import { mxikOf } from './keys.js';
import { matchLines } from './match.js';
import { upsertRecords } from './upsert.js';

type ProductRecord = z.infer<typeof accounting.ProductRecord>;
type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type MatchResult = z.infer<typeof accounting.MatchResult>;
type MatchCandidate = z.infer<typeof accounting.MatchCandidate>;
type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];

/** Rows classified per chunk (one auditContext for the whole batch). */
export const CHUNK = 100;
export const RECORD_PAGE = 100;
const SAMPLE_ROWS = 8;
/** A batch whose progress has not moved for this long is resumed by the next status read (a restarted API). */
const STALL_MS = 90_000;

/** The payload as stored: a ProductRecord plus the two optional keys described above. */
export const StoredPayload = accounting.ProductRecord.extend({
  match: accounting.MatchResult.nullable().optional(),
  alternatives: z.array(accounting.MatchCandidate).optional(),
});
export type StoredPayload = z.infer<typeof StoredPayload>;

type Meta = z.infer<typeof accounting.ProductCatalogMeta> & { progress?: { done: number; total: number }; locale?: Locale; dropped?: number };

const readMeta = (v: Prisma.JsonValue | null): Meta => {
  const m = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Partial<Meta>;
  return { source: m.source ?? 'xlsx', headers: m.headers ?? [], columnMap: m.columnMap ?? {}, catalogId: m.catalogId ?? null, progress: m.progress, locale: m.locale, dropped: m.dropped };
};

const cell = (row: readonly string[], i: number): string | null => {
  if (i < 0) return null;
  const v = (row[i] ?? '').trim();
  return v === '' ? null : v;
};

/** The record status an issue list implies: an error stays unresolved, a warning is suspicious. */
export function statusOfIssues(issues: readonly ValidationIssue[]): RecordStatus {
  if (issues.some((i) => i.severity === 'error')) return 'unresolved';
  if (issues.some((i) => i.severity === 'warning')) return 'suspicious';
  return 'valid';
}

/** A file row as an unchecked ProductRecord; null for a row without a name. */
export function recordOfRow(row: readonly string[], map: ProductColumnMap): ProductRecord | null {
  const name = cell(row, map.name);
  if (!name) return null;
  const raw = cell(row, map.mxik);
  const { code } = mxikOf(raw);
  return {
    productId: null, name: name.slice(0, 500), onecRef: cell(row, map.onecRef)?.slice(0, 80) ?? null,
    // A malformed code is kept as written only in the issue; the record's mxik is a 17-digit code or null.
    mxik: code, mxikName: null, packageCode: cell(row, map.packageCode)?.slice(0, 40) ?? null, packageName: null,
    unit: cell(row, map.unit)?.slice(0, 60) ?? null, barcode: cell(row, map.barcode)?.replace(/\s/g, '').slice(0, 40) ?? null,
    aliases: [], mxikStatus: 'unchecked', mxikSuggestion: null, markingRequired: null,
  };
}

const wrote = (user: CurrentUser | null): user is CurrentUser => user !== null && canWrite(user);

async function clientFor(user: CurrentUser, clientId: string | null | undefined): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (!clientId || clientId === 'own') return user.clientIds == null ? { ok: true, id: null } : { ok: false };
  if (!canSeeClient(user, clientId)) return { ok: false };
  const c = await db.client.findFirst({ where: { id: clientId, orgId: user.orgId, archivedAt: null }, select: { id: true } });
  return c ? { ok: true, id: c.id } : { ok: false };
}

async function readFile(file: UploadedFile | null, locale: Locale) {
  const { ta } = i18nFor(locale);
  const e = ta.importX.errors;
  if (!file) return { ok: false as const, error: e.none };
  if (!hasUploadExtension(file.name)) return { ok: false as const, error: e.fileType };
  if (file.size === 0) return { ok: false as const, error: e.zeroBytes };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false as const, error: e.tooBig };
  const bytes = await file.read();
  try {
    return { ok: true as const, bytes, parsed: await parseUpload(bytes, file.name) };
  } catch (error) {
    // The catalogue upload's own wording per reason (legacy .xls, zip limits, binary, …).
    return { ok: false as const, error: e[parseErrorCode(error)] ?? ta.productsX.importWizard.errors.file };
  }
}

/** The org's (preferably the client's) latest import mapping, resolved on these headers. */
async function rememberedMapping(orgId: string, clientId: string | null, headers: readonly string[]): Promise<ProductColumnMap | null> {
  const recent = await db.importBatch.findMany({
    where: { orgId, kind: 'product_catalog', source: { in: ['upload'] } }, orderBy: { createdAt: 'desc' }, take: 10, select: { clientId: true, meta: true },
  });
  const ordered = [...recent.filter((b) => b.clientId === clientId), ...recent.filter((b) => b.clientId !== clientId)];
  for (const b of ordered) {
    const meta = readMeta(b.meta);
    const resolved = resolveNamed(namedMapping(meta.headers, meta.columnMap), headers);
    if (resolved) return resolved;
  }
  return null;
}

export async function previewProductImport(user: CurrentUser | null, locale: Locale, input: { file: UploadedFile | null; clientId: string | null }) {
  const e = i18nFor(locale).ta.importX.errors;
  if (!wrote(user)) return { ok: false as const, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false as const, error: i18nFor(locale).t.demoUploadDisabled };
  const client = await clientFor(user, input.clientId);
  if (!client.ok) return { ok: false as const, error: e.client };
  const read = await readFile(input.file, locale);
  if (!read.ok) return read;
  const { headers, rows } = read.parsed;
  if (rows.length === 0) return { ok: false as const, error: i18nFor(locale).ta.productsX.importWizard.errors.empty };
  const remembered = await rememberedMapping(user.orgId, client.id, headers);
  const presets = PRODUCT_PRESETS.map((p) => ({ id: p.id, verified: p.verified, mapping: applyProductPreset(p, headers) }));
  const preset = presets.find((p) => p.mapping)?.mapping ?? null;
  const mapping = remembered ?? preset ?? guessProductMapping(headers);
  return {
    ok: true as const, filename: input.file?.name ?? '', headers, sample: rows.slice(0, SAMPLE_ROWS).map((r) => headers.map((_, i) => r[i] ?? '')),
    rowCount: rows.length, mapping, mappingSource: remembered ? 'remembered' as const : preset ? 'preset' as const : 'guess' as const, presets,
  };
}

const MappingInput = z.object(Object.fromEntries(PRODUCT_FIELDS.map((f) => [f, z.number().int().min(f === 'name' ? 0 : -1)])) as Record<(typeof PRODUCT_FIELDS)[number], z.ZodNumber>);

/** Stores the file as a batch (or finds the same file's earlier batch) and starts checking it. */
export async function commitProductImport(user: CurrentUser | null, locale: Locale, input: { file: UploadedFile | null; clientId: string | null; mapping: string }) {
  const x = i18nFor(locale).ta;
  if (!wrote(user)) return { ok: false as const, error: x.importX.errors.client };
  if (await isDemoOrg(user.orgId)) return { ok: false as const, error: i18nFor(locale).t.demoUploadDisabled };
  const client = await clientFor(user, input.clientId);
  if (!client.ok) return { ok: false as const, error: x.importX.errors.client };
  let mapping: ProductColumnMap;
  try {
    mapping = { ...EMPTY_MAP, ...MappingInput.parse(JSON.parse(input.mapping)) };
  } catch {
    return { ok: false as const, error: x.productsX.importWizard.errors.noName };
  }
  const read = await readFile(input.file, locale);
  if (!read.ok) return read;
  const { headers, rows } = read.parsed;
  if (mappingProblem(mapping, headers.length)) return { ok: false as const, error: x.productsX.importWizard.errors.noName };
  const fingerprint = createHash('sha256').update(read.bytes).digest('hex');
  const existing = await db.importBatch.findUnique({ where: { orgId_kind_fingerprint: { orgId: user.orgId, kind: 'product_catalog', fingerprint } }, select: { id: true } });
  if (existing) return { ok: true as const, batchId: existing.id, duplicate: true };

  const records = rows.map((r) => recordOfRow(r, mapping));
  const kept = records.flatMap((r, i) => (r ? [{ r, row: rows[i] ?? [] }] : []));
  if (kept.length === 0) return { ok: false as const, error: x.productsX.importWizard.errors.empty };
  const meta: Meta = {
    source: /\.csv$/i.test(input.file?.name ?? '') ? 'csv' : 'xlsx', headers, columnMap: mapping, catalogId: null,
    progress: { done: 0, total: kept.length }, locale, dropped: rows.length - kept.length,
  };
  const batch = await db.importBatch.create({
    data: {
      orgId: user.orgId, clientId: client.id, kind: 'product_catalog', source: 'upload', filename: input.file?.name ?? null, fingerprint, status: 'parsed',
      createdBy: user.userId, meta: meta,
      counts: { total: kept.length, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 },
    },
    select: { id: true },
  });
  for (let i = 0; i < kept.length; i += 1_000) {
    await db.importRecord.createMany({
      data: kept.slice(i, i + 1_000).map(({ r, row }, j) => {
        const malformed = mxikOf(cell(row, mapping.mxik)).malformed;
        return {
          batchId: batch.id, rowIndex: i + j, status: 'valid' as const, fingerprint: productFingerprint(r),
          // A malformed code is remembered as written so classification can say so.
          payload: { ...r, ...(malformed ? { rawMxik: cell(row, mapping.mxik) } : {}) },
          issues: [],
        };
      }),
    });
  }
  void runProductBatch(batch.id);
  return { ok: true as const, batchId: batch.id, duplicate: false };
}

const running = new Set<string>();

type Line = { name: string; mxik: string | null; barcode: string | null; unit: string | null; packageCode: string | null; onecRef: string | null };
const lineOf = (p: StoredPayload & { rawMxik?: string | null }): Line => ({
  name: p.name, mxik: p.mxik ?? p.rawMxik ?? null, barcode: p.barcode, unit: p.unit, packageCode: p.packageCode, onecRef: p.onecRef,
});

/** The payload after classification and matching. */
function classifiedPayload(p: StoredPayload, c: DetailedClassification, match: MatchResult | null): StoredPayload {
  return {
    ...p, mxik: c.mxik ?? p.mxik, mxikName: c.mxikName, mxikStatus: c.mxikStatus, mxikSuggestion: c.mxikSuggestion, packageName: c.packageName ?? p.packageName,
    markingRequired: c.markingRequired, productId: match?.status === 'matched' ? match.chosen?.id ?? null : p.productId, match, alternatives: c.alternatives,
  };
}

/**
 * Classifies and matches the batch's records from the stored progress on, CHUNK at a time,
 * writing each chunk's records and the progress before the next. One run per batch per process.
 */
export async function runProductBatch(batchId: string): Promise<void> {
  if (running.has(batchId)) return;
  running.add(batchId);
  try {
    const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { orgId: true, clientId: true, meta: true, status: true } });
    if (!batch || batch.status !== 'parsed') return;
    const meta = readMeta(batch.meta);
    const locale = meta.locale ?? 'uz';
    const total = await db.importRecord.count({ where: { batchId } });
    let done = Math.min(meta.progress?.done ?? 0, total);
    const ctx = await auditContext(batch.orgId);
    while (done < total) {
      const records = await db.importRecord.findMany({ where: { batchId, rowIndex: { gte: done } }, orderBy: { rowIndex: 'asc' }, take: CHUNK, select: { id: true, rowIndex: true, payload: true } });
      if (records.length === 0) break;
      const payloads = records.map((r) => r.payload as unknown as StoredPayload & { rawMxik?: string | null });
      const lines = payloads.map(lineOf);
      const [classified, matches] = await Promise.all([
        classifyDetailed(batch.orgId, lines, { ctx, locale }),
        matchLines(batch.orgId, batch.clientId, lines, locale),
      ]);
      await db.$transaction(records.map((r, i) => {
        const c = classified[i] as DetailedClassification;
        const payload = classifiedPayload(payloads[i] as StoredPayload, c, matches[i] ?? null);
        return db.importRecord.update({
          where: { id: r.id },
          data: { payload: payload, issues: c.issues, status: statusOfIssues(c.issues) },
        });
      }));
      done = (records.at(-1)?.rowIndex ?? done) + 1;
      await db.importBatch.update({
        where: { id: batchId },
        data: { meta: { ...meta, progress: { done, total } } },
      });
      await refreshCounts(batchId);
    }
    await db.importBatch.update({ where: { id: batchId }, data: { status: 'review', error: null } });
    await refreshCounts(batchId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[products] batch ${batchId} failed: ${message}`);
    await db.importBatch.update({ where: { id: batchId }, data: { status: 'failed', error: message.slice(0, 500) } }).catch(() => undefined);
  } finally {
    running.delete(batchId);
  }
}

/** Waits until a batch is no longer being checked by this process (tests, the benchmark). */
export async function settleBatch(batchId: string, timeoutMs = 600_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (running.has(batchId) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

type Viewer = Pick<CurrentUser, 'orgId' | 'clientIds'>;

async function batchFor(user: Viewer, batchId: string) {
  const b = await db.importBatch.findFirst({ where: { id: batchId, orgId: user.orgId, kind: 'product_catalog' } });
  if (!b) return null;
  if (user.clientIds != null && (!b.clientId || !user.clientIds.includes(b.clientId))) return null;
  return b;
}

const recordOut = (r: { id: string; rowIndex: number; status: RecordStatus; payload: Prisma.JsonValue; issues: Prisma.JsonValue }) => {
  const p = r.payload as unknown as StoredPayload;
  const { match = null } = p;
  // The shared schema strips the extra keys (match, alternatives, rawMxik).
  return { id: r.id, rowIndex: r.rowIndex, status: r.status, payload: accounting.ProductRecord.parse(p), issues: (r.issues as unknown as ValidationIssue[]) ?? [], match };
};

/** A batch with a page of its records; resumes a batch whose run stopped (an API restart). */
export async function productBatchView(user: Viewer, batchId: string, params: { page?: number; status?: RecordStatus | undefined }) {
  const b = await batchFor(user, batchId);
  if (!b) return null;
  const meta = readMeta(b.meta);
  if (b.status === 'parsed' && !running.has(b.id) && Date.now() - b.updatedAt.getTime() > STALL_MS) void runProductBatch(b.id);
  const page = Math.max(0, Math.floor(params.page ?? 0));
  const where = { batchId: b.id, ...(params.status ? { status: params.status } : {}) };
  const checked = b.status !== 'parsed' && b.status !== 'failed';
  const [total, records, onec] = await Promise.all([
    db.importRecord.count({ where }),
    db.importRecord.findMany({ where, orderBy: { rowIndex: 'asc' }, skip: page * RECORD_PAGE, take: RECORD_PAGE, select: { id: true, rowIndex: true, status: true, payload: true, issues: true } }),
    checked ? oneCPreview(b.orgId, b.id) : Promise.resolve(null),
  ]);
  return {
    batch: {
      id: b.id, status: b.status, filename: b.filename, clientId: b.clientId, source: b.source, counts: accounting.BatchCounts.safeParse(b.counts).data ?? null,
      progress: meta.progress ?? { done: 0, total: 0 }, error: b.error, createdAt: b.createdAt.toISOString(), dropped: meta.dropped ?? 0,
    },
    records: records.map(recordOut), total, pageSize: RECORD_PAGE, onec,
  };
}

/**
 * What a nomenclature_xlsx of the batch would carry now (the 1C module's prepareExport): how many
 * records go in, how many it leaves out (skipped, unresolved, not approved, duplicates) and its
 * issues. Null when the 1C module cannot say.
 */
async function oneCPreview(orgId: string, batchId: string) {
  const prepared = await prepareExport({ orgId, batchId, format: 'nomenclature_xlsx' });
  if (!prepared.ok) return null;
  // Records an earlier export already carried are neither going nor left out.
  const pending = await db.importRecord.count({ where: { batchId, status: { not: 'exported' } } });
  return { records: prepared.records, leftOut: Math.max(0, pending - prepared.records), issues: prepared.issues.slice(0, 20) };
}

/** Accept the suggestion / set a code (re-checked at once), skip, or reopen one record. */
export async function decideProductRecord(
  user: CurrentUser, batchId: string, recordId: string, input: { action: 'accept_suggestion' | 'set_code' | 'skip' | 'reopen'; code?: string | undefined }, locale: Locale,
) {
  const generic = i18nFor(locale).t.errorGeneric;
  if (!canWrite(user)) return { ok: false as const, error: generic };
  const b = await batchFor(user, batchId);
  if (!b || (b.status !== 'review' && b.status !== 'approved')) return { ok: false as const, error: generic };
  const r = await db.importRecord.findFirst({ where: { id: recordId, batchId: b.id } });
  if (!r) return { ok: false as const, error: generic };
  const p = r.payload as unknown as StoredPayload;
  const now = new Date();
  const decided = { decidedBy: user.userId, decidedAt: now };
  if (input.action === 'skip') {
    await db.importRecord.update({ where: { id: r.id }, data: { status: 'skipped', decision: { action: 'skip' }, ...decided } });
  } else if (input.action === 'reopen') {
    await db.importRecord.update({ where: { id: r.id }, data: { status: statusOfIssues(r.issues as unknown as ValidationIssue[]), decision: Prisma.DbNull, decidedBy: null, decidedAt: null } });
  } else {
    const code = input.action === 'accept_suggestion' ? p.mxikSuggestion?.id ?? null : mxikOf(input.code ?? '').code;
    if (!code) return { ok: false as const, error: i18nFor(locale).ta.productsX.confirmErrors.format };
    const [c] = await classifyDetailed(b.orgId, [{ ...lineOf(p), mxik: code }], { locale });
    if (!c) return { ok: false as const, error: generic };
    const issues = c.issues;
    // A person chose the code: it is corrected unless the chosen code itself has an error.
    const status: RecordStatus = issues.some((i) => i.severity === 'error') ? 'unresolved' : 'corrected';
    await db.importRecord.update({
      where: { id: r.id },
      data: {
        payload: { ...classifiedPayload(p, c, p.match ?? null), mxikSuggestion: null },
        issues: issues, status, decision: { action: 'correct', corrections: { mxik: code } }, ...decided,
      },
    });
  }
  await refreshCounts(b.id);
  const after = await db.importRecord.findUniqueOrThrow({ where: { id: r.id }, select: { id: true, rowIndex: true, status: true, payload: true, issues: true } });
  return { ok: true as const, record: recordOut(after) };
}

/** Saves every record but the skipped ones into the catalogue; codes a person chose count as confirmed. */
export async function applyProductBatch(user: CurrentUser, batchId: string, locale: Locale) {
  const generic = i18nFor(locale).t.errorGeneric;
  if (!canWrite(user)) return { ok: false as const, error: generic };
  const b = await batchFor(user, batchId);
  if (!b || (b.status !== 'review' && b.status !== 'approved')) return { ok: false as const, error: generic };
  const rows = await db.importRecord.findMany({ where: { batchId: b.id, status: { not: 'skipped' } }, orderBy: { rowIndex: 'asc' } });
  const payloads = rows.map((r) => r.payload as unknown as StoredPayload);
  const records: ProductRecord[] = payloads.map(({ match: _m, alternatives: _a, ...rest }) => accounting.ProductRecord.parse(rest));
  const confirmed = new Set(rows.flatMap((r, i) => ((r.decision as { action?: string } | null)?.action === 'correct' ? [i] : [])));
  const result = await upsertRecords(b.orgId, b.clientId, records, user.userId, { source: 'catalog_import', confirmed });
  // What the check found travels to the product: its issues and runner-up codes, for the drawer.
  await db.$transaction(rows.flatMap((r, i) => {
    const id = result.ids[i];
    if (!id) return [];
    return [
      db.product.update({ where: { id }, data: { mxikIssues: r.issues as Prisma.InputJsonValue, mxikAlternatives: payloads[i]?.alternatives ?? [] } }),
      db.importRecord.update({ where: { id: r.id }, data: { payload: { ...(payloads[i] as StoredPayload), productId: id } } }),
    ];
  }));
  await db.importBatch.update({ where: { id: b.id }, data: { status: 'approved' } });
  await refreshCounts(b.id);
  await db.auditEvent.create({ data: { orgId: b.orgId, actorId: user.userId, action: 'product.import_applied', targetId: b.id, payload: { created: result.created, updated: result.updated } } });
  return { ok: true as const, created: result.created, updated: result.updated };
}

/** "Prepare for 1C" on an import: the 1C module's nomenclature_xlsx, or "after integration" while it is a stub. */
export async function exportProductBatch(user: CurrentUser, batchId: string, locale: Locale): Promise<Handover> {
  const b = await batchFor(user, batchId);
  if (!b || !canWrite(user)) return { ok: false, unavailable: false, error: i18nFor(locale).t.errorGeneric };
  return handOverBatch(user, b.id, locale);
}

export type { MatchCandidate };
