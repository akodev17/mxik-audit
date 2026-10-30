// Bank statements: upload, map, review and prepare for 1C (Agent 2, docs/TASNIVO_AI_PLAN_2026-10-23.md
// §4, §7 A2). A statement is an import_batch of kind bank_statement; each line is an import_record
// whose payload is a BankTransaction (accounting.ts). The 1C file itself is built by the onec
// interface (Agent 1); these endpoints never build one.
import { z } from 'zod';
import {
  BankAccount, BatchCounts, Currency, DecimalString, ImportOutcome, IsoDate, MatchCandidate, ONEC_FORMATS, RecordOutcome, RECORD_STATUSES,
  ReviewDecision, ValidationIssue, BankTransaction, IMPORT_STATUSES,
} from '../accounting';
import { Fail, Id, IsoDateTime, LIMITS, Ok } from '../common';
import { defineModule, endpoint } from '../endpoint';

// ── Columns, conventions, operations ───────────────────────────────────────────────────────

/**
 * What a statement column can hold. `account` / `mfo` / `inn` are the counterparty's; the org's own
 * account comes from the title rows, or from an `ownAccount` column when one file holds every account
 * (iBank2 «Экспортировать в один файл», bank research §7.40). `date` is the document date and
 * `valueDate` the posting (processing) date when the file prints both (§7.34); `purposeCode` is the
 * 5-digit CBU payment-purpose code column (§7.38).
 */
export const BANK_ROLES = [
  'date', 'docNumber', 'debit', 'credit', 'amount', 'direction', 'counterpartyName', 'inn', 'account', 'mfo', 'purpose', 'reference', 'currency',
  'ownAccount', 'valueDate', 'purposeCode',
] as const;
export type BankRole = (typeof BANK_ROLES)[number];

const col = z.number().int().min(-1).max(500);
/** Role → source column index; -1 (or absent) = not in the file. */
export const BankColumnMap = z.object({
  date: col, docNumber: col.optional(), debit: col.optional(), credit: col.optional(), amount: col.optional(), direction: col.optional(),
  counterpartyName: col.optional(), inn: col.optional(), account: col.optional(), mfo: col.optional(), purpose: col.optional(),
  reference: col.optional(), currency: col.optional(), ownAccount: col.optional(), valueDate: col.optional(), purposeCode: col.optional(),
});
export type BankColumnMap = z.infer<typeof BankColumnMap>;

/**
 * How the file writes its values. `direction`: two amount columns (`columns`), one signed amount
 * (`signed`, a negative amount is `negativeIs`), or one amount plus a debit/credit flag column (`flag`).
 */
export const BankConventions = z.object({
  dateOrder: z.enum(['dmy', 'ymd', 'mdy']),
  decimal: z.enum(['auto', 'comma', 'dot']),
  direction: z.enum(['columns', 'signed', 'flag']),
  negativeIs: z.enum(['debit', 'credit']),
  /** Used when neither the title nor a column names the currency. */
  currency: Currency,
});
export type BankConventions = z.infer<typeof BankConventions>;

/** The 1C bank operations a line can be assigned (labels in bankX.operations). */
export const BANK_OPERATIONS = ['payment_in', 'payment_out', 'tax', 'salary', 'bank_fee', 'acquiring', 'transfer', 'loan', 'other_in', 'other_out'] as const;
export type BankOperation = (typeof BANK_OPERATIONS)[number];

export const BANK_RULE_KINDS = ['purpose_contains', 'inn_equals', 'counterparty_equals', 'amount_sign'] as const;
export type BankRuleKind = (typeof BANK_RULE_KINDS)[number];

/**
 * The payload a bank record carries. Same as accounting.BankTransaction, except that a line the
 * parser could not decide keeps `date` / `amount` / `direction` null (status unresolved, never
 * guessed) — proposed to Agent 1 in docs/accounting-2026-10-23/handoff-agent2.md — plus the source
 * cells and the AI's operation suggestion.
 */
export const BankRecordPayload = BankTransaction.extend({
  date: IsoDate.nullable(),
  amount: DecimalString.nullable(),
  direction: z.enum(['debit', 'credit']).nullable(),
  /** The source row's cells, as read. */
  raw: z.array(z.string()).max(60).optional(),
  /** A suggested operation for a line no rule decided (basis `ai`); never applied without a decision. */
  operationSuggestion: MatchCandidate.nullable().optional(),
});
export type BankRecordPayload = z.infer<typeof BankRecordPayload>;

// ── Rows the screens show ──────────────────────────────────────────────────────────────────

export const BankFormatSummary = z.object({
  /** Built-in id (`generic_ru_debit_credit`, …) or `org:<bank_format.id>`. */
  id: z.string(),
  name: z.string(),
  bankName: z.string().nullable(),
  builtIn: z.boolean(),
  /** False until a real statement of that layout was read and its balance reconciled. */
  verified: z.boolean(),
  usedCount: z.number().int(),
  createdAt: IsoDateTime.nullable(),
});

export const DroppedRow = z.object({ rowIndex: z.number().int(), reason: z.string(), text: z.string() });

/** What the preview step shows before anything is stored. */
export const BankPreview = z.object({
  filename: z.string(),
  headers: z.array(z.string()),
  /** First data rows as read (after the header). */
  rows: z.array(z.array(z.string())),
  /** 1-based sheet row of the header. */
  headerRow: z.number().int(),
  /** Lines above the header (bank, account, period), as read. */
  titleLines: z.array(z.string()),
  /** The recognised layout, or null: then the user maps the columns. */
  format: BankFormatSummary.nullable(),
  /** The recognised layout's mapping, or the best guess from the header words. */
  columnMap: BankColumnMap,
  conventions: BankConventions,
  /** Whether the mapping came from a recognised layout (true) or the header guess (false). */
  recognised: z.boolean(),
  /** Rows that would be left out, with the reason code (bankX.dropReasons). */
  dropped: z.array(DroppedRow),
  dataRows: z.number().int(),
  totalRows: z.number().int(),
  truncated: z.boolean(),
  /** The same file was read before: that statement; batchId and createdAt are null when it belongs to a client this user cannot open. */
  duplicateOf: z.object({ batchId: z.string().nullable(), filename: z.string().nullable(), createdAt: IsoDateTime.nullable() }).nullable(),
  header: z.object({
    account: BankAccount.nullable(),
    currency: Currency.nullable(),
    periodFrom: IsoDate.nullable(),
    periodTo: IsoDate.nullable(),
    openingBalance: DecimalString.nullable(),
    closingBalance: DecimalString.nullable(),
    bankName: z.string().nullable(),
  }),
});
export type BankPreview = z.infer<typeof BankPreview>;

export const BankStatementRow = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  filename: z.string().nullable(),
  status: z.enum(IMPORT_STATUSES),
  counts: BatchCounts.nullable(),
  /** Lines read so far while the statement is being processed. */
  progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  /** Records approved and not exported yet: what "Prepare for 1C" would send. */
  approved: z.number().int(),
  error: z.string().nullable(),
  formatId: z.string().nullable(),
  formatName: z.string().nullable(),
  formatVerified: z.boolean(),
  bankName: z.string().nullable(),
  account: z.string().nullable(),
  currency: z.string().nullable(),
  periodFrom: z.string().nullable(),
  periodTo: z.string().nullable(),
  openingBalance: z.string().nullable(),
  closingBalance: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  exports: z.array(z.object({
    id: z.string(), format: z.enum(ONEC_FORMATS), filename: z.string().nullable(), recordCount: z.number().int(),
    createdAt: IsoDateTime, outcome: ImportOutcome.nullable(),
  })),
});
export type BankStatementRow = z.infer<typeof BankStatementRow>;

export const BankRecordRow = z.object({
  id: z.string(),
  rowIndex: z.number().int(),
  status: z.enum(RECORD_STATUSES),
  payload: BankRecordPayload,
  issues: z.array(ValidationIssue),
  decision: ReviewDecision.nullable(),
  decidedAt: IsoDateTime.nullable(),
  outcome: RecordOutcome.nullable(),
});
export type BankRecordRow = z.infer<typeof BankRecordRow>;

export const BankRuleRow = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  kind: z.enum(BANK_RULE_KINDS),
  value: z.string(),
  operation: z.enum(BANK_OPERATIONS),
  cashFlowItem: z.string().nullable(),
  priority: z.number().int(),
  hits: z.number().int(),
  createdAt: IsoDateTime,
});

/** One line of the reconciliation: an amount per direction or operation. */
const Total = z.object({ key: z.string(), count: z.number().int(), debit: DecimalString, credit: DecimalString });

export const ReconcileReport = z.object({
  statement: BankStatementRow,
  openingBalance: DecimalString.nullable(),
  closingBalance: DecimalString.nullable(),
  totalDebit: DecimalString,
  totalCredit: DecimalString,
  /** opening + credits − debits over every line read (not skipped). */
  computedClosing: DecimalString.nullable(),
  /** computedClosing − closingBalance; null when the file states no balances. */
  difference: DecimalString.nullable(),
  balanced: z.boolean().nullable(),
  /** The bank's own totals row, when the file has one, against the lines read. */
  bankTotals: z.object({ debit: DecimalString.nullable(), credit: DecimalString.nullable(), debitMatches: z.boolean().nullable(), creditMatches: z.boolean().nullable() }),
  byOperation: z.array(Total),
  byStatus: z.array(Total),
  unresolved: z.array(z.object({ rowIndex: z.number().int(), codes: z.array(z.string()), text: z.string() })),
  skipped: z.array(z.object({ rowIndex: z.number().int(), note: z.string().nullable(), text: z.string() })),
  dropped: z.array(z.object({ rowIndex: z.number().int(), reason: z.string() })),
  exported: z.number().int(),
});
export type ReconcileReport = z.infer<typeof ReconcileReport>;

export const PrepareAnswer = z.object({
  ok: z.literal(true),
  /** Approved lines that are not exported yet: what the next export sends. */
  ready: z.number().int(),
  alreadyExported: z.number().int(),
  waiting: z.number().int(),
  unresolved: z.number().int(),
  checks: z.array(z.object({ code: z.string(), ok: z.boolean(), detail: z.string().optional() })),
  /** What the 1C interface answered: its issues, or why it could not prepare (`not_implemented` until Agent 1 lands). */
  onec: z.union([
    z.object({ ok: z.literal(true), records: z.number().int(), issues: z.array(ValidationIssue) }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

// ── Endpoints ──────────────────────────────────────────────────────────────────────────────
// New screens, nothing is taken over from the Next app: `replaces` names the /bank page each
// endpoint serves (the registry requires an entry; see handoff-agent2.md).

const StatementPath = z.object({ batchId: Id });
const RecordPath = z.object({ recordId: Id });
const UploadFile = { required: true, maxBytes: LIMITS.uploadBytes, extensions: ['.xlsx', '.csv'], description: 'Bank statement: Excel (.xlsx) or CSV.' } as const;
/** JSON text in a multipart field. */
const JsonText = z.string().max(20_000);

export const BankDecisionBody = z.object({
  action: z.enum(['approve', 'correct', 'skip', 'reopen']),
  /** Payload fields to change: operation, cashFlowItem, contract, counterparty.name, counterparty.inn, counterparty.account, date, amount, direction, purpose. */
  corrections: z.record(z.string().max(40), z.union([z.string().max(2000), z.null()])).optional(),
  note: z.string().max(500).optional(),
  /** Remember the corrected operation as a rule for this counterparty or this purpose text. */
  remember: z.object({ by: z.enum(['counterparty', 'purpose']), value: z.string().trim().min(2).max(200).optional() }).optional(),
});

export const bank = defineModule('bank', {
  preview: endpoint({
    method: 'POST', path: '/api/bank/preview', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Read a statement file: header, sample rows, recognised layout or a mapping guess, rows that would be left out',
    multipart: {
      fields: z.object({
        clientId: z.string().max(64).optional(),
        /** Given (BankColumnMap and BankConventions as JSON): the preview reads the file with these columns. */
        columnMap: JsonText.optional(),
        conventions: JsonText.optional(),
      }),
      files: { file: UploadFile },
    },
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), preview: BankPreview }), Fail]),
    replaces: ['page:(app)/bank'],
  }),
  create: endpoint({
    method: 'POST', path: '/api/bank/statements', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Read a statement with the chosen columns: stores the batch and processes its lines (progress in the statement\'s counts)',
    multipart: {
      fields: z.object({
        clientId: z.string().max(64).optional(),
        /** BankColumnMap as JSON. */
        columnMap: JsonText,
        /** BankConventions as JSON. */
        conventions: JsonText,
        /** Given: the mapping is saved as a layout of the org under this name. */
        formatName: z.string().max(120).optional(),
      }),
      files: { file: UploadFile },
    },
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), batchId: z.string() }), Fail.extend({ duplicateOf: z.string().optional() })]),
    replaces: ['page:(app)/bank'],
  }),
  list: endpoint({
    method: 'GET', path: '/api/bank/statements', auth: 'session', role: 'any',
    summary: 'The org\'s bank statements, newest first; ?client= narrows to one client',
    query: z.object({ client: z.string().max(64).optional() }),
    responds: 'json', response: z.object({ statements: z.array(BankStatementRow), clients: z.array(z.object({ id: z.string(), name: z.string() })), client: z.string().nullable() }),
    replaces: ['page:(app)/bank'],
  }),
  statement: endpoint({
    method: 'GET', path: '/api/bank/statements/{batchId}', auth: 'session', role: 'any',
    summary: 'One statement with its header, progress and counts',
    params: StatementPath,
    responds: 'json', response: z.object({ statement: BankStatementRow, dropped: z.array(z.object({ rowIndex: z.number().int(), reason: z.string() })) }),
    replaces: ['page:(app)/bank/[batchId]'],
  }),
  records: endpoint({
    method: 'GET', path: '/api/bank/statements/{batchId}/records', auth: 'session', role: 'any',
    summary: 'A page of the statement\'s lines for review, by status',
    params: StatementPath,
    query: z.object({
      status: z.enum([...RECORD_STATUSES, 'approved', 'open', 'all']).optional(),
      page: z.coerce.number().int().min(1).max(10_000).optional(),
      q: z.string().max(100).optional(),
    }),
    responds: 'json', response: z.object({ records: z.array(BankRecordRow), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() }),
    replaces: ['page:(app)/bank/[batchId]'],
  }),
  decide: endpoint({
    method: 'PUT', path: '/api/bank/records/{recordId}/decision', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Approve, correct, skip or reopen one line; optionally remember the operation as a rule',
    params: RecordPath,
    body: BankDecisionBody,
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), record: BankRecordRow, ruleId: z.string().nullable(), applied: z.number().int() }), Fail]),
    replaces: ['page:(app)/bank/[batchId]'],
  }),
  approve: endpoint({
    method: 'POST', path: '/api/bank/statements/{batchId}/approve', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Approve lines in bulk: every valid line, every line without an error, or the given ids',
    params: StatementPath,
    body: z.object({ scope: z.enum(['valid', 'reviewable', 'ids']), ids: z.array(Id).max(5000).optional() }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), approved: z.number().int() }), Fail]),
    replaces: ['page:(app)/bank/[batchId]'],
  }),
  prepare: endpoint({
    method: 'POST', path: '/api/bank/statements/{batchId}/prepare', auth: 'session', role: 'writer',
    summary: 'Dry run of the 1C export: what would go, the balance and duplicate checks, the 1C interface\'s own checks',
    params: StatementPath,
    responds: 'json', response: z.union([PrepareAnswer, Fail]),
    replaces: ['page:(app)/bank/[batchId]'],
  }),
  export: endpoint({
    method: 'POST', path: '/api/bank/statements/{batchId}/export', auth: 'session', role: 'writer', noDemo: true,
    summary: 'The 1C bank exchange file (bank_exchange_1_02) of the approved lines not exported yet, built by the 1C interface',
    params: StatementPath,
    responds: 'file', file: { contentTypes: ['text/plain', 'application/octet-stream'], disposition: 'attachment' },
    replaces: ['page:(app)/bank/[batchId]'],
    notes: 'Answers 409 nothing_to_export, 501 not_implemented while the 1C interface is the base-commit stub.',
  }),
  reconcile: endpoint({
    method: 'GET', path: '/api/bank/statements/{batchId}/reconcile', auth: 'session', role: 'any',
    summary: 'Reconciliation: opening balance, totals by direction and operation, closing balance check, unresolved and skipped lines',
    params: StatementPath,
    responds: 'json', response: ReconcileReport,
    replaces: ['page:(app)/bank/[batchId]/reconcile'],
  }),
  reconcileCsv: endpoint({
    method: 'GET', path: '/api/bank/statements/{batchId}/reconcile.csv', auth: 'session', role: 'any',
    summary: 'The reconciliation and every line with its status as CSV',
    params: StatementPath,
    responds: 'file', file: { contentTypes: ['text/csv'], disposition: 'attachment' },
    replaces: ['page:(app)/bank/[batchId]/reconcile'],
  }),
  remove: endpoint({
    method: 'DELETE', path: '/api/bank/statements/{batchId}', auth: 'session', role: 'writer',
    summary: 'Delete a statement none of whose lines went to 1C',
    params: StatementPath,
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['page:(app)/bank'],
  }),
  formats: endpoint({
    method: 'GET', path: '/api/bank/formats', auth: 'session', role: 'any',
    summary: 'Built-in statement layouts and the org\'s saved ones',
    responds: 'json', response: z.object({ formats: z.array(BankFormatSummary) }),
    replaces: ['page:(app)/bank'],
  }),
  removeFormat: endpoint({
    method: 'DELETE', path: '/api/bank/formats/{formatId}', auth: 'session', role: 'writer',
    summary: 'Forget a saved statement layout',
    params: z.object({ formatId: Id }),
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['page:(app)/bank'],
  }),
  rules: endpoint({
    method: 'GET', path: '/api/bank/rules', auth: 'session', role: 'any',
    summary: 'The org\'s remembered operation rules',
    responds: 'json', response: z.object({ rules: z.array(BankRuleRow) }),
    replaces: ['page:(app)/bank'],
  }),
  removeRule: endpoint({
    method: 'DELETE', path: '/api/bank/rules/{ruleId}', auth: 'session', role: 'writer',
    summary: 'Forget a remembered operation rule',
    params: z.object({ ruleId: Id }),
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['page:(app)/bank'],
  }),
});
