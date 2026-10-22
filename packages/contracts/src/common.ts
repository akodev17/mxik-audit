// Schemas and value lists several modules share. The lists copy the Prisma enums and domain
// constants so the browser can import them without @prisma/client or @tasnivo/domain;
// common.test.ts fails when either side changes alone.
import { z } from 'zod';

// ── Value lists ────────────────────────────────────────────────────────────────────────────

export const CATALOG_STATUSES = ['uploaded', 'analyzing', 'ready', 'failed'] as const;
export const DECISIONS = ['pending', 'accepted', 'rejected'] as const;
export const SEVERITIES = ['high', 'medium', 'info'] as const;
/** Prisma FindingType, in schema order. The public API adds "OTHER" for kinds a newer server writes. */
export const FINDING_TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY', 'RESTRICTED'] as const;
export const DECISION_SOURCES = ['manual', 'group', 'bulk', 'bulk_sure', 'dictionary', 'dictionary_auto', 'carry_over'] as const;
export const ROLES = ['admin', 'accountant', 'viewer'] as const;
export const LOCALES = ['uz', 'ru'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;
export const MATCH_STAGES = ['barcode', 'exact', 'lexical', 'vector', 'fusion', 'rerank', 'dictionary', 'none'] as const;
export const CODE_STATES = ['unknown', 'ok', 'archived'] as const;
export const FLAGS = ['ask_client', 'resolved'] as const;
export const WRONG_REASONS = ['other_category', 'service_goods', 'finished_raw', 'unit', 'other'] as const;
export const CLIENT_ACTIVITIES = ['savdo', 'ishlab_chiqarish', 'boshqa'] as const;
export const DOC_KINDS = ['cheques', 'sales'] as const;
export const DECISION_FILTERS = ['pending', 'all', 'accepted', 'rejected', 'carried', 'auto'] as const;
export const FLAG_FILTERS = ['any', 'ask_client', 'resolved', 'none'] as const;
export const OPTIONAL_COLUMNS = ['status', 'current', 'suggested', 'match'] as const;
export const COLUMN_FIELDS = ['name', 'barcode', 'mxik', 'unit', 'price', 'sales'] as const;
export const PLAN_RESOURCES = ['clients', 'rowsPerMonth', 'seats'] as const;
export const PAYMENT_PROVIDERS = ['click', 'payme'] as const;
export const RETENTION_CHOICES = [7, 30, 90] as const;

/** Upload caps of the old actions (catalog-import.ts MAX_UPLOAD_BYTES, lead.ts, settings.ts). */
export const LIMITS = {
  uploadBytes: 20 * 1024 * 1024,
  leadBytes: 5 * 1024 * 1024,
  logoBytes: 300 * 1024,
  uploadExtensions: ['.xlsx', '.xls', '.csv'],
  leadExtensions: ['.xlsx', '.csv'],
  logoExtensions: ['.png', '.jpg', '.jpeg'],
} as const;

// ── Scalars ────────────────────────────────────────────────────────────────────────────────

export const Id = z.string().min(1);
/** Ids the old actions capped at 64 characters. */
export const ShortId = z.string().min(1).max(64);
/** Dates travel as ISO 8601 strings (Date.toISOString()); server actions sent Date objects. */
export const IsoDateTime = z.string().datetime({ offset: true });
export const Mxik = z.string().regex(/^\d{17}$/);

// ── Outcomes ───────────────────────────────────────────────────────────────────────────────

/** `{ ok: false, error }`: the error is a sentence in the user's language, as the actions returned it. */
export const Fail = z.object({ ok: z.literal(false), error: z.string() });
export const Ok = z.object({ ok: z.literal(true) });
export const OkOrFail = z.union([Ok, Fail]);
/** `{ ok: boolean }` answers that carry no reason. */
export const OkFlag = z.object({ ok: z.boolean() });

/**
 * What a server action did with `redirect()`: the API answers with the target and the browser
 * navigates. Part of the union of every action that redirected on success.
 */
export const Redirect = z.object({ redirect: z.string() });

/** Shell actions' typed refusals (actions/shell.ts ShellFail). */
export const ShellFail = z.object({ ok: z.literal(false), error: z.enum(['auth', 'invalid', 'not_found', 'failed']) });

export const Skipped = z.object({ archived: z.number().int(), conflict: z.number().int(), noCode: z.number().int(), confirmOnly: z.number().int() });

/** Decisions on many rows at once (group, bulk, sure band, dictionary button): one undoable event. */
export const ManyOutcome = z.union([
  z.object({ ok: z.literal(true), count: z.number().int(), eventId: z.string().nullable(), ids: z.array(z.string()), skipped: Skipped }),
  Fail,
]);

/**
 * The error envelope of every non-2xx answer: the public API's (api/contract.ts ErrorBody), and
 * the first-party API's (W1a), so one ApiError type covers both.
 */
export const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

// ── Shared domain inputs (copies of the domain zod schemas; common.test.ts compares) ───────

/** Which uploaded column feeds which field; -1 = not mapped (domain column-map.ts). */
export const ColumnMap = z.object({
  name: z.number().int().min(0),
  barcode: z.number().int().min(-1),
  mxik: z.number().int().min(-1),
  unit: z.number().int().min(-1),
  price: z.number().int().min(-1),
  sales: z.number().int().min(-1).default(-1),
});

/** The workspace filter as URL-shaped strings, re-read by the server (domain workspace-filter.ts FilterInput). */
export const FilterInput = z.object({
  type: z.string().max(40).nullish(),
  q: z.string().max(100).nullish(),
  dec: z.string().max(20).nullish(),
  flag: z.string().max(20).nullish(),
  comments: z.string().max(2).nullish(),
  sort: z.string().max(10).nullish(),
  source: z.string().max(20).nullish(),
});

/** A saved workspace view (domain view-params.ts). */
export const ViewParams = z.object({
  type: z.string().max(40).nullable(),
  q: z.string().max(100),
  pending: z.boolean(),
  comments: z.boolean(),
  sort: z.enum(['risk', 'row']),
  density: z.enum(['comfortable', 'compact']),
  grouped: z.boolean(),
  decision: z.enum(DECISION_FILTERS).optional(),
  flag: z.enum(FLAG_FILTERS).optional(),
  hidden: z.array(z.enum(OPTIONAL_COLUMNS)).max(OPTIONAL_COLUMNS.length).optional(),
  source: z.enum(DECISION_SOURCES).optional(),
});

/** Purchase list columns (domain purchases.ts PurchaseMapSchema). */
export const PurchaseMap = z.object({ name: z.number().int().min(-1), mxik: z.number().int().min(0), unit: z.number().int().min(-1) });

/** Cheque / sales list columns (domain docs.ts DocMapSchema). */
export const DocMap = z.object({
  name: z.number().int().min(-1),
  mxik: z.number().int().min(0),
  unit: z.number().int().min(-1),
  quantity: z.number().int().min(-1),
  amount: z.number().int().min(-1),
  date: z.number().int().min(-1),
});

/** A client as pickers and switchers show it. */
export const ClientRef = z.object({ id: z.string(), name: z.string() });

/** A query-string flag: "1"/"true" or "0"/"false". */
export const QueryFlag = z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true');

/** A page number in the query string, from 0. */
export const QueryPage = z.coerce.number().int().min(0).default(0);
