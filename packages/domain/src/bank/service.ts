// Bank statements as the API serves them: preview and read a file, list and open statements,
// review decisions (with "remember as a rule"), bulk approval, the 1C dry run and export through
// the 1C interface (Agent 1's prepareExport / buildExport — this module never builds a 1C file),
// the reconciliation and the saved layouts and rules. Every function checks who may see or change
// the statement and answers refusals in the request's language. `user` is the caller once the
// session guard passed.
import { Prisma } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import {
  BANK_OPERATIONS, BankColumnMap, BankConventions, BankDecisionBody, type BankFormatSummary, type BankOperation, type BankPreview,
  type BankRecordPayload, type BankRecordRow, type BankStatementRow, type PrepareAnswer, type ReconcileReport,
} from '@tasnivo/contracts/modules/bank';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { z } from 'zod';
import { canSeeClient, canWrite } from '../access.js';
import { MAX_UPLOAD_BYTES } from '../catalog-import.js';
import type { FileOut } from '../catalog-exports.js';
import type { UploadedFile } from '../catalog-upload.js';
import { isDemoOrg } from '../demo.js';
import { contentDisposition } from '../export-filename.js';
import { buildExport, matchCounterparties, prepareExport, recordCounterparties } from '../onec/index.js';
import { uploadsOpen } from '../plan.js';
import { clientArchived } from '../purchases.js';
import type { CurrentUser } from '../session.js';
import { parseErrorCode } from '../spreadsheet.js';
import type { OperationSuggester } from './ai.js';
import { readDate } from './dates.js';
import { isNegativeDecimal, isZeroDecimal, readDecimal } from './decimal.js';
import { lineFingerprint } from './duplicates.js';
import { BUILT_IN_FORMATS, builtInFormat, mappingProblem } from './formats/index.js';
import { readAccount, readInn } from './identifiers.js';
import { issue, statusFromIssues, hasError } from './issues.js';
import { readLines, readStatementFile, type Layout, type StatementFile } from './read.js';
import { reconcile, reconcileCsv, type ReconcileRecord } from './reconcile.js';
import { orgRuleMatches, ruleValueFor } from './rules.js';
import {
  approvedWhere, batchCounts, batchMeta, formatBySignature, formatUsed, listFormats, processStatement, readPayload, recount,
  removeFormat, removeRule, saveFormat, upsertRule, type BankBatchMeta,
} from './store.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type ReviewDecision = z.infer<typeof accounting.ReviewDecision>;
type Fail = { ok: false; error: string };
/** A refusal the API turns into an error envelope (export, CSV). */
export type Refused = { ok: false; status: number; code: string; message: string };

const KIND = 'bank_statement' as const;
const PAGE_SIZE = 100;
const PREVIEW_ROWS = 8;
const PREVIEW_DROPPED = 50;

const writer = (user: CurrentUser): boolean => canWrite(user);
const isOperation = (v: unknown): v is BankOperation => typeof v === 'string' && (BANK_OPERATIONS as readonly string[]).includes(v);

// ── Reading a file ─────────────────────────────────────────────────────────────────────────

type ReadOk = { ok: true; file: StatementFile; clientId: string | null; filename: string };

/** The checks every upload makes, in the list uploads' order: writer, demo, plan, client, file. */
async function readUpload(user: CurrentUser, locale: Locale, clientId: unknown, file: UploadedFile | null): Promise<ReadOk | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, error: e.client };
  if (await isDemoOrg(user.orgId)) return { ok: false, error: e.demo };
  if (!(await uploadsOpen(user.orgId)).ok) return { ok: false, error: e.expired };
  let client: string | null = null;
  if (typeof clientId === 'string' && clientId !== '') {
    const exists = await db.client.count({ where: { id: clientId, orgId: user.orgId } });
    if (!exists || !canSeeClient(user, clientId) || await clientArchived(user.orgId, clientId)) return { ok: false, error: e.client };
    client = clientId;
  } else if (user.clientIds !== null) {
    // An accountant scoped to some clients cannot file a statement under the org's own books.
    return { ok: false, error: e.client };
  }
  if (!file || file.size === 0) return { ok: false, error: e.none };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: e.tooBig };
  try {
    return { ok: true, file: await readStatementFile(await file.read()), clientId: client, filename: file.name.slice(0, 255) };
  } catch (error) {
    return { ok: false, error: e[parseErrorCode(error)] };
  }
}

/** The layout a file is read with when the user did not choose columns: the org's saved one, else a built-in one. */
async function knownLayout(orgId: string, file: StatementFile): Promise<{ layout: Layout; summary: z.infer<typeof BankFormatSummary> } | null> {
  const saved = await formatBySignature(orgId, file.signature);
  if (saved) {
    return {
      layout: { formatId: `org:${saved.id}`, name: saved.name, verified: saved.verified, columnMap: saved.columnMap, conventions: saved.conventions },
      summary: { id: `org:${saved.id}`, name: saved.name, bankName: null, builtIn: false, verified: saved.verified, usedCount: saved.usedCount, createdAt: saved.createdAt.toISOString() },
    };
  }
  if (file.builtIn) {
    const f = file.builtIn.format;
    return { layout: file.builtIn.layout, summary: { id: f.id, name: f.name, bankName: f.bankName, builtIn: true, verified: f.verified, usedCount: 0, createdAt: null } };
  }
  return null;
}

async function earlierBatch(orgId: string, fingerprint: string): Promise<{ id: string; filename: string | null; createdAt: Date } | null> {
  return db.importBatch.findUnique({ where: { orgId_kind_fingerprint: { orgId, kind: KIND, fingerprint } }, select: { id: true, filename: true, createdAt: true } });
}

/** Reads a statement for the preview step: nothing is stored. */
export async function previewStatement(user: CurrentUser, locale: Locale, input: { clientId: unknown; file: UploadedFile | null }): Promise<{ ok: true; preview: BankPreview } | Fail> {
  const read = await readUpload(user, locale, input.clientId, input.file);
  if (!read.ok) return read;
  const { file } = read;
  const known = await knownLayout(user.orgId, file);
  const layout: Layout = known?.layout ?? { formatId: 'generic_mapped', name: '', verified: false, ...file.guess };
  const parsed = readLines(file, layout);
  if (file.sheet.body.length === 0) return { ok: false, error: i18nFor(locale).ta.bankX.errors.empty };
  const earlier = await earlierBatch(user.orgId, file.fingerprint);
  return {
    ok: true,
    preview: {
      filename: read.filename,
      headers: file.sheet.headers,
      rows: file.sheet.body.slice(0, PREVIEW_ROWS).map((r) => r.cells),
      headerRow: file.sheet.headerRow,
      titleLines: file.sheet.titleLines,
      format: known?.summary ?? null,
      columnMap: layout.columnMap,
      conventions: layout.conventions,
      recognised: known !== null,
      dropped: parsed.dropped.slice(0, PREVIEW_DROPPED),
      dataRows: parsed.lines.length,
      totalRows: parsed.extra.totalRows,
      truncated: parsed.extra.truncated,
      duplicateOf: earlier ? { batchId: earlier.id, filename: earlier.filename, createdAt: earlier.createdAt.toISOString() } : null,
      header: {
        account: parsed.meta.account, currency: parsed.meta.currency, periodFrom: parsed.meta.periodFrom, periodTo: parsed.meta.periodTo,
        openingBalance: parsed.meta.openingBalance, closingBalance: parsed.meta.closingBalance, bankName: parsed.meta.bankName,
      },
    },
  };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** BankColumnMap with every role present, so two maps compare by value. */
const fullMap = (m: BankColumnMap): BankColumnMap => BankColumnMap.parse({ ...Object.fromEntries(Object.keys(BankColumnMap.shape).map((k) => [k, -1])), ...m });

/** Statement processing started by this process, by batch id (tests and the benchmark wait on it). */
const inflight = new Map<string, Promise<void>>();
export const processing = (batchId: string): Promise<void> => inflight.get(batchId) ?? Promise.resolve();

export type CreateInput = { clientId: unknown; file: UploadedFile | null; columnMap: unknown; conventions: unknown; formatName?: unknown };

/**
 * Reads a statement with the chosen columns: refuses a file read before (naming that statement),
 * saves the mapping as the org's layout when the user named it, stores the batch and starts
 * processing its lines (not awaited: the screen polls the statement's progress).
 */
export async function createStatement(user: CurrentUser, locale: Locale, input: CreateInput, options: { suggester?: OperationSuggester | null } = {}): Promise<{ ok: true; batchId: string } | (Fail & { duplicateOf?: string })> {
  const e = i18nFor(locale).ta.bankX.errors;
  const read = await readUpload(user, locale, input.clientId, input.file);
  if (!read.ok) return read;
  const { file } = read;
  const earlier = await earlierBatch(user.orgId, file.fingerprint);
  if (earlier) return { ok: false, error: e.duplicate, duplicateOf: earlier.id };

  const parseJson = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value) as unknown; } catch { return null; }
  };
  const map = BankColumnMap.safeParse(parseJson(input.columnMap));
  const conventions = BankConventions.safeParse(parseJson(input.conventions));
  if (!map.success || !conventions.success) return { ok: false, error: e.badMapping };
  const columnMap = fullMap(map.data);
  const width = file.sheet.headers.length;
  if (Object.values(columnMap).some((c) => c !== undefined && c >= width) || mappingProblem(columnMap, conventions.data)) return { ok: false, error: e.badMapping };

  const formatName = typeof input.formatName === 'string' ? input.formatName.trim().slice(0, 120) : '';
  const known = await knownLayout(user.orgId, file);
  let layout: Layout;
  if (formatName) {
    const id = await saveFormat({ orgId: user.orgId, actorId: user.userId, name: formatName, signature: file.signature, columnMap, conventions: conventions.data });
    layout = { formatId: `org:${id}`, name: formatName, verified: false, columnMap, conventions: conventions.data };
  } else if (known && sameJson(fullMap(known.layout.columnMap), columnMap) && sameJson(known.layout.conventions, conventions.data)) {
    layout = known.layout;
  } else {
    layout = { formatId: 'generic_mapped', name: '', verified: false, columnMap, conventions: conventions.data };
  }
  const parsed = readLines(file, layout);
  if (parsed.lines.length === 0) return { ok: false, error: e.empty };
  if (layout.formatId.startsWith('org:') && !formatName) await formatUsed(layout.formatId.slice(4));

  let batchId: string;
  try {
    const batch = await db.importBatch.create({
      data: {
        orgId: user.orgId, clientId: read.clientId, kind: KIND, source: 'upload', filename: read.filename, fingerprint: file.fingerprint,
        status: 'uploaded', createdBy: user.userId,
        meta: { ...parsed.meta, bank: { ...parsed.extra, progress: { done: 0, total: parsed.lines.length }, ai: null } },
        counts: { total: parsed.lines.length, valid: 0, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0, approved: 0, progress: { done: 0, total: parsed.lines.length } },
      },
      select: { id: true },
    });
    batchId = batch.id;
  } catch {
    // The unique (org, kind, fingerprint) index: the same file uploaded twice at once.
    const twin = await earlierBatch(user.orgId, file.fingerprint);
    return twin ? { ok: false, error: e.duplicate, duplicateOf: twin.id } : { ok: false, error: e.saveFailed };
  }
  const run = processStatement({ batchId, orgId: user.orgId, clientId: read.clientId, parsed, ...(options.suggester !== undefined ? { suggester: options.suggester } : {}) })
    .finally(() => inflight.delete(batchId));
  inflight.set(batchId, run);
  return { ok: true, batchId };
}

// ── Statements ─────────────────────────────────────────────────────────────────────────────

const batchSelect = {
  id: true, orgId: true, clientId: true, filename: true, status: true, counts: true, meta: true, error: true, createdAt: true, updatedAt: true,
  client: { select: { name: true } },
  exports: { orderBy: { createdAt: 'desc' }, select: { id: true, format: true, filename: true, recordCount: true, createdAt: true, outcome: true } },
} satisfies Prisma.ImportBatchSelect;
type BatchRow = Prisma.ImportBatchGetPayload<{ select: typeof batchSelect }>;

function statementRow(b: BatchRow): BankStatementRow {
  const meta = batchMeta(b.meta);
  const counts = batchCounts(b.counts);
  const formatId = meta?.formatId ?? null;
  const builtIn = formatId ? builtInFormat(formatId) : undefined;
  return {
    id: b.id, clientId: b.clientId, clientName: b.client?.name ?? null, filename: b.filename, status: b.status,
    counts: counts ? { total: counts.total, valid: counts.valid, corrected: counts.corrected, suspicious: counts.suspicious, unresolved: counts.unresolved, skipped: counts.skipped, exported: counts.exported } : null,
    progress: b.status === 'uploaded' ? (counts?.progress ?? meta?.bank.progress ?? null) : null,
    approved: counts?.approved ?? 0,
    error: b.error,
    formatId, formatName: meta?.bank.formatName || builtIn?.name || null, formatVerified: meta?.bank.formatVerified ?? false,
    bankName: meta?.bankName ?? null, account: meta?.account ?? null, currency: meta?.currency ?? null,
    periodFrom: meta?.periodFrom ?? null, periodTo: meta?.periodTo ?? null,
    openingBalance: meta?.openingBalance ?? null, closingBalance: meta?.closingBalance ?? null,
    createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    exports: b.exports.flatMap((x) => {
      const format = x.format as BankStatementRow['exports'][number]['format'];
      return [{ id: x.id, format, filename: x.filename, recordCount: x.recordCount, createdAt: x.createdAt.toISOString(), outcome: (x.outcome ?? null) as BankStatementRow['exports'][number]['outcome'] }];
    }),
  };
}

/** The statement if the user may see it (same org, a client they may open), else null. */
async function visibleBatch(user: CurrentUser, batchId: string): Promise<BatchRow | null> {
  const b = await db.importBatch.findFirst({ where: { id: batchId, orgId: user.orgId, kind: KIND }, select: batchSelect });
  if (!b) return null;
  if (b.clientId ? !canSeeClient(user, b.clientId) : user.clientIds !== null) return null;
  return b;
}

export async function listStatements(user: CurrentUser, client?: string | null): Promise<BankStatementRow[]> {
  const where: Prisma.ImportBatchWhereInput = { orgId: user.orgId, kind: KIND };
  if (client) where.clientId = client;
  if (user.clientIds !== null) where.clientId = client ? (user.clientIds.includes(client) ? client : '__none__') : { in: user.clientIds };
  const rows = await db.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, select: batchSelect });
  return rows.map(statementRow);
}

export async function statementDetail(user: CurrentUser, batchId: string): Promise<{ statement: BankStatementRow; dropped: { rowIndex: number; reason: string }[] } | null> {
  const b = await visibleBatch(user, batchId);
  if (!b) return null;
  return { statement: statementRow(b), dropped: batchMeta(b.meta)?.dropped ?? [] };
}

type RecordQuery = { status?: string; page?: number; q?: string };

function recordRow(r: { id: string; rowIndex: number; status: BankRecordRow['status']; payload: unknown; issues: unknown; decision: unknown; decidedAt: Date | null; outcome: unknown }): BankRecordRow | null {
  const payload = readPayload(r.payload);
  if (!payload) return null;
  return {
    id: r.id, rowIndex: r.rowIndex, status: r.status, payload,
    issues: (Array.isArray(r.issues) ? r.issues : []) as ValidationIssue[],
    decision: (r.decision ?? null) as ReviewDecision | null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    outcome: (r.outcome ?? null) as BankRecordRow['outcome'],
  };
}

const recordSelect = { id: true, rowIndex: true, status: true, payload: true, issues: true, decision: true, decidedAt: true, outcome: true } satisfies Prisma.ImportRecordSelect;

function statusWhere(batchId: string, status: string | undefined): Prisma.ImportRecordWhereInput {
  switch (status) {
    case undefined: case 'all': return { batchId };
    case 'approved': return approvedWhere(batchId);
    // What still needs a person: errors and warnings not decided yet.
    case 'open': return { batchId, status: { in: ['unresolved', 'suspicious'] }, NOT: { decision: { path: ['action'], equals: 'approve' } } };
    case 'valid': return { batchId, status: 'valid', NOT: { decision: { path: ['action'], equals: 'approve' } } };
    default: return { batchId, status: status as BankRecordRow['status'] };
  }
}

export async function statementRecords(user: CurrentUser, batchId: string, query: RecordQuery): Promise<{ records: BankRecordRow[]; total: number; page: number; pageSize: number } | null> {
  const b = await visibleBatch(user, batchId);
  if (!b) return null;
  const where = statusWhere(batchId, query.status);
  const q = query.q?.trim();
  if (q) {
    where.AND = [{
      OR: [
        { payload: { path: ['counterparty', 'name'], string_contains: q, mode: 'insensitive' } },
        { payload: { path: ['counterparty', 'inn'], string_contains: q } },
        { payload: { path: ['purpose'], string_contains: q, mode: 'insensitive' } },
      ],
    }];
  }
  const page = Math.max(1, query.page ?? 1);
  const [total, rows] = await Promise.all([
    db.importRecord.count({ where }),
    db.importRecord.findMany({ where, orderBy: { rowIndex: 'asc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, select: recordSelect }),
  ]);
  return { records: rows.flatMap((r) => recordRow(r) ?? []), total, page, pageSize: PAGE_SIZE };
}

// ── Decisions ──────────────────────────────────────────────────────────────────────────────

/** Issue codes a corrected field clears (they are re-checked from the corrected value). */
const CLEARS: Record<string, readonly string[]> = {
  date: ['date_missing', 'date_invalid'],
  amount: ['amount_missing', 'amount_invalid', 'amount_both_columns', 'amount_negative', 'amount_ambiguous'],
  direction: ['direction_missing', 'amount_missing', 'amount_both_columns'],
  'counterparty.name': ['counterparty_missing', 'counterparty_unknown', 'counterparty_ambiguous', 'counterparty_new'],
  'counterparty.inn': ['inn_invalid', 'counterparty_missing', 'counterparty_unknown', 'counterparty_ambiguous', 'counterparty_new'],
  'counterparty.account': ['account_invalid'],
  purpose: ['purpose_missing'],
  operation: ['operation_missing', 'operation_suggested'],
};

const FIELDS = ['operation', 'cashFlowItem', 'contract', 'counterparty.name', 'counterparty.inn', 'counterparty.account', 'date', 'amount', 'direction', 'purpose', 'docNumber'] as const;
type Field = (typeof FIELDS)[number];

/** Applies the reviewer's corrections to a payload; answers the first field whose value is not acceptable. */
export function applyCorrections(payload: BankRecordPayload, corrections: Record<string, string | null>): { ok: true; payload: BankRecordPayload; fields: Field[] } | { ok: false; field: string } {
  const p: BankRecordPayload = { ...payload, counterparty: { ...payload.counterparty } };
  const fields: Field[] = [];
  for (const [key, raw] of Object.entries(corrections)) {
    const field = FIELDS.find((f) => f === key);
    if (!field) return { ok: false, field: key };
    const value = raw === null ? null : raw.trim();
    switch (field) {
      case 'operation':
        if (value !== null && value !== '' && !isOperation(value)) return { ok: false, field };
        p.operation = value || null;
        p.decidedBy = 'manual';
        p.operationSuggestion = null;
        break;
      case 'cashFlowItem': p.cashFlowItem = value ? value.slice(0, 120) : null; break;
      case 'contract': p.contract = value ? value.slice(0, 120) : null; break;
      case 'docNumber': p.docNumber = value ? value.slice(0, 40) : null; break;
      case 'purpose': p.purpose = (value ?? '').slice(0, 2000); break;
      case 'counterparty.name':
        p.counterparty.name = (value ?? '').slice(0, 300);
        p.counterparty.counterpartyId = null;
        delete p.counterparty.match;
        break;
      case 'counterparty.inn': {
        const inn = readInn(value);
        if (inn.invalid) return { ok: false, field };
        p.counterparty.inn = inn.value;
        p.counterparty.counterpartyId = null;
        delete p.counterparty.match;
        break;
      }
      case 'counterparty.account': {
        const account = readAccount(value);
        if (account.invalid) return { ok: false, field };
        p.counterparty.account = account.value;
        break;
      }
      case 'date': {
        const date = readDate(value, 'dmy');
        if (!date.value) return { ok: false, field };
        p.date = date.value;
        break;
      }
      case 'amount': {
        const amount = readDecimal(value, 'auto');
        if (!amount.value || amount.invalid || isZeroDecimal(amount.value) || isNegativeDecimal(amount.value)) return { ok: false, field };
        p.amount = amount.value;
        break;
      }
      case 'direction':
        if (value !== 'debit' && value !== 'credit') return { ok: false, field };
        p.direction = value;
        break;
    }
    fields.push(field);
  }
  return { ok: true, payload: p, fields };
}

/** The issues after a correction: the corrected fields' issues dropped, the presence checks run again. */
export function reissue(issues: readonly ValidationIssue[], payload: BankRecordPayload, fields: readonly string[]): ValidationIssue[] {
  const cleared = new Set(fields.flatMap((f) => CLEARS[f] ?? []));
  const out = issues.filter((i) => !cleared.has(i.code));
  const has = (code: string): boolean => out.some((i) => i.code === code);
  if (!payload.date && !has('date_invalid') && !has('date_missing')) out.push(issue('date_missing', 'date'));
  if ((!payload.amount || !payload.direction) && !out.some((i) => i.severity === 'error' && (i.field === 'amount' || i.field === 'direction'))) out.push(issue('amount_missing', 'amount'));
  if (!payload.counterparty.name.trim() && !payload.counterparty.inn && !has('counterparty_missing') && fields.some((f) => f.startsWith('counterparty.'))) out.push(issue('counterparty_missing', 'counterparty.name'));
  if (!payload.purpose && !has('purpose_missing') && fields.includes('purpose')) out.push(issue('purpose_missing', 'purpose'));
  if (fields.includes('operation') && !payload.operation && payload.direction) out.push(issue('operation_missing', 'operation'));
  return out;
}

type DecideAnswer = { ok: true; record: BankRecordRow; ruleId: string | null; applied: number } | Fail;

/**
 * One reviewer decision. `correct` (and `approve` with corrections) changes payload fields and
 * re-checks them; `approve` needs a line without errors; `skip` takes the line out of the export;
 * `reopen` undoes the decision. A line exported to 1C is final. `remember` saves the line's
 * operation as a rule for its counterparty or a purpose text and applies it to the statement's
 * other undecided lines.
 */
export async function decideRecord(user: CurrentUser, locale: Locale, recordId: string, body: unknown): Promise<DecideAnswer> {
  const { ta } = i18nFor(locale);
  const e = ta.bankX.errors;
  const parsed = BankDecisionBody.safeParse(body);
  if (!writer(user)) return { ok: false, error: e.client };
  if (!parsed.success) return { ok: false, error: e.badMapping };
  const input = parsed.data;
  const record = await db.importRecord.findUnique({ where: { id: recordId }, select: { ...recordSelect, fingerprint: true, batchId: true } });
  if (!record) return { ok: false, error: e.notFound };
  const batch = await visibleBatch(user, record.batchId);
  if (!batch) return { ok: false, error: e.notFound };
  if (record.status === 'exported') return { ok: false, error: e.exported };
  const current = readPayload(record.payload);
  if (!current) return { ok: false, error: e.saveFailed };
  let issues = (Array.isArray(record.issues) ? record.issues : []) as ValidationIssue[];
  const previous = (record.decision ?? null) as ReviewDecision | null;

  let payload = current;
  let status = record.status;
  let decision: ReviewDecision | null = previous;
  const corrections = input.corrections ?? {};
  if (input.action === 'correct' || (input.action === 'approve' && Object.keys(corrections).length > 0)) {
    const applied = applyCorrections(current, corrections);
    if (!applied.ok) return { ok: false, error: e.badValue(applied.field) };
    payload = applied.payload;
    issues = reissue(issues, payload, applied.fields);
    if (applied.fields.some((f) => f.startsWith('counterparty.'))) {
      const [ref] = await matchCounterparties(user.orgId, [payload.counterparty]).catch(() => [undefined]);
      if (ref) {
        payload.counterparty = { name: ref.name, inn: ref.inn, account: ref.account, mfo: ref.mfo, counterpartyId: ref.counterpartyId, ...(ref.match ? { match: ref.match } : {}) };
        if ((ref.name.trim() || ref.inn) && ref.match?.status !== 'matched') {
          issues.push(issue(ref.match?.status === 'new' ? 'counterparty_new' : ref.match?.status === 'ambiguous' ? 'counterparty_ambiguous' : 'counterparty_unknown', 'counterparty.name'));
        }
      }
    }
    status = hasError(issues) ? 'unresolved' : 'corrected';
    decision = { action: 'correct', corrections: { ...(previous?.corrections ?? {}), ...corrections }, ...(input.note ? { note: input.note } : {}) };
  }
  if (input.action === 'approve') {
    if (hasError(issues)) return { ok: false, error: e.unresolved };
    decision = { action: 'approve', ...(decision?.corrections ? { corrections: decision.corrections } : {}), ...(input.note ? { note: input.note } : {}) };
    if (status === 'skipped' || status === 'unresolved') status = statusFromIssues(issues);
  }
  if (input.action === 'skip') {
    status = 'skipped';
    decision = { action: 'skip', ...(previous?.corrections ? { corrections: previous.corrections } : {}), ...(input.note ? { note: input.note } : {}) };
  }
  if (input.action === 'reopen') {
    decision = null;
    status = previous?.corrections && !hasError(issues) ? 'corrected' : statusFromIssues(issues);
  }

  // Remember the operation as a rule.
  let ruleId: string | null = null;
  let rule: { kind: 'inn_equals' | 'counterparty_equals' | 'purpose_contains'; value: string } | null = null;
  if (input.remember) {
    if (!isOperation(payload.operation)) return { ok: false, error: e.rememberNeedsOperation };
    if (input.remember.by === 'counterparty') {
      const inn = ruleValueFor('inn_equals', payload);
      const name = ruleValueFor('counterparty_equals', payload);
      rule = inn ? { kind: 'inn_equals', value: inn } : name ? { kind: 'counterparty_equals', value: name } : null;
    } else {
      const text = ruleValueFor('purpose_contains', payload, input.remember.value);
      rule = text ? { kind: 'purpose_contains', value: text } : null;
    }
    if (!rule) return { ok: false, error: e.rememberNoValue };
  }

  const fingerprint = payload.date && payload.amount && payload.direction ? lineFingerprint(payload) : record.fingerprint;
  const updated = await db.importRecord.update({
    where: { id: record.id },
    data: {
      payload: payload, issues: issues, status, fingerprint,
      decision: decision === null ? (null as unknown as Prisma.InputJsonValue) : (decision as unknown as Prisma.InputJsonValue),
      decidedBy: decision ? user.userId : null, decidedAt: decision ? new Date() : null,
    },
    select: recordSelect,
  });

  let applied = 0;
  if (rule && isOperation(payload.operation)) {
    ruleId = await upsertRule({ orgId: user.orgId, clientId: batch.clientId, actorId: user.userId, kind: rule.kind, value: rule.value, operation: payload.operation, cashFlowItem: payload.cashFlowItem });
    applied = await applyRuleToBatch(record.batchId, record.id, { id: ruleId, kind: rule.kind, value: rule.value, operation: payload.operation, cashFlowItem: payload.cashFlowItem });
    if (applied > 0) await db.bankRule.update({ where: { id: ruleId }, data: { hits: { increment: applied } } });
  }
  await recount(record.batchId);
  const row = recordRow(updated);
  return row ? { ok: true, record: row, ruleId, applied } : { ok: false, error: e.saveFailed };
}

/** A new rule on the statement's other lines that no person decided: their operation follows it. */
async function applyRuleToBatch(batchId: string, exceptId: string, rule: { id: string; kind: 'inn_equals' | 'counterparty_equals' | 'purpose_contains'; value: string; operation: BankOperation; cashFlowItem: string | null }): Promise<number> {
  const rows = await db.importRecord.findMany({
    where: { batchId, id: { not: exceptId }, status: { notIn: ['exported', 'skipped'] }, decision: { equals: Prisma.DbNull } },
    select: { id: true, payload: true, issues: true, status: true },
  });
  let applied = 0;
  for (const r of rows) {
    const p = readPayload(r.payload);
    if (!p || p.decidedBy === 'manual' || !orgRuleMatches(rule, p) || p.operation === rule.operation) continue;
    p.operation = rule.operation;
    p.cashFlowItem = rule.cashFlowItem;
    p.decidedBy = `rule:${rule.id}`;
    p.operationSuggestion = null;
    const issues = ((Array.isArray(r.issues) ? r.issues : []) as ValidationIssue[]).filter((i) => i.code !== 'operation_missing' && i.code !== 'operation_suggested');
    const status = r.status === 'corrected' ? 'corrected' : statusFromIssues(issues);
    await db.importRecord.update({ where: { id: r.id }, data: { payload: p, issues: issues, status } });
    applied++;
  }
  return applied;
}

const ApproveBody = z.object({ scope: z.enum(['valid', 'reviewable', 'ids']), ids: z.array(z.string().min(1)).max(5000).optional() });

/** Bulk approval: the valid lines, every line without an error, or the given ids (lines with an error never). */
export async function approveMany(user: CurrentUser, locale: Locale, batchId: string, body: unknown): Promise<{ ok: true; approved: number } | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  const parsed = ApproveBody.safeParse(body);
  if (!writer(user)) return { ok: false, error: e.client };
  if (!parsed.success) return { ok: false, error: e.badMapping };
  const batch = await visibleBatch(user, batchId);
  if (!batch) return { ok: false, error: e.notFound };
  const statuses: Prisma.EnumRecordStatusFilter<'ImportRecord'> = parsed.data.scope === 'valid' ? { equals: 'valid' } : { in: ['valid', 'corrected', 'suspicious'] };
  const where: Prisma.ImportRecordWhereInput = {
    batchId, status: statuses, NOT: { decision: { path: ['action'], equals: 'approve' } },
    ...(parsed.data.scope === 'ids' ? { id: { in: parsed.data.ids ?? [] } } : {}),
  };
  const rows = await db.importRecord.findMany({ where, select: { id: true, decision: true } });
  const now = new Date();
  const plain = rows.filter((r) => r.decision === null).map((r) => r.id);
  for (let i = 0; i < plain.length; i += 1000) {
    await db.importRecord.updateMany({ where: { id: { in: plain.slice(i, i + 1000) } }, data: { decision: { action: 'approve' }, decidedBy: user.userId, decidedAt: now } });
  }
  for (const r of rows.filter((x) => x.decision !== null)) {
    const previous = r.decision as ReviewDecision;
    await db.importRecord.update({ where: { id: r.id }, data: { decision: { action: 'approve', ...(previous.corrections ? { corrections: previous.corrections } : {}) }, decidedBy: user.userId, decidedAt: now } });
  }
  await recount(batchId);
  return { ok: true, approved: rows.length };
}

// ── 1C ─────────────────────────────────────────────────────────────────────────────────────

const FORMAT = 'bank_exchange_1_02' as const;

async function allRecords(batchId: string): Promise<(ReconcileRecord & { id: string; issuesRaw: ValidationIssue[]; approved: boolean })[]> {
  const rows = await db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' }, select: { id: true, rowIndex: true, status: true, payload: true, issues: true, decision: true } });
  return rows.flatMap((r) => {
    const payload = readPayload(r.payload);
    if (!payload) return [];
    const issues = (Array.isArray(r.issues) ? r.issues : []) as ValidationIssue[];
    const decision = (r.decision ?? null) as ReviewDecision | null;
    return [{ id: r.id, rowIndex: r.rowIndex, status: r.status, payload, issues, issuesRaw: issues, note: decision?.note ?? null, approved: decision?.action === 'approve' }];
  });
}

function reportOf(meta: BankBatchMeta | null, records: ReconcileRecord[]): Omit<ReconcileReport, 'statement'> {
  return reconcile({
    openingBalance: meta?.openingBalance ?? null, closingBalance: meta?.closingBalance ?? null,
    bankTotals: meta?.bank.bankTotals ?? { debit: null, credit: null }, dropped: meta?.dropped ?? [],
  }, records);
}

/** The dry run: what the next export would send, the statement's own checks, and the 1C interface's answer. */
export async function prepareStatement(user: CurrentUser, locale: Locale, batchId: string): Promise<z.infer<typeof PrepareAnswer> | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, error: e.client };
  const batch = await visibleBatch(user, batchId);
  if (!batch) return { ok: false, error: e.notFound };
  const records = await allRecords(batchId);
  const ready = records.filter((r) => r.approved && r.status !== 'exported' && r.status !== 'skipped' && r.status !== 'unresolved');
  const report = reportOf(batchMeta(batch.meta), records);
  const exportedDuplicates = ready.filter((r) => r.issuesRaw.some((i) => i.code === 'duplicate_row' && i.params?.['source'] === 'exported')).length;
  const unresolved = records.filter((r) => r.status === 'unresolved').length;
  const checks = [
    { code: 'ready', ok: ready.length > 0, detail: String(ready.length) },
    { code: 'balance_reconciles', ok: report.balanced !== false, ...(report.difference !== null ? { detail: report.difference } : {}) },
    { code: 'bank_totals_match', ok: report.bankTotals.debitMatches !== false && report.bankTotals.creditMatches !== false },
    { code: 'no_unresolved', ok: unresolved === 0, detail: String(unresolved) },
    { code: 'no_exported_duplicates', ok: exportedDuplicates === 0, detail: String(exportedDuplicates) },
  ];
  const onec = ready.length > 0
    ? await prepareExport({ orgId: user.orgId, batchId, format: FORMAT, recordIds: ready.map((r) => r.id) }).catch(() => ({ ok: false as const, error: 'failed' }))
    : { ok: false as const, error: 'nothing_to_export' };
  return {
    ok: true,
    ready: ready.length,
    alreadyExported: records.filter((r) => r.status === 'exported').length,
    waiting: records.filter((r) => !r.approved && r.status !== 'exported' && r.status !== 'skipped').length,
    unresolved,
    checks,
    onec: onec.ok ? { ok: true, records: onec.records, issues: onec.issues } : { ok: false, error: onec.error },
  };
}

/**
 * The 1C file of the approved lines not exported yet, built by the 1C interface (Agent 1). A line
 * exported before is never sent again: the record ids passed are only the non-exported ones, and
 * the interface marks what it wrote as exported.
 */
export async function exportStatement(user: CurrentUser, locale: Locale, batchId: string): Promise<{ ok: true; file: FileOut } | Refused> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, status: 403, code: 'forbidden', message: e.client };
  const batch = await visibleBatch(user, batchId);
  if (!batch) return { ok: false, status: 404, code: 'not_found', message: e.notFound };
  const ready = await db.importRecord.findMany({ where: approvedWhere(batchId), orderBy: { rowIndex: 'asc' }, select: { id: true, payload: true } });
  if (ready.length === 0) return { ok: false, status: 409, code: 'nothing_to_export', message: e.nothingToExport };

  // Counterparties that go to 1C are recorded (matched or created) first, so the file can name them.
  const payloads = ready.map((r) => readPayload(r.payload));
  const refs = await recordCounterparties(user.orgId, payloads.map((p) => p?.counterparty ?? { name: '', inn: null, account: null, mfo: null, counterpartyId: null })).catch(() => null);
  if (refs) {
    for (const [i, ref] of refs.entries()) {
      const p = payloads[i];
      const r = ready[i];
      if (!p || !r || !ref.counterpartyId || ref.counterpartyId === p.counterparty.counterpartyId) continue;
      p.counterparty = { ...p.counterparty, counterpartyId: ref.counterpartyId, ...(ref.match ? { match: ref.match } : {}) };
      await db.importRecord.update({ where: { id: r.id }, data: { payload: p } });
    }
  }
  const built = await buildExport({ orgId: user.orgId, batchId, format: FORMAT, recordIds: ready.map((r) => r.id), actorId: user.userId })
    .catch(() => ({ ok: false as const, error: 'failed' }));
  if (!built.ok) {
    return built.error === 'not_implemented'
      ? { ok: false, status: 501, code: 'not_implemented', message: e.onecUnavailable }
      : { ok: false, status: 409, code: built.error.slice(0, 60), message: e.saveFailed };
  }
  await recount(batchId);
  return { ok: true, file: built.file };
}

// ── Reconciliation ─────────────────────────────────────────────────────────────────────────

export async function reconcileStatement(user: CurrentUser, batchId: string): Promise<ReconcileReport | null> {
  const batch = await visibleBatch(user, batchId);
  if (!batch) return null;
  const records = await allRecords(batchId);
  return { statement: statementRow(batch), ...reportOf(batchMeta(batch.meta), records) };
}

export async function reconcileCsvFile(user: CurrentUser, locale: Locale, batchId: string): Promise<{ ok: true; file: FileOut } | Refused> {
  const { ta } = i18nFor(locale);
  const b = ta.bankX;
  const batch = await visibleBatch(user, batchId);
  if (!batch) return { ok: false, status: 404, code: 'not_found', message: b.errors.notFound };
  const records = await allRecords(batchId);
  const report = reportOf(batchMeta(batch.meta), records);
  const r = b.reconcile;
  const csv = reconcileCsv(report, records, {
    summary: r.summary, opening: r.opening, credits: r.credits, debits: r.debits, computed: r.computed, closing: r.closing, difference: r.difference,
    columns: r.csvColumns,
    operation: (op) => (op && isOperation(op) ? b.operations[op] : b.operations.none),
    status: (s) => ta.accountingX.record[s],
    issue: (code) => (b.issues as Record<string, string>)[code] ?? code,
  });
  const base = (batch.filename ?? batch.id).replace(/\.[^.]+$/, '');
  return { ok: true, file: { body: csv, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': contentDisposition('attachment', r.file(base)), 'cache-control': 'no-store' } } };
}

// ── Removal, layouts, rules ────────────────────────────────────────────────────────────────

export async function removeStatement(user: CurrentUser, locale: Locale, batchId: string): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, error: e.client };
  const batch = await visibleBatch(user, batchId);
  if (!batch) return { ok: false, error: e.notFound };
  const exported = await db.importRecord.count({ where: { batchId, status: 'exported' } });
  if (exported > 0 || batch.exports.length > 0) return { ok: false, error: e.removeExported };
  await processing(batchId);
  await db.importBatch.delete({ where: { id: batchId } });
  return { ok: true };
}

export async function bankFormats(user: CurrentUser): Promise<z.infer<typeof BankFormatSummary>[]> {
  const saved = await listFormats(user.orgId);
  return [
    ...saved.map((f) => ({ id: `org:${f.id}`, name: f.name, bankName: null, builtIn: false, verified: f.verified, usedCount: f.usedCount, createdAt: f.createdAt.toISOString() })),
    ...BUILT_IN_FORMATS.map((f) => ({ id: f.id, name: f.name, bankName: f.bankName, builtIn: true, verified: f.verified, usedCount: 0, createdAt: null })),
  ];
}

export async function removeBankFormat(user: CurrentUser, locale: Locale, formatId: string): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, error: e.client };
  const id = formatId.startsWith('org:') ? formatId.slice(4) : formatId;
  return (await removeFormat(user.orgId, id)) ? { ok: true } : { ok: false, error: e.notFound };
}

export async function bankRules(user: CurrentUser): Promise<{ id: string; clientId: string | null; kind: OrgRuleKind; value: string; operation: BankOperation; cashFlowItem: string | null; priority: number; hits: number; createdAt: string }[]> {
  const rows = await db.bankRule.findMany({ where: { orgId: user.orgId }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
  return rows.flatMap((r) => (isOperation(r.operation) && isRuleKind(r.kind) && (r.clientId === null || canSeeClient(user, r.clientId))
    ? [{ id: r.id, clientId: r.clientId, kind: r.kind, value: r.value, operation: r.operation, cashFlowItem: r.cashFlowItem, priority: r.priority, hits: r.hits, createdAt: r.createdAt.toISOString() }]
    : []));
}

type OrgRuleKind = 'purpose_contains' | 'inn_equals' | 'counterparty_equals' | 'amount_sign';
const isRuleKind = (v: string): v is OrgRuleKind => ['purpose_contains', 'inn_equals', 'counterparty_equals', 'amount_sign'].includes(v);

export async function removeBankRule(user: CurrentUser, locale: Locale, ruleId: string): Promise<{ ok: true } | Fail> {
  const e = i18nFor(locale).ta.bankX.errors;
  if (!writer(user)) return { ok: false, error: e.client };
  return (await removeRule(user.orgId, ruleId)) ? { ok: true } : { ok: false, error: e.notFound };
}

