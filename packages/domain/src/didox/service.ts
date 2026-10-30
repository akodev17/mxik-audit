// The Didox invoice workflow on the database: import a document (one import_batch of kind
// didox_invoice per invoice, one import_record per line), refuse duplicates, list and show
// invoices, record the reviewer's decisions, and prepare / export through Agent 1's 1C interface.
// The API's didox module and the benchmark call these; the controller stays thin.
//
// Never writes a 1C file (packages/domain/src/onec does) and never writes a product
// (packages/domain/src/products does, and only for lines decided "create new", at export).
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import { canSeeClient, canWrite } from '../access.js';
import { uploadTarget, type UploadedFile } from '../catalog-upload.js';
import type { FileOut } from '../catalog-exports.js';
import { isDemoOrg } from '../demo.js';
import { uploadsOpen } from '../plan.js';
import { looksLikeZip } from '../security/zip-guard.js';
import { buildExport, documentErrors, invoiceLineFingerprint, prepareExport, refreshCounts } from '../onec/index.js';
import { classifyProducts, upsertProducts } from '../products/index.js';
import type { CurrentUser } from '../session.js';
import { checkInvoice, defaultDeps, statusFor, type CheckDeps, type CheckedInvoice, type ProductRecord, type RecordStatus } from './check.js';
import { parseDidoxDocument, SHAPE_NOTE, type DidoxKind, type IncomingInvoiceMeta, type InvoiceLine, type ParsedInvoice, type ParseError, type StatedTotals, type ValidationIssue } from './document.js';
import { foldName } from './fold.js';
import { readDidoxUpload, guessSheetMap, sheetSignature, sheetToDocument, SheetHeaderSchema, SheetMapSchema, SHEET_FIELDS, templateToDocuments, type SheetMap } from './sources.js';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const KIND = 'didox_invoice' as const;

type Fail = { ok: false; error: string };
type Writer = CurrentUser | null;
const allowed = (user: Writer): user is CurrentUser => user !== null && canWrite(user);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
/** Prisma's Bytes wants a Uint8Array over a plain ArrayBuffer; a Buffer may sit on a shared pool. */
export const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

/** Where a user's Didox batches are: the org's, and only assigned clients' for a scoped accountant. */
export function batchScope(user: Pick<CurrentUser, 'orgId' | 'clientIds'>): Prisma.ImportBatchWhereInput {
  return { orgId: user.orgId, kind: KIND, ...(user.clientIds == null ? {} : { clientId: { in: user.clientIds } }) };
}

/** What the batch keeps in meta besides the contract's IncomingInvoiceMeta (extra keys; the contract parse drops them). */
export type DidoxMetaExtra = {
  /**
   * The optional IncomingInvoiceMeta fields the 1C session (S4) adds to the shared contract for the
   * OData receipt of a corrected invoice; written here so the stored meta carries them once both land.
   */
  facturaType?: number | null;
  oldFactura?: { id: string | null; number: string; date: string } | null;
  didox: {
    issues: ValidationIssue[];
    facturaId: string | null;
    facturaType: string | null;
    verified: false;
    note: string;
    /** Entry name inside an uploaded archive. */
    entry?: string;
    /** 002 / 008 / 023 and where the document sat (§7.2). */
    docType?: ParsedInvoice['docType'];
    envelope?: ParsedInvoice['envelope'];
    singleSidedType?: number | null;
    oldFactura?: ParsedInvoice['oldFactura'];
    /** Where the header totals came from (B6): the document, the Didox list entry, or the lines. */
    totalsFrom?: ParsedInvoice['totalsFrom'];
    statedTotals?: StatedTotals | null;
    signers?: ParsedInvoice['signers'];
    statusComment?: string | null;
  };
};
export type StoredMeta = IncomingInvoiceMeta & DidoxMetaExtra;

// ── Import ──────────────────────────────────────────────────────────────────────────────────

export type ImportInput = {
  json: unknown;
  source: 'didox_api' | 'didox_zip' | 'didox_json' | 'xlsx';
  clientId: string | null;
  filename?: string | null;
  entry?: string | null;
  didoxId?: string | null;
  didoxStatus?: string | null;
  docType?: string | null;
  pdf?: Buffer | null;
  measures?: ReadonlyMap<string, string>;
  /** The Didox list entry's totals (sync), the document's own header totals for B6. */
  listTotals?: StatedTotals | null;
};

export type DuplicateOf = { batchId: string; number: string; date: string };
export type ImportResult =
  | { ok: true; batchId: string; lines: number; status: RecordCounts }
  | { ok: false; code: ParseError | 'duplicate_invoice'; kind?: DidoxKind; detail?: string; duplicateOf?: DuplicateOf };

export type RecordCounts = { total: number; valid: number; corrected: number; suspicious: number; unresolved: number; skipped: number; exported: number };

export function countStatuses(statuses: readonly RecordStatus[]): RecordCounts {
  const c: RecordCounts = { total: statuses.length, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 };
  for (const s of statuses) c[s]++;
  return c;
}

/**
 * An earlier batch of the same invoice: same Didox id, same roaming id (`facturaid`, the list's
 * `roaming_id`: one invoice seen once by the API and once in a zip has both, §7.11), same normalised
 * document, or same seller + number + date. The last rule is skipped for a correction (`facturatype`
 * ≠ 0 with an old invoice): a corrected ЭСФ keeps the original's number and date (§5 V13).
 */
async function findDuplicate(orgId: string, invoice: Pick<ParsedInvoice, 'meta' | 'fingerprint' | 'facturaId' | 'facturaType' | 'oldFactura'>): Promise<DuplicateOf | null> {
  const { meta, fingerprint } = invoice;
  const or: Prisma.ImportBatchWhereInput[] = [{ fingerprint }];
  if (meta.externalId) or.push({ externalRef: meta.externalId });
  if (invoice.facturaId) or.push({ externalRef: invoice.facturaId }, { meta: { path: ['didox', 'facturaId'], equals: invoice.facturaId } });
  const correction = Boolean(invoice.oldFactura) && (invoice.facturaType ?? '0') !== '0';
  if (meta.seller.inn && !correction) {
    or.push({ AND: [
      { meta: { path: ['number'], equals: meta.number } },
      { meta: { path: ['date'], equals: meta.date } },
      { meta: { path: ['seller', 'inn'], equals: meta.seller.inn } },
    ] });
  }
  const found = await db.importBatch.findFirst({ where: { orgId, kind: KIND, OR: or }, select: { id: true, meta: true }, orderBy: { createdAt: 'asc' } });
  if (!found) return null;
  const m = found.meta as Partial<IncomingInvoiceMeta> | null;
  return { batchId: found.id, number: m?.number ?? '', date: m?.date ?? '' };
}

/**
 * Parses, checks and stores one document. A non-invoice is refused with its kind; a document seen
 * before (by Didox id, content, or seller + number + date) is refused with the earlier batch.
 */
export async function importDocument(orgId: string, actorId: string | null, input: ImportInput, deps: CheckDeps = defaultDeps): Promise<ImportResult> {
  const parsed = parseDidoxDocument(input.json, {
    source: input.source, didoxId: input.didoxId, didoxStatus: input.didoxStatus, docType: input.docType, measures: input.measures, listTotals: input.listTotals,
  });
  if (!parsed.ok) return { ok: false, code: parsed.error, kind: parsed.kind, detail: parsed.detail };
  const { invoice } = parsed;

  const earlier = await findDuplicate(orgId, invoice);
  if (earlier) return { ok: false, code: 'duplicate_invoice', duplicateOf: earlier };

  const checked = await checkInvoice(orgId, input.clientId, invoice, deps);
  return storeInvoice(orgId, actorId, input, invoice, checked);
}

/** The write stage of importDocument (exported for the benchmark): the batch, its records and the document cache. */
export async function storeInvoice(orgId: string, actorId: string | null, input: ImportInput, invoice: ParsedInvoice, checked: CheckedInvoice): Promise<ImportResult> {
  const type = invoice.facturaType !== null && /^\d{1,2}$/.test(invoice.facturaType) ? Number(invoice.facturaType) : null;
  const old = invoice.oldFactura;
  const meta: StoredMeta = {
    ...checked.meta,
    facturaType: type,
    oldFactura: old?.number && old.date ? { id: old.id, number: old.number.slice(0, 60), date: old.date } : null,
    didox: {
      issues: checked.batchIssues, facturaId: invoice.facturaId, facturaType: invoice.facturaType, verified: false, note: SHAPE_NOTE,
      ...(input.entry ? { entry: input.entry } : {}),
      docType: invoice.docType, envelope: invoice.envelope, singleSidedType: invoice.singleSidedType, oldFactura: invoice.oldFactura,
      totalsFrom: invoice.totalsFrom, statedTotals: invoice.statedTotals, signers: invoice.signers, statusComment: invoice.statusComment,
    },
  };
  const counts = countStatuses(checked.lines.map((l) => l.status));
  const ref = invoice.meta.externalId;
  let batchId: string;
  try {
    batchId = await db.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          orgId, clientId: input.clientId, kind: KIND, source: input.source, filename: input.filename ?? null,
          externalRef: ref, fingerprint: invoice.fingerprint, status: 'review', counts: json(counts), meta: json(meta), createdBy: actorId,
        },
        select: { id: true },
      });
      await tx.importRecord.createMany({
        data: checked.lines.map((l, i) => ({
          batchId: batch.id, rowIndex: i, status: l.status, payload: json(l.payload), issues: json(l.issues),
          fingerprint: invoiceLineFingerprint(checked.meta, l.payload),
        })),
      });
      return batch.id;
    }, { timeout: 30_000 });
  } catch (error) {
    // Two imports of the same document at once: the unique (org, kind, fingerprint) decides.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const dup = await findDuplicate(orgId, invoice);
      return { ok: false, code: 'duplicate_invoice', ...(dup ? { duplicateOf: dup } : {}) };
    }
    throw error;
  }

  // The raw document (and its print form) for the review page; keyed by the Didox id or the content.
  const didoxId = input.didoxId ?? ref ?? `fp:${invoice.fingerprint}`;
  await db.didoxDocument.upsert({
    where: { orgId_didoxId: { orgId, didoxId } },
    create: { orgId, didoxId, source: input.source, docType: input.docType ?? null, status: input.didoxStatus ?? null, json: json(input.json), pdf: input.pdf ? bytes(input.pdf) : null, batchId },
    update: { source: input.source, status: input.didoxStatus ?? null, json: json(input.json), ...(input.pdf ? { pdf: bytes(input.pdf) } : {}), batchId },
  });
  return { ok: true, batchId, lines: checked.lines.length, status: counts };
}

/** A refusal in the user's language. */
export function importMessage(locale: Locale, result: Extract<ImportResult, { ok: false }>): string {
  const { ta } = i18nFor(locale);
  const e = ta.didoxX.errors;
  switch (result.code) {
    case 'not_invoice': return e.not_invoice(ta.didoxX.kinds[result.kind ?? 'unknown']);
    case 'missing_header': return e.missing_header(result.detail ?? '');
    case 'duplicate_invoice': return e.duplicate_invoice;
    default: return e[result.code];
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────────────────────

/** The checks every upload makes: writer, demo, plan, file, client. */
async function uploadGate(user: Writer, locale: Locale, file: UploadedFile | null, clientId: unknown): Promise<{ ok: true; user: CurrentUser; clientId: string | null; buffer: Buffer; name: string } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!allowed(user)) return { ok: false, error: e.forbidden };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  if (!(await uploadsOpen(user.orgId)).ok) return { ok: false, error: i18nFor(locale).ta.msg.gate.expired };
  if (!file || file.size === 0) return { ok: false, error: e.empty };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.too_big };
  const target = await clientTarget(user, clientId);
  if (!target.ok) return { ok: false, error: e[target.reason] };
  return { ok: true, user, clientId: target.id, buffer: await file.read(), name: file.name };
}

/** The client invoices go to: one the user may work on, or the org's own books (not for a scoped accountant). */
async function clientTarget(user: CurrentUser, clientId: unknown): Promise<{ ok: true; id: string | null } | { ok: false; reason: 'client' | 'archived' }> {
  if (typeof clientId !== 'string' || !clientId) return user.clientIds == null ? { ok: true, id: null } : { ok: false, reason: 'client' };
  const target = await uploadTarget(user, clientId);
  return target.ok ? { ok: true, id: target.id } : target;
}

export type UploadItem = { entry: string; ok: true; batchId: string; lines: number } | { entry: string; ok: false; error: string; code: string; duplicateOf?: DuplicateOf };
export type SheetPreview = {
  headers: string[]; rows: string[][]; totalRows: number; map: SheetMap; fields: readonly string[];
  /** 'didox_esf_template': the official template, read as a fixed preset (header fields from the file); null = a mapped sheet. */
  preset: 'didox_esf_template' | null;
  /** Invoices the template holds (1 for a mapped sheet). */
  invoices: number;
  /** The map is the one this org confirmed before for the same headers. */
  remembered: boolean;
};

/** The column mapping the org confirmed before for these headers (DidoxSheetFormat), when it still fits the sheet. */
async function rememberedMap(orgId: string, headers: readonly string[]): Promise<SheetMap | null> {
  const row = await db.didoxSheetFormat.findUnique({ where: { orgId_headerSignature: { orgId, headerSignature: sheetSignature(headers) } }, select: { columnMap: true } });
  const map = SheetMapSchema.safeParse(row?.columnMap);
  return map.success && Object.values(map.data).every((i) => i < headers.length) ? map.data : null;
}

/** Remembers a confirmed mapping by the header signature (the bank module's saveFormat). */
async function rememberMap(orgId: string, actorId: string, headers: readonly string[], map: SheetMap): Promise<void> {
  const headerSignature = sheetSignature(headers);
  if (!headerSignature.replace(/\|/g, '')) return;
  await db.didoxSheetFormat.upsert({
    where: { orgId_headerSignature: { orgId, headerSignature } },
    create: { orgId, headerSignature, columnMap: json(map), usedCount: 1, createdBy: actorId },
    update: { columnMap: json(map), usedCount: { increment: 1 } },
  });
}
export type UploadResult =
  | { ok: true; kind: 'documents'; items: UploadItem[]; skipped: Array<{ entry: string; reason: string }> }
  | { ok: true; kind: 'sheet'; filename: string; preview: SheetPreview }
  | Fail;

/** A Didox zip export or a document JSON becomes one batch per invoice; an ЭСФ spreadsheet answers its preview for mapping. */
export async function uploadDidoxFile(user: Writer, locale: Locale, input: { file: UploadedFile | null; clientId: unknown }, deps: CheckDeps = defaultDeps): Promise<UploadResult> {
  const e = i18nFor(locale).ta.didoxX.errors;
  const gate = await uploadGate(user, locale, input.file, input.clientId);
  if (!gate.ok) return gate;
  const read = await readDidoxUpload(gate.buffer, gate.name);
  if (read.kind === 'error') return { ok: false, error: e[read.error] };
  if (read.kind === 'xlsx') {
    const { headers, rows } = read.sheet;
    const templates = templateToDocuments(read.sheet);
    const remembered = templates.length > 0 ? null : await rememberedMap(gate.user.orgId, headers);
    return {
      ok: true, kind: 'sheet', filename: gate.name,
      preview: {
        headers, rows: rows.slice(0, 10), totalRows: rows.length, map: remembered ?? guessSheetMap(headers), fields: SHEET_FIELDS,
        preset: templates.length > 0 ? 'didox_esf_template' : null, invoices: Math.max(1, templates.length), remembered: remembered !== null,
      },
    };
  }
  const source = looksLikeZip(gate.buffer) ? 'didox_zip' : 'didox_json';
  const items: UploadItem[] = [];
  for (const doc of read.documents) {
    try {
      const result = await importDocument(gate.user.orgId, gate.user.userId, {
        json: doc.json, source, clientId: gate.clientId, filename: gate.name, entry: doc.entry, pdf: doc.pdf,
      }, deps);
      items.push(result.ok
        ? { entry: doc.entry, ok: true, batchId: result.batchId, lines: result.lines }
        : { entry: doc.entry, ok: false, code: result.code, error: importMessage(locale, result), ...(await shownDuplicate(gate.user, result.duplicateOf)) });
    } catch {
      items.push({ entry: doc.entry, ok: false, code: 'store_failed', error: e.generic });
    }
  }
  return { ok: true, kind: 'documents', items, skipped: read.skipped };
}

/**
 * The ЭСФ spreadsheet → invoice batches. The official template needs nothing more: every invoice in
 * it becomes a batch, header fields read from its cells. Any other sheet takes the confirmed columns
 * and the typed header, makes one batch, and its mapping is remembered for the org.
 */
export async function commitDidoxSheet(user: Writer, locale: Locale, input: { file: UploadedFile | null; clientId: unknown; map: unknown; header: unknown }, deps: CheckDeps = defaultDeps): Promise<{ ok: true; batchId: string; batchIds?: string[]; items?: UploadItem[] } | (Fail & { duplicateOf?: DuplicateOf })> {
  const e = i18nFor(locale).ta.didoxX.errors;
  const gate = await uploadGate(user, locale, input.file, input.clientId);
  if (!gate.ok) return gate;
  const sheetRead = await readDidoxUpload(gate.buffer, gate.name);
  const templates = sheetRead.kind === 'xlsx' ? templateToDocuments(sheetRead.sheet) : [];
  if (templates.length > 0) {
    const items: UploadItem[] = [];
    for (const [i, t] of templates.entries()) {
      const entry = `${gate.name}#${i + 1}`;
      const result = await importDocument(gate.user.orgId, gate.user.userId, { json: t.document, source: 'xlsx', clientId: gate.clientId, filename: gate.name, entry }, deps);
      items.push(result.ok
        ? { entry, ok: true, batchId: result.batchId, lines: result.lines }
        : { entry, ok: false, code: result.code, error: importMessage(locale, result), ...(await shownDuplicate(gate.user, result.duplicateOf)) });
    }
    const batchIds = items.flatMap((x) => (x.ok ? [x.batchId] : []));
    const first = batchIds[0];
    if (!first) {
      const refused = items[0];
      return { ok: false, error: refused && !refused.ok ? refused.error : e.bad_mapping, ...(refused && !refused.ok && refused.duplicateOf ? { duplicateOf: refused.duplicateOf } : {}) };
    }
    return { ok: true, batchId: first, batchIds, items };
  }
  const map = SheetMapSchema.safeParse(typeof input.map === 'string' ? safeJson(input.map) : input.map);
  const header = SheetHeaderSchema.safeParse(typeof input.header === 'string' ? safeJson(input.header) : input.header);
  if (!map.success || !header.success || map.data.name < 0 || (map.data.quantity < 0 && map.data.amount < 0)) return { ok: false, error: e.bad_mapping };
  const read = sheetRead;
  if (read.kind !== 'xlsx') return { ok: false, error: read.kind === 'error' ? e[read.error] : e.unsupported };
  const doc = sheetToDocument(read.sheet, map.data, header.data);
  const result = await importDocument(gate.user.orgId, gate.user.userId, { json: doc, source: 'xlsx', clientId: gate.clientId, filename: gate.name }, deps);
  if (result.ok) {
    await rememberMap(gate.user.orgId, gate.user.userId, read.sheet.headers, map.data);
    return { ok: true, batchId: result.batchId };
  }
  return { ok: false, error: importMessage(locale, result), ...(await shownDuplicate(gate.user, result.duplicateOf)) };
}

/** The earlier invoice a refusal names, only when the user may open it (batchScope); otherwise the message alone (F20). */
async function shownDuplicate(user: CurrentUser, dup: DuplicateOf | undefined): Promise<{ duplicateOf?: DuplicateOf }> {
  if (!dup) return {};
  return (await db.importBatch.count({ where: { ...batchScope(user), id: dup.batchId } })) > 0 ? { duplicateOf: dup } : {};
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

// ── Read ───────────────────────────────────────────────────────────────────────────────────

export type InvoiceRow = {
  id: string; clientId: string | null; clientName: string | null; source: string; filename: string | null; externalRef: string | null;
  status: string; number: string; date: string; sellerName: string; sellerInn: string | null; totalWithVat: string;
  counts: RecordCounts | null; issues: number; createdAt: string; hasPdf: boolean;
};

export async function listInvoices(user: CurrentUser, query: { clientId?: string; status?: string; page?: number }): Promise<{ rows: InvoiceRow[]; total: number; pageSize: number }> {
  const pageSize = 50;
  // AND, not a spread: the requested client must narrow the user's scope, never replace it.
  const where: Prisma.ImportBatchWhereInput = {
    AND: [batchScope(user), query.clientId ? { clientId: query.clientId } : {}],
    ...(query.status ? { status: query.status as Prisma.EnumImportStatusFilter['equals'] } : {}),
  };
  const [batches, total] = await Promise.all([
    db.importBatch.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (query.page ?? 0) * pageSize, take: pageSize,
      select: { id: true, clientId: true, client: { select: { name: true } }, source: true, filename: true, externalRef: true, status: true, meta: true, counts: true, createdAt: true },
    }),
    db.importBatch.count({ where }),
  ]);
  const withPdf = new Set((await db.didoxDocument.findMany({
    where: { orgId: user.orgId, batchId: { in: batches.map((b) => b.id) }, pdf: { not: null } }, select: { batchId: true },
  })).map((d) => d.batchId));
  const rows = batches.map((b): InvoiceRow => {
    const m = (b.meta ?? {}) as Partial<StoredMeta>;
    const counts = b.counts as RecordCounts | null;
    return {
      id: b.id, clientId: b.clientId, clientName: b.client?.name ?? null, source: b.source, filename: b.filename, externalRef: b.externalRef,
      status: b.status, number: m.number ?? '', date: m.date ?? '', sellerName: m.seller?.name ?? '', sellerInn: m.seller?.inn ?? null,
      totalWithVat: m.totalWithVat ?? '0', counts, issues: counts ? counts.suspicious + counts.unresolved : 0,
      createdAt: b.createdAt.toISOString(), hasPdf: withPdf.has(b.id),
    };
  });
  return { rows, total, pageSize };
}

export type RecordView = {
  id: string; rowIndex: number; status: RecordStatus; payload: InvoiceLine; issues: ValidationIssue[];
  decision: unknown; decidedAt: string | null; outcome: unknown;
  /** Line numbers sharing this line's folded name (empty when the name is unique). */
  sameAs: number[];
};

export type InvoiceDetail = {
  invoice: InvoiceRow; meta: IncomingInvoiceMeta; batchIssues: ValidationIssue[]; verified: false; note: string;
  records: RecordView[];
  exports: Array<{ id: string; format: string; filename: string | null; recordCount: number; createdAt: string; outcome: unknown }>;
};

export async function invoiceDetail(user: CurrentUser, batchId: string): Promise<InvoiceDetail | null> {
  const batch = await db.importBatch.findFirst({
    where: { ...batchScope(user), id: batchId },
    include: {
      client: { select: { name: true } },
      records: { orderBy: { rowIndex: 'asc' } },
      exports: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!batch) return null;
  const hasPdf = (await db.didoxDocument.count({ where: { orgId: user.orgId, batchId, pdf: { not: null } } })) > 0;
  const m = (batch.meta ?? {}) as StoredMeta;
  const counts = batch.counts as RecordCounts | null;
  const payloads = batch.records.map((r) => r.payload as InvoiceLine);
  const keys = payloads.map((p) => foldName(p.name));
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), payloads[i]?.lineNo ?? i + 1]));
  return {
    invoice: {
      id: batch.id, clientId: batch.clientId, clientName: batch.client?.name ?? null, source: batch.source, filename: batch.filename,
      externalRef: batch.externalRef, status: batch.status, number: m.number ?? '', date: m.date ?? '', sellerName: m.seller?.name ?? '',
      sellerInn: m.seller?.inn ?? null, totalWithVat: m.totalWithVat ?? '0', counts, issues: counts ? counts.suspicious + counts.unresolved : 0,
      createdAt: batch.createdAt.toISOString(), hasPdf,
    },
    meta: m,
    batchIssues: m.didox?.issues ?? [],
    verified: false,
    note: SHAPE_NOTE,
    records: batch.records.map((r, i) => {
      const same = byKey.get(keys[i] ?? '') ?? [];
      return {
        id: r.id, rowIndex: r.rowIndex, status: r.status, payload: r.payload as InvoiceLine, issues: r.issues as ValidationIssue[],
        decision: r.decision ?? null, decidedAt: r.decidedAt?.toISOString() ?? null, outcome: r.outcome ?? null,
        sameAs: same.length > 1 ? same : [],
      };
    }),
    exports: batch.exports.map((x) => ({ id: x.id, format: x.format, filename: x.filename, recordCount: x.recordCount, createdAt: x.createdAt.toISOString(), outcome: x.outcome ?? null })),
  };
}

/** The print form, when the document came with one (API sync or a zip export). */
export async function invoicePdf(user: CurrentUser, batchId: string): Promise<FileOut | null> {
  const batch = await db.importBatch.findFirst({ where: { ...batchScope(user), id: batchId }, select: { id: true, meta: true } });
  if (!batch) return null;
  const doc = await db.didoxDocument.findFirst({ where: { orgId: user.orgId, batchId, pdf: { not: null } }, select: { pdf: true } });
  if (!doc?.pdf) return null;
  const number = ((batch.meta ?? {}) as Partial<StoredMeta>).number ?? batch.id;
  const name = `didox-${number.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.pdf`;
  return {
    body: new Uint8Array(doc.pdf),
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
    },
  };
}

export async function removeInvoice(user: Writer, batchId: string): Promise<boolean> {
  if (!allowed(user)) return false;
  const batch = await db.importBatch.findFirst({ where: { ...batchScope(user), id: batchId }, select: { id: true } });
  if (!batch) return false;
  await db.$transaction([
    db.didoxDocument.updateMany({ where: { orgId: user.orgId, batchId }, data: { batchId: null } }),
    db.importBatch.delete({ where: { id: batchId } }),
  ]);
  return true;
}

// ── Review decisions ───────────────────────────────────────────────────────────────────────

/**
 * A reviewer's decision on one line (the contract's ReviewDecision). `correct` takes:
 *   corrections.product = a candidate id (use that existing product) | 'new' (create a product from the line)
 *   corrections.mxik    = a 17-digit code (the reviewer's MXIK; checked by the classifier first)
 * `approve` accepts the line as matched (or as a new product when nothing matched); an ambiguous
 * match or a standing error must be corrected first. Existing products are never changed here.
 */
export type Decision = { action: 'approve' | 'correct' | 'skip' | 'reopen'; corrections?: { product?: string; mxik?: string }; note?: string };

const PRODUCT_ISSUES = new Set(['product_new', 'product_ambiguous', 'product_unchecked']);
const MXIK_ISSUES = new Set([
  'mxik_missing', 'mxik_invalid', 'mxik_inactive', 'mxik_restricted', 'mxik_conflict',
  // The rules' findings about the code the reviewer replaces (rules.ts).
  'mxik_not_found', 'mxik_retired_later', 'mxik_restricted_later', 'package_not_of_code', 'unit_not_of_code',
]);

/** The product record a line would create (never applied to an existing product). */
export function recordFromLine(line: InvoiceLine): ProductRecord {
  return {
    productId: null, name: line.name, onecRef: null, mxik: line.mxik, mxikName: line.mxikName,
    packageCode: line.packageCode, packageName: line.packageName, unit: line.unit ?? line.packageName, barcode: line.barcode,
    aliases: [], mxikStatus: line.mxik ? 'unchecked' : 'missing', mxikSuggestion: null, markingRequired: null,
  };
}

type DecideOutcome = { ok: true; status: RecordStatus } | { ok: false; code: 'not_found' | 'bad_decision' | 'needs_choice' | 'mxik_refused' };

async function applyDecision(user: CurrentUser, recordId: string, decision: Decision, deps: Pick<CheckDeps, 'classifyProducts' | 'productRecords'>): Promise<DecideOutcome> {
  const record = await db.importRecord.findFirst({ where: { id: recordId, batch: batchScope(user) }, select: { id: true, batchId: true, payload: true, issues: true, status: true } });
  if (!record) return { ok: false, code: 'not_found' };
  if (record.status === 'exported') return { ok: false, code: 'bad_decision' };
  let payload = record.payload as InvoiceLine;
  let issues = record.issues as ValidationIssue[];
  let status: RecordStatus;

  switch (decision.action) {
    case 'skip': status = 'skipped'; break;
    case 'reopen': status = statusFor(issues); break;
    case 'approve': {
      if (payload.product.status === 'ambiguous' || issues.some((i) => i.severity === 'error')) return { ok: false, code: 'needs_choice' };
      payload = { ...payload, resolved: payload.resolved ?? recordFromLine(payload) };
      status = 'valid';
      break;
    }
    case 'correct': {
      const c = decision.corrections ?? {};
      if (!c.product && !c.mxik) return { ok: false, code: 'bad_decision' };
      if (c.mxik) {
        if (!/^\d{17}$/.test(c.mxik)) return { ok: false, code: 'bad_decision' };
        const [verdict] = await deps.classifyProducts(user.orgId, [{ name: payload.name, mxik: c.mxik }]);
        if (verdict && ['invalid', 'inactive', 'restricted'].includes(verdict.mxikStatus)) return { ok: false, code: 'mxik_refused' };
        payload = { ...payload, mxik: c.mxik, mxikName: verdict?.mxikName ?? payload.mxikName, resolved: payload.resolved ? { ...payload.resolved } : payload.resolved };
        issues = issues.filter((i) => !MXIK_ISSUES.has(i.code));
      }
      if (c.product === 'new') {
        payload = { ...payload, product: { status: 'new', chosen: null, candidates: payload.product.candidates }, resolved: recordFromLine(payload) };
        issues = issues.filter((i) => !PRODUCT_ISSUES.has(i.code));
      } else if (c.product) {
        const candidate = payload.product.candidates.find((x) => x.id === c.product) ?? (payload.product.chosen?.id === c.product ? payload.product.chosen : null);
        if (!candidate) return { ok: false, code: 'bad_decision' };
        const [existing] = await deps.productRecords(user.orgId, [candidate.id]);
        payload = {
          ...payload,
          product: { status: 'matched', chosen: candidate, candidates: payload.product.candidates },
          resolved: existing ?? { ...recordFromLine(payload), productId: candidate.id, name: candidate.label },
        };
        issues = issues.filter((i) => !PRODUCT_ISSUES.has(i.code));
      } else if (payload.resolved) {
        // A new MXIK on a line headed for a new product goes into the product to create.
        if (payload.resolved.productId === null) payload = { ...payload, resolved: { ...payload.resolved, mxik: payload.mxik, mxikName: payload.mxikName } };
      }
      if (issues.some((i) => i.severity === 'error')) {
        status = 'unresolved';
      } else {
        payload = { ...payload, resolved: payload.resolved ?? recordFromLine(payload) };
        status = 'corrected';
      }
      break;
    }
    default: return { ok: false, code: 'bad_decision' };
  }

  const stored = decision.action === 'reopen' ? Prisma.DbNull : json({ action: decision.action, ...(decision.corrections ? { corrections: decision.corrections } : {}), ...(decision.note ? { note: decision.note.slice(0, 500) } : {}) });
  await db.importRecord.update({
    where: { id: record.id },
    data: {
      status, payload: json(payload), issues: json(issues), decision: stored,
      decidedBy: decision.action === 'reopen' ? null : user.userId, decidedAt: decision.action === 'reopen' ? null : new Date(),
    },
  });
  return { ok: true, status };
}

/** Recounts a batch and moves it between review and approved: approved once every line is decided and none is unresolved. */
export async function refreshBatch(batchId: string): Promise<RecordCounts> {
  // The counts are Agent 1's (refreshCounts, one place for every kind); the status rule is the review's.
  const counts = await refreshCounts(batchId);
  const records = await db.importRecord.findMany({ where: { batchId }, select: { status: true, decision: true } });
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  const decided = records.every((r) => r.decision !== null || r.status === 'exported');
  const next = batch?.status === 'exported' ? 'exported' : decided && counts.unresolved === 0 ? 'approved' : 'review';
  if (next !== batch?.status) await db.importBatch.update({ where: { id: batchId }, data: { status: next } });
  return counts;
}

export async function decideLine(user: Writer, locale: Locale, recordId: string, body: unknown, deps: Pick<CheckDeps, 'classifyProducts' | 'productRecords'> = defaultDeps): Promise<{ ok: true; status: RecordStatus; counts: RecordCounts } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!allowed(user)) return { ok: false, error: e.forbidden };
  const decision = DecisionSchema.safeParse(body);
  if (!decision.success) return { ok: false, error: e.bad_decision };
  const result = await applyDecision(user, recordId, decision.data, deps);
  if (!result.ok) return { ok: false, error: e[result.code] };
  const record = await db.importRecord.findUnique({ where: { id: recordId }, select: { batchId: true } });
  const counts = await refreshBatch(record?.batchId ?? '');
  return { ok: true, status: result.status, counts };
}

/** Bulk approve: lines whose product matched ('matched'), or every line with no error or warning ('clean'). */
export async function approveMany(user: Writer, locale: Locale, batchId: string, scope: 'matched' | 'clean'): Promise<{ ok: true; approved: number; counts: RecordCounts } | Fail> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!allowed(user)) return { ok: false, error: e.forbidden };
  const batch = await db.importBatch.findFirst({ where: { ...batchScope(user), id: batchId }, select: { id: true } });
  if (!batch) return { ok: false, error: e.not_found };
  const records = await db.importRecord.findMany({ where: { batchId, decision: { equals: Prisma.DbNull } }, select: { id: true, payload: true, issues: true, status: true } });
  const targets = records.filter((r) => {
    const p = r.payload as InvoiceLine;
    const issues = r.issues as ValidationIssue[];
    if (r.status === 'exported' || issues.some((i) => i.severity === 'error')) return false;
    return scope === 'matched' ? p.product.status === 'matched' : !issues.some((i) => i.severity === 'warning');
  });
  for (const r of targets) {
    const p = r.payload as InvoiceLine;
    await db.importRecord.update({
      where: { id: r.id },
      data: { status: 'valid', payload: json({ ...p, resolved: p.resolved ?? recordFromLine(p) }), decision: json({ action: 'approve', note: `bulk:${scope}` }), decidedBy: user.userId, decidedAt: new Date() },
    });
  }
  return { ok: true, approved: targets.length, counts: await refreshBatch(batchId) };
}

export const DecisionSchema = z.object({
  action: z.enum(['approve', 'correct', 'skip', 'reopen']),
  corrections: z.object({ product: z.string().min(1).max(64).optional(), mxik: z.string().max(17).optional() }).optional(),
  note: z.string().max(500).optional(),
});

// ── Prepare and export (Agent 1's interface) ──────────────────────────────────────────────

export type ReportLine = { recordId: string; lineNo: number; name: string; result: 'imported' | 'skipped' | 'rejected'; reason: string | null; issue: string | null; newProduct: boolean };
export type Report = {
  /** True while nothing has gone to 1C: the outcome is what an export would do. */
  dryRun: boolean;
  imported: number; skipped: number; rejected: number;
  reasons: Record<string, number>;
  newProducts: number;
  lines: ReportLine[];
};

type ExportOne = { ok: boolean; error?: string; records?: number; issues?: ValidationIssue[]; checks?: Array<{ code: string; ok: boolean; detail?: string }> };
export type PrepareAnswer = { ok: true; report: Report; onec: ExportOne } | Fail;

/** What an export of the batch would do, line by line; recorded outcomes (Agent 1) win over the forecast. */
export function forecast(records: Array<{ id: string; status: RecordStatus; payload: unknown; issues: unknown; decision: unknown; outcome: unknown }>): Report {
  const lines = records.map((r): ReportLine => {
    const p = r.payload as InvoiceLine;
    const issues = r.issues as ValidationIssue[];
    const decided = r.decision !== null && r.decision !== undefined;
    const outcome = r.outcome as { result?: ReportLine['result']; reason?: string | null } | null;
    const base = { recordId: r.id, lineNo: p.lineNo, name: p.name, newProduct: Boolean(p.resolved && p.resolved.productId === null) };
    if (outcome?.result) return { ...base, result: outcome.result, reason: outcome.reason ?? null, issue: null };
    if (r.status === 'skipped') return { ...base, result: 'skipped', reason: 'skipped', issue: null, newProduct: false };
    const error = issues.find((i) => i.severity === 'error');
    if (r.status === 'unresolved' || error) return { ...base, result: 'rejected', reason: 'unresolved', issue: error?.code ?? null, newProduct: false };
    if (!decided) return { ...base, result: 'rejected', reason: 'not_approved', issue: null, newProduct: false };
    return { ...base, result: 'imported', reason: null, issue: null };
  });
  const reasons: Record<string, number> = {};
  for (const l of lines) if (l.reason) reasons[l.reason] = (reasons[l.reason] ?? 0) + 1;
  return {
    dryRun: !records.some((r) => r.outcome),
    imported: lines.filter((l) => l.result === 'imported').length,
    skipped: lines.filter((l) => l.result === 'skipped').length,
    rejected: lines.filter((l) => l.result === 'rejected').length,
    reasons, newProducts: lines.filter((l) => l.result === 'imported' && l.newProduct).length, lines,
  };
}

/** "Prepare for 1C": the dry run. Asks Agent 1's prepareExport and reports per line what would go. */
export async function prepareInvoice(user: CurrentUser, locale: Locale, batchId: string): Promise<PrepareAnswer> {
  const e = i18nFor(locale).ta.didoxX.errors;
  const batch = await db.importBatch.findFirst({ where: { ...batchScope(user), id: batchId }, select: { id: true } });
  if (!batch) return { ok: false, error: e.not_found };
  const records = await db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' }, select: { id: true, status: true, payload: true, issues: true, decision: true, outcome: true } });
  const report = forecast(records);
  const ids = report.lines.filter((l) => l.result === 'imported').map((l) => l.recordId);
  const prepared = await prepareExport({ orgId: user.orgId, batchId, format: 'receipt_xlsx', recordIds: ids });
  const onec: ExportOne = prepared.ok ? { ok: true, records: prepared.records, issues: prepared.issues, checks: prepared.checks } : { ok: false, error: prepared.error };
  return { ok: true, report, onec };
}

export type ExportAnswer = { ok: true; file: FileOut; exportId: string } | (Fail & { code: string });

/**
 * Builds the 1C file through Agent 1: `receipt_xlsx` for the approved lines, `nomenclature_xlsx`
 * for the approved lines that create a product. Before the receipt, the products decided "create
 * new" are written with Agent 4's upsertProducts (the only place this workflow creates products).
 */
export async function exportInvoice(user: Writer, locale: Locale, batchId: string, format: 'receipt_xlsx' | 'nomenclature_xlsx'): Promise<ExportAnswer> {
  const e = i18nFor(locale).ta.didoxX.errors;
  if (!allowed(user)) return { ok: false, code: 'forbidden', error: e.forbidden };
  const batch = await db.importBatch.findFirst({ where: { ...batchScope(user), id: batchId }, select: { id: true, clientId: true, meta: true } });
  if (!batch) return { ok: false, code: 'not_found', error: e.not_found };
  // A voided ЭСФ goes nowhere (the plan refuses it too); stop before its products are written.
  const voided = documentErrors({ id: batch.id, kind: KIND, meta: batch.meta })[0];
  if (voided) return { ok: false, code: voided.code, error: i18nFor(locale).ta.didoxX.issues[voided.code] ?? e.nothing_to_export };
  const records = await db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' }, select: { id: true, status: true, payload: true, issues: true, decision: true, outcome: true } });
  const going = forecast(records).lines.filter((l) => l.result === 'imported' && (format === 'receipt_xlsx' || l.newProduct));
  if (going.length === 0) return { ok: false, code: 'nothing_to_export', error: e.nothing_to_export };

  if (format === 'receipt_xlsx') await writeProducts(user, batch.clientId, records, going);
  const built = await buildExport({ orgId: user.orgId, batchId, format, recordIds: going.map((l) => l.recordId), actorId: user.userId });
  if (!built.ok) return { ok: false, code: built.error, error: built.error === 'not_implemented' ? i18nFor(locale).ta.didoxX.detail.onecPending : e.export_failed };
  if (format === 'receipt_xlsx') {
    await db.importBatch.update({ where: { id: batchId }, data: { status: 'exported' } });
  }
  return { ok: true, file: built.file, exportId: built.exportId };
}

type Decided = { action?: string; corrections?: { product?: string; mxik?: string } } | null;

/**
 * Before the receipt goes to 1C: products for the lines decided "create new", and, for the lines a
 * reviewer pointed at an existing product, that product with the invoice's name as an alias. A
 * line the reviewer corrected (an MXIK typed, or a product chosen) is passed to Agent 4's
 * upsertProducts as `confirmed`, so the mapping is learned into FirmMapping. An existing product is
 * sent with its own fields, so the upsert (which never blanks a field) changes nothing on it but the
 * alias. New products' ids are written back into the lines.
 */
async function writeProducts(user: CurrentUser, clientId: string | null, records: Array<{ id: string; payload: unknown; decision: unknown }>, going: ReportLine[]): Promise<void> {
  const byId = new Map(records.map((r) => [r.id, { line: r.payload as InvoiceLine, decision: r.decision as Decided }]));
  const items = going.flatMap((l) => {
    const entry = byId.get(l.recordId);
    const resolved = entry?.line.resolved;
    if (!entry || !resolved) return [];
    const { line, decision } = entry;
    const chosenExisting = decision?.action === 'correct' && Boolean(decision.corrections?.product) && decision.corrections?.product !== 'new' && Boolean(resolved.productId);
    if (!l.newProduct && !chosenExisting) return [];
    const record: ProductRecord = chosenExisting
      ? { ...resolved, aliases: [...new Set([...resolved.aliases, line.name])].slice(0, 50) }
      : resolved;
    const confirmed = decision?.action === 'correct' && Boolean(decision.corrections?.mxik || decision.corrections?.product);
    return [{ recordId: l.recordId, line, record, confirmed, isNew: l.newProduct }];
  });
  if (items.length === 0) return;
  const confirmed = new Set(items.flatMap((x, i) => (x.confirmed ? [i] : [])));
  const written = await upsertProducts(user.orgId, clientId, items.map((x) => x.record), user.userId, { source: 'didox', confirmed });
  // Ids come back in record order ('' for a record without a name); only new products need theirs written back.
  const updates = items.flatMap((x, i) => (x.isNew && written.ids[i] ? [db.importRecord.update({
    where: { id: x.recordId }, data: { payload: json({ ...x.line, resolved: { ...x.record, productId: written.ids[i] } }) },
  })] : []));
  if (updates.length > 0) await db.$transaction(updates);
}

/** Classifier suggestion for a line, for the candidate picker ("pick another MXIK"). */
export async function suggestMxik(user: CurrentUser, recordId: string): Promise<{ mxik: string | null; name: string | null; status: string; suggestion: { id: string; label: string; confidence: number; reason?: string } | null } | null> {
  const record = await db.importRecord.findFirst({ where: { id: recordId, batch: batchScope(user) }, select: { payload: true } });
  if (!record) return null;
  const p = record.payload as InvoiceLine;
  const [c] = await classifyProducts(user.orgId, [{ name: p.name, mxik: p.mxik, barcode: p.barcode, unit: p.unit ?? p.packageName, packageCode: p.packageCode }]);
  return { mxik: c?.mxik ?? p.mxik, name: c?.mxikName ?? p.mxikName, status: c?.mxikStatus ?? 'unchecked', suggestion: c?.mxikSuggestion ?? null };
}

/** Whether the user may see this client's invoices (for the list filter). */
export const mayFilterClient = (user: CurrentUser, clientId: string): boolean => canSeeClient(user, clientId);
