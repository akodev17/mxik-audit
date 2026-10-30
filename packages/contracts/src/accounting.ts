// Shared data contract of the accounting workflows (programme of 23 Oct 2026,
// docs/TASNIVO_AI_PLAN_2026-10-23.md §4): the normalised records that flow from a bank statement,
// a Didox invoice or a product catalogue through review into 1C. The three producing workstreams
// (bank, Didox, products) write these shapes into import_record.payload; the 1C workstream reads
// them and never sees a bank-, Didox- or catalogue-specific shape. Owner: Agent 1 (1C). Changes
// are additive (new optional fields); a producing workstream that needs a field proposes it here.
//
// Pure zod: the browser imports this file too (review screens render the same records).
import { z } from 'zod';

// ── Scalars ────────────────────────────────────────────────────────────────────────────────

/** Calendar date as `YYYY-MM-DD` (Asia/Tashkent; statements and invoices carry no time). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * Money and quantities travel as decimal strings (`"1234567.89"`, no thousands separators, `.`
 * as the decimal mark, at most 6 fraction digits) so nothing is rounded between parse and 1C.
 */
export const DecimalString = z.string().regex(/^-?\d+(\.\d{1,6})?$/);
/** ISO 4217; Uzbek statements are UZS unless the file says otherwise. */
export const Currency = z.string().regex(/^[A-Z]{3}$/);
/** 9-digit ИНН (legal entity) or 14-digit ПИНФЛ (individual). */
export const Inn = z.string().regex(/^(\d{9}|\d{14})$/);
/** 20-digit Uzbek settlement account. */
export const BankAccount = z.string().regex(/^\d{20}$/);
/** 5-digit МФО (bank branch code). */
export const Mfo = z.string().regex(/^\d{5}$/);
/** 17-digit MXIK / ИКПУ. */
export const MxikCode = z.string().regex(/^\d{17}$/);

// ── Value lists (copies of the Prisma enums; accounting.test.ts compares) ─────────────────

export const IMPORT_KINDS = ['bank_statement', 'didox_invoice', 'product_catalog'] as const;
export const IMPORT_STATUSES = ['uploaded', 'parsed', 'review', 'approved', 'exported', 'failed'] as const;
export const RECORD_STATUSES = ['valid', 'corrected', 'suspicious', 'unresolved', 'skipped', 'exported'] as const;
export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const;
/** How a match was made, strongest first. `ai` is a suggestion, never a match on its own. */
export const MATCH_BASES = ['onec_ref', 'inn', 'account', 'barcode', 'mxik', 'name_exact', 'name_normalized', 'alias', 'confirmed_mapping', 'ai', 'name_similar'] as const;
/** What 1C import a batch can be turned into. */
export const ONEC_FORMATS = ['bank_exchange_1_02', 'nomenclature_xlsx', 'receipt_xlsx', 'counterparties_xlsx', 'odata', 'http'] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export type OneCFormat = (typeof ONEC_FORMATS)[number];

/**
 * Which formats a batch of each kind can become, the primary one first. Only the primary format
 * (and a direct `odata` transfer) marks records exported and moves the batch to `exported`; the
 * others are side files (the products of an invoice, the counterparties of a statement).
 */
export const ONEC_FORMATS_BY_KIND = {
  bank_statement: ['bank_exchange_1_02', 'counterparties_xlsx'],
  didox_invoice: ['receipt_xlsx', 'nomenclature_xlsx', 'counterparties_xlsx'],
  product_catalog: ['nomenclature_xlsx'],
} as const satisfies Record<ImportKind, readonly OneCFormat[]>;
export const PRIMARY_FORMAT = {
  bank_statement: 'bank_exchange_1_02', didox_invoice: 'receipt_xlsx', product_catalog: 'nomenclature_xlsx',
} as const satisfies Record<ImportKind, OneCFormat>;
/** Direct connection kinds (OneCConnection.kind); `none` = files only. */
export const ONEC_CONNECTION_KINDS = ['none', 'odata', 'http'] as const;
/** OneCConnection.bankKeys: the Russian standard keys only, or also ПлательщикМФО / ПолучательМФО. */
export const ONEC_BANK_KEYS = ['standard', 'uz_mfo'] as const;
/**
 * The generic issue codes the 1C layer emits (prepareExport, decisions); each has a label in
 * `ta.accountingX.issues`. Producing workstreams add their own codes in their i18n parts.
 */
export const ONEC_ISSUE_CODES = [
  'duplicate_row', 'duplicate_export', 'amount_invalid', 'date_invalid', 'account_invalid', 'inn_invalid', 'counterparty_unknown',
  'counterparty_ambiguous', 'balance_mismatch', 'totals_mismatch', 'unresolved', 'payload_invalid', 'name_missing',
] as const;

// ── Validation and matching ────────────────────────────────────────────────────────────────

/**
 * One problem with a record. `code` is a stable machine key (`amount_missing`, `inn_invalid`,
 * `counterparty_unknown`, `mxik_inactive`, `unit_conflict`, `duplicate_row`, ...); the UI words it
 * through i18n (`ta.accountingX.issues[code]`) with `params`. An `error` keeps the record
 * unresolved until corrected or skipped; a `warning` marks it suspicious but exportable after review.
 */
export const ValidationIssue = z.object({
  code: z.string().min(1).max(60),
  severity: z.enum(ISSUE_SEVERITIES),
  /** The payload field the issue is about, dot path (`counterparty.inn`, `lines.3.mxik`). */
  field: z.string().max(80).optional(),
  params: z.record(z.union([z.string(), z.number()])).optional(),
  /** A value the reviewer may accept with one click (the suggested MXIK, the matched counterparty id). */
  suggestion: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** A candidate the matcher considered. */
export const MatchCandidate = z.object({
  id: z.string(),
  label: z.string(),
  /** 0..1, from the stage that produced it. */
  confidence: z.number().min(0).max(1),
  basis: z.enum(MATCH_BASES),
  /** One sentence for the reviewer, in the request's language. */
  reason: z.string().optional(),
});
export type MatchCandidate = z.infer<typeof MatchCandidate>;

/**
 * The outcome of matching one record against known data (counterparties, products): `matched`
 * when one candidate is certain, `ambiguous` when several are plausible, `new` when nothing fits
 * and a record would be created, `unknown` when the matcher could not run (no data to match against).
 */
export const MatchResult = z.object({
  status: z.enum(['matched', 'ambiguous', 'new', 'unknown']),
  /** The chosen candidate (`matched`), or the reviewer's choice once decided. */
  chosen: MatchCandidate.nullable(),
  candidates: z.array(MatchCandidate).max(10),
});
export type MatchResult = z.infer<typeof MatchResult>;

// ── Counterparties ─────────────────────────────────────────────────────────────────────────

/** A party to a payment or an invoice as the source names it, plus its match in the org's records. */
export const CounterpartyRef = z.object({
  name: z.string().max(300),
  inn: Inn.nullable(),
  account: BankAccount.nullable(),
  mfo: Mfo.nullable(),
  /** counterparty.id once matched or created. */
  counterpartyId: z.string().nullable(),
  match: MatchResult.optional(),
});
export type CounterpartyRef = z.infer<typeof CounterpartyRef>;

// ── Bank transactions (Agent 2 produces, Agent 1 exports as 1CClientBankExchange) ──────────

/**
 * One statement line, from the org's point of view: `debit` = money left the org's account,
 * `credit` = money arrived. Exactly one of the two amounts is set on a line; a turnover report
 * that lists both columns yields one record per non-zero amount.
 */
export const BankTransaction = z.object({
  /** Null only on an unresolved line the parser could not read (with an error issue); never guessed. */
  date: IsoDate.nullable(),
  /** Payment document number as the bank prints it. */
  docNumber: z.string().max(40).nullable(),
  /** Null only on an unresolved line, like `date`. */
  direction: z.enum(['debit', 'credit']).nullable(),
  /** Null only on an unresolved line, like `date`. */
  amount: DecimalString.nullable(),
  currency: Currency,
  /** The org's own account the statement is for. */
  ourAccount: BankAccount.nullable(),
  counterparty: CounterpartyRef,
  /** Назначение платежа, as written. */
  purpose: z.string().max(2000),
  /** The bank's own transaction id or reference, when the file has one. */
  reference: z.string().max(80).nullable(),
  /** Value date / posting date when both exist and differ. */
  valueDate: IsoDate.nullable(),
  /** The 5-digit CBU payment-purpose code, from its own column or the start of the purpose (bank research §7.38); absent on older lines. */
  purposeCode: z.string().regex(/^\d{5}$/).nullable().optional(),
  /** The 1C bank operation the reviewer or a rule chose (`payment_in`, `payment_out`, `tax`, `salary`, `bank_fee`, `transfer`, ...). */
  operation: z.string().max(40).nullable(),
  /** The expense/income article or ДДС item, when a rule or the reviewer set one. */
  cashFlowItem: z.string().max(120).nullable(),
  /** Contract reference for the counterparty, when known. */
  contract: z.string().max(120).nullable(),
  /** How `operation` / `counterparty` were decided: `rule:<id>`, `mapping`, `ai`, `manual`; null = not yet. */
  decidedBy: z.string().max(60).nullable(),
  /** The source row's cells as read (shown in the correction form). */
  raw: z.array(z.string()).max(60).optional(),
  /** A suggested operation (basis `ai`) for a line no rule decided; never applied without a decision. */
  operationSuggestion: MatchCandidate.nullable().optional(),
});
export type BankTransaction = z.infer<typeof BankTransaction>;

/** The statement header a bank batch keeps in import_batch.meta. */
export const BankStatementMeta = z.object({
  /** Detected or chosen format id (`kapitalbank_xlsx`, `generic_mapped`, ...). */
  formatId: z.string().max(60),
  bankName: z.string().max(120).nullable(),
  account: BankAccount.nullable(),
  currency: Currency,
  periodFrom: IsoDate.nullable(),
  periodTo: IsoDate.nullable(),
  openingBalance: DecimalString.nullable(),
  closingBalance: DecimalString.nullable(),
  totalDebit: DecimalString.nullable(),
  totalCredit: DecimalString.nullable(),
  /** Header names of the source sheet, in order. */
  headers: z.array(z.string()),
  /** Source column index per field; -1 = not in the file. */
  columnMap: z.record(z.number().int()),
  /** Rows the parser dropped (totals, repeated headers, blanks) with the reason. */
  dropped: z.array(z.object({ rowIndex: z.number().int(), reason: z.string() })).max(200),
  /**
   * The statement owner as the file prints it (added by Agent 1): the 1C bank file writes it as the
   * payer of outgoing and the payee of incoming payments. Absent = the client's (or org's) name only.
   */
  ownerName: z.string().max(300).nullable().optional(),
  ownerInn: Inn.nullable().optional(),
  /** МФО of the bank that holds `account`. */
  mfo: Mfo.nullable().optional(),
  /** The bank workstream's own header (format name, verified flag, title lines, the bank's totals row, progress). */
  bank: z.record(z.string(), z.unknown()).optional(),
});
export type BankStatementMeta = z.infer<typeof BankStatementMeta>;

// ── Products and invoices (Agents 3 and 4 produce, Agent 1 exports) ───────────────────────

/** A product as the org's 1C catalogue (or Tasnivo's own product table) knows it. */
export const ProductRecord = z.object({
  /** product.id in Tasnivo once known; null for a line that would create one. */
  productId: z.string().nullable(),
  name: z.string().max(500),
  /** The 1C catalogue code or GUID when it came from a 1C export. */
  onecRef: z.string().max(80).nullable(),
  mxik: MxikCode.nullable(),
  mxikName: z.string().max(500).nullable(),
  /** Tasnif packaging code and its name (`Qadoq kodi`), when assigned. */
  packageCode: z.string().max(40).nullable(),
  packageName: z.string().max(200).nullable(),
  unit: z.string().max(60).nullable(),
  barcode: z.string().max(40).nullable(),
  /** Other names the same product has been seen under. */
  aliases: z.array(z.string().max(500)).max(50),
  /** MXIK classification state from the intelligence module. */
  mxikStatus: z.enum(['ok', 'missing', 'invalid', 'inactive', 'restricted', 'suspicious', 'unchecked']),
  /** Suggested code when `mxik` is missing or doubtful; never applied without a decision. */
  mxikSuggestion: MatchCandidate.nullable(),
  /** Whether the row is marked for digital marking (classifier label). */
  markingRequired: z.boolean().nullable(),
  /** 1C «Артикул», when the source has one (written to nomenclature_xlsx). */
  article: z.string().max(100).nullable().optional(),
  /** The source's price rounded to tiyin (2 decimals), when it has one (1C «Цена»). */
  price: DecimalString.nullable().optional(),
  /** Whether that price includes VAT: the column said "с НДС" (true) / "без НДС" (false); null = not said. */
  priceIncludesVat: z.boolean().nullable().optional(),
  /** VAT rate as the source states it: "12", "0", "15", or "without" (Без НДС); null = not stated (1C «Ставка НДС»). */
  vatRate: z.string().max(10).nullable().optional(),
  /** A catalogue import record's match against the org's existing products. */
  match: MatchResult.optional(),
  /** Runner-up MXIK codes the classifier considered. */
  alternatives: z.array(MatchCandidate).max(10).optional(),
});
export type ProductRecord = z.infer<typeof ProductRecord>;

/** One line of an incoming invoice, with its match against the product catalogue. */
export const InvoiceLine = z.object({
  lineNo: z.number().int().min(1),
  name: z.string().max(500),
  mxik: MxikCode.nullable(),
  mxikName: z.string().max(500).nullable(),
  packageCode: z.string().max(40).nullable(),
  packageName: z.string().max(200).nullable(),
  /** Didox measure id and its name, when the source carries them. */
  measureId: z.string().max(20).nullable(),
  unit: z.string().max(60).nullable(),
  barcode: z.string().max(40).nullable(),
  quantity: DecimalString,
  price: DecimalString,
  /** Line amount without VAT. */
  amount: DecimalString,
  /** VAT rate in percent (`"12"`), null = without VAT / not stated. */
  vatRate: DecimalString.nullable(),
  vatAmount: DecimalString.nullable(),
  /** Line total with VAT. */
  total: DecimalString.nullable(),
  /** Marking codes (ИКПУ marking), when the line carries them. */
  markingCodes: z.array(z.string().max(120)).max(1000).optional(),
  /** Match against the org's products: matched / ambiguous / new. */
  product: MatchResult,
  /** The product record the line resolves to (existing or to be created) once decided. */
  resolved: ProductRecord.nullable(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

/** The invoice header a Didox batch keeps in import_batch.meta; the lines are its records. */
export const IncomingInvoiceMeta = z.object({
  /** 'didox_api' | 'didox_zip' | 'didox_json' | 'xlsx'. */
  source: z.string().max(20),
  /** Didox document id. */
  externalId: z.string().max(80).nullable(),
  number: z.string().max(60),
  date: IsoDate,
  contractNumber: z.string().max(60).nullable(),
  contractDate: IsoDate.nullable(),
  seller: CounterpartyRef,
  buyer: CounterpartyRef,
  currency: Currency,
  totalAmount: DecimalString,
  totalVat: DecimalString.nullable(),
  totalWithVat: DecimalString,
  /** Didox status as read (`signed`, `sent`, ...); null for file uploads. */
  didoxStatus: z.string().max(40).nullable(),
  /** Whether the source document was signed by both parties when read. */
  signed: z.boolean().nullable(),
  /** Problems of the document itself, not of a line (seller_unknown, seller_tin_invalid, ...). */
  issues: z.array(ValidationIssue).max(50).optional(),
});
export type IncomingInvoiceMeta = z.infer<typeof IncomingInvoiceMeta>;

/** The catalogue header a product batch keeps in import_batch.meta. */
export const ProductCatalogMeta = z.object({
  /** 'xlsx' | 'csv' | 'onec_export'. */
  source: z.string().max(20),
  headers: z.array(z.string()),
  columnMap: z.record(z.number().int()),
  /** The Tasnivo audit catalogue this batch was built from, when it came through the MXIK audit. */
  catalogId: z.string().nullable(),
  /** Progress of a chunked check while the import runs. */
  progress: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
  /** The language the catalogue's names are in, when detected. */
  locale: z.string().max(10).optional(),
  /** How many source rows the parser dropped (no name, blank). */
  dropped: z.number().int().optional(),
});
export type ProductCatalogMeta = z.infer<typeof ProductCatalogMeta>;

// ── Review and outcomes ────────────────────────────────────────────────────────────────────

/** What a reviewer did with a record. Field corrections are dot paths into the payload. */
export const ReviewDecision = z.object({
  action: z.enum(['approve', 'correct', 'skip', 'reopen']),
  corrections: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  note: z.string().max(500).optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

/** What happened to one record in a 1C export or transfer. */
export const RecordOutcome = z.object({
  exportId: z.string(),
  result: z.enum(['imported', 'skipped', 'rejected']),
  /** Machine reason (`duplicate`, `unresolved`, `onec_refused`, ...) plus the 1C message, if any. */
  reason: z.string().max(60).nullable(),
  message: z.string().max(1000).nullable(),
  /** The 1C document or catalogue reference created, when the transfer reports one. */
  onecRef: z.string().max(120).nullable(),
});
export type RecordOutcome = z.infer<typeof RecordOutcome>;

/** The summary of one export, kept in onec_export.outcome. */
export const ImportOutcome = z.object({
  format: z.enum(ONEC_FORMATS),
  imported: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  /** Per reason, how many. */
  reasons: z.record(z.number().int()),
  /** Checks the exporter ran (balance reconciles, totals match, no duplicates) and their verdicts. */
  checks: z.array(z.object({ code: z.string(), ok: z.boolean(), detail: z.string().optional() })),
});
export type ImportOutcome = z.infer<typeof ImportOutcome>;

/** Counts kept in import_batch.counts. */
export const BatchCounts = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  corrected: z.number().int(),
  suspicious: z.number().int(),
  unresolved: z.number().int(),
  skipped: z.number().int(),
  exported: z.number().int(),
  /** Valid or corrected with a reviewer's decision, not exported yet (refreshCounts computes it). */
  approved: z.number().int().optional(),
  /** Processing progress a producing workstream keeps while it reads a batch (refreshCounts keeps it). */
  progress: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
});
export type BatchCounts = z.infer<typeof BatchCounts>;

/** A batch as every list and detail page shows it. */
export const ImportBatchRow = z.object({
  id: z.string(),
  kind: z.enum(IMPORT_KINDS),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  source: z.string(),
  filename: z.string().nullable(),
  externalRef: z.string().nullable(),
  status: z.enum(IMPORT_STATUSES),
  counts: BatchCounts.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** Exports made from this batch, newest first. */
  exports: z.array(z.object({
    id: z.string(), format: z.enum(ONEC_FORMATS), filename: z.string().nullable(), recordCount: z.number().int(),
    createdAt: z.string().datetime({ offset: true }), outcome: ImportOutcome.nullable(),
  })),
});
export type ImportBatchRow = z.infer<typeof ImportBatchRow>;

/** A record as the review grid shows it; `payload` is one of the three record schemas by batch kind. */
export const ImportRecordRow = z.object({
  id: z.string(),
  rowIndex: z.number().int(),
  status: z.enum(RECORD_STATUSES),
  payload: z.union([BankTransaction, InvoiceLine, ProductRecord]),
  issues: z.array(ValidationIssue),
  decision: ReviewDecision.nullable(),
  decidedAt: z.string().datetime({ offset: true }).nullable(),
  outcome: RecordOutcome.nullable(),
});
export type ImportRecordRow = z.infer<typeof ImportRecordRow>;

/** Which payload schema a kind uses. */
export const RECORD_SCHEMAS = {
  bank_statement: BankTransaction,
  didox_invoice: InvoiceLine,
  product_catalog: ProductRecord,
} as const satisfies Record<ImportKind, z.ZodTypeAny>;
