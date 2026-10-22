// The review workspace: grid rows, row detail, decisions (one, group, sure band, bulk), undo,
// comments and flags, saved views, code lookup, new-code requests, wrong-suggestion feedback,
// and the cross-catalogue queue and dashboard.
import { z } from 'zod';
import {
  CODE_STATES, DECISION_SOURCES, DECISIONS, Fail, FilterInput, FLAGS, Id, IsoDateTime, ManyOutcome, MATCH_STAGES, Mxik,
  ROLES, ShortId, Skipped, ViewParams, WRONG_REASONS,
} from '../common';
import { defineModule, endpoint } from '../endpoint';
import { ActivityRow } from './account';
import { ClientStats } from './clients';
import { ReminderTask } from './reminders';

const CatalogPath = z.object({ catalogId: Id });
const FindingPath = z.object({ findingId: Id });
const Stage = z.enum(MATCH_STAGES).nullable();
const Mode = z.enum(['suggest', 'pick', 'confirm']);
const Source = z.enum(DECISION_SOURCES).nullable();

/** workspace-rows.ts GridRow. */
export const GridRow = z.object({
  findingId: z.string(),
  rowIndex: z.number().int(),
  productName: z.string(),
  unit: z.string().nullable(),
  type: z.string(),
  severity: z.string(),
  currentMxik: z.string().nullable(),
  currentName: z.string().nullable(),
  currentState: z.enum(CODE_STATES).nullable(),
  suggestedMxik: z.string().nullable(),
  suggestedName: z.string().nullable(),
  confidence: z.number().nullable(),
  stage: Stage,
  barcode: z.boolean(),
  dictionary: z.boolean(),
  noSuggestion: z.boolean(),
  mode: Mode,
  marking: z.boolean(),
  flag: z.string().nullable(),
  comments: z.number().int(),
  decision: z.enum(DECISIONS),
  decisionSource: Source,
  chosenMxik: z.string().nullable(),
  chosenName: z.string().nullable(),
  decisionEventId: z.string().nullable(),
  groupKey: z.string().nullable(),
});

const CodeView = z.object({
  code: z.string(),
  name: z.string(),
  state: z.enum(CODE_STATES),
  blocks: z.array(z.object({ digits: z.string(), name: z.string().nullable(), missing: z.boolean() })),
});

/** row-detail.ts RowDetail. */
export const RowDetail = z.object({
  findingId: z.string(),
  productName: z.string(),
  unit: z.string().nullable(),
  barcode: z.string().nullable(),
  type: z.string(),
  severity: z.string(),
  reason: z.string(),
  facts: z.object({
    code: z.string().nullable(),
    retired: z.boolean(),
    afterUpdate: z.boolean(),
    rowUnit: z.string().nullable(),
    requiredUnits: z.array(z.string()),
    purchasedOtherUnit: z.boolean(),
    privilegeMismatch: z.boolean(),
    restriction: z.object({ code: z.string(), date: z.string(), inForce: z.boolean() }).nullable(),
  }),
  confidence: z.number().nullable(),
  stage: Stage,
  current: CodeView.nullable(),
  suggested: CodeView.nullable(),
  chosen: CodeView.nullable(),
  opportunity: CodeView.nullable(),
  signals: z.array(z.object({ label: z.string(), text: z.string(), tone: z.enum(['good', 'warn', 'bad', 'neutral']), note: z.string().optional(), source: z.literal('ai').optional() })),
  alternatives: z.array(z.object({ code: z.string(), name: z.string(), path: z.string(), confidence: z.number() })),
  markingCurrent: z.boolean(),
  markingSuggested: z.boolean(),
  privileges: z.array(z.string()),
  noSuggestion: z.boolean(),
  mode: Mode,
  nameOffer: z.object({ name: z.string(), code: z.string() }).nullable(),
  advice: z.object({
    unit: z.object({ suggested: z.string(), current: z.string() }).nullable(),
    packaging: z.object({ values: z.array(z.string()), codeContainer: z.string().nullable() }).nullable(),
  }),
  decision: z.enum(DECISIONS),
  decisionEventId: z.string().nullable(),
  decisionSource: Source,
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
});

/** decisions.ts DecideFailure, with the error text the action added. */
export const DecideResult = z.union([
  z.object({ ok: z.literal(true), eventId: z.string() }),
  z.object({ ok: z.literal(false), code: z.enum(['forbidden', 'not_found', 'not_in_classifier', 'no_code', 'failed']), error: z.string() }),
  z.object({
    ok: z.literal(false), code: z.literal('already_decided'), error: z.string(),
    decision: z.enum(DECISIONS), chosenMxik: z.string().nullable(), decidedBy: z.string().nullable(), decidedAt: z.string().nullable(),
    decisionSource: z.string().nullable(), decisionEventId: z.string().nullable(),
  }),
  z.object({ ok: z.literal(false), code: z.literal('sibling_conflict'), error: z.string(), sibling: z.object({ findingId: z.string(), type: z.string(), chosenMxik: z.string() }) }),
]);

/** actions/bulk.ts Target and Action. */
export const BulkTarget = z.union([z.object({ ids: z.array(Id).min(1).max(20_000) }), z.object({ filter: FilterInput })]);
export const BulkAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accept') }),
  z.object({ kind: z.literal('reject') }),
  z.object({ kind: z.literal('assign'), code: Mxik }),
  z.object({ kind: z.literal('flag'), flag: z.enum(FLAGS).nullable() }),
]);
const BulkInput = z.object({ target: BulkTarget, action: BulkAction });

/** The sure-band minimum: core/match/score.ts BANDS.high (the action refused anything lower). */
export const SURE_BAND_MIN = 0.9;

export const CommentView = z.object({ id: z.string(), author: z.string().nullable(), body: z.string(), at: z.string() });

export const ViewRow = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), params: ViewParams });
const ViewsResult = z.object({ ok: z.boolean(), views: z.array(ViewRow) });

export const ClassifierHit = z.object({ code: z.string(), name: z.string(), path: z.string(), isBase: z.boolean(), unit: z.string().nullable() });

/** queue.ts QueueRow. */
export const QueueRow = z.object({
  findingId: z.string(),
  rowIndex: z.number().int(),
  rawName: z.string(),
  unit: z.string().nullable(),
  type: z.string(),
  severity: z.enum(['high', 'medium']),
  existingMxik: z.string().nullable(),
  suggestedMxik: z.string().nullable(),
  unitFix: z.object({ current: z.string().nullable(), expected: z.string() }).nullable(),
  confidence: z.number().nullable(),
  stage: Stage,
  askClient: z.boolean(),
  comments: z.number().int(),
  catalogId: z.string(),
  catalogName: z.string(),
  auditedAt: IsoDateTime,
  clientId: z.string(),
  clientName: z.string(),
});

const AccountantOption = z.object({ id: z.string(), email: z.string(), assigned: z.number().int() });

/** review-assignments.ts OpenReview. */
export const OpenReview = z.object({
  catalogId: z.string(), clientId: z.string(), clientName: z.string(), filename: z.string(),
  assigneeId: z.string(), assigneeEmail: z.string(), dueOn: IsoDateTime.nullable(), overdue: z.boolean(), mine: z.boolean(),
});

export const workspace = defineModule('workspace', {
  rows: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/rows', auth: 'session', role: 'any',
    summary: 'The next page of grid rows for a filter (120 per page)',
    params: CatalogPath,
    query: FilterInput.extend({ cursor: z.string().max(400).default('') }),
    responds: 'json', response: z.object({ rows: z.array(GridRow), next: z.string().nullable() }).nullable(),
    replaces: ['action:workspace.ts#loadRows', 'page:(app)/catalogs/[id]#rows'],
    notes: 'The filter travels as the URL-shaped strings of FilterInput, read by readFilter on the server.',
  }),
  counts: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/counts', auth: 'session', role: 'any',
    summary: 'Rows matching a filter, and the chip counts by type',
    params: CatalogPath,
    query: FilterInput,
    responds: 'json', response: z.object({ count: z.number().int(), chips: z.object({ all: z.number().int(), byType: z.record(z.number().int()), marking: z.number().int() }) }),
    replaces: ['page:(app)/catalogs/[id]#counts'],
  }),
  rowDetail: endpoint({
    method: 'GET', path: '/api/findings/{findingId}', auth: 'session', role: 'any',
    summary: 'Everything the row drawer shows; null when the finding is not the user\'s to see',
    params: FindingPath,
    responds: 'json', response: RowDetail.nullable(),
    replaces: ['action:workspace.ts#loadRowDetail'],
  }),
  decide: endpoint({
    method: 'POST', path: '/api/findings/{findingId}/decision', auth: 'session', role: 'writer',
    summary: 'Accept or reject one finding; conflicts come back typed',
    params: FindingPath,
    body: z.object({ decision: z.enum(['accepted', 'rejected']), chosenMxik: Mxik.nullable().optional() }),
    responds: 'json', response: DecideResult,
    replaces: ['action:review.ts#decide'],
  }),
  decideGroup: endpoint({
    method: 'POST', path: '/api/decisions/group', auth: 'session', role: 'writer',
    summary: 'One accept or reject for a group of similar rows: one event, one undo',
    body: z.object({ findingIds: z.array(Id).min(1).max(5000), decision: z.enum(['accepted', 'rejected']) }),
    responds: 'json', response: ManyOutcome,
    replaces: ['action:review.ts#decideGroup'],
  }),
  split: endpoint({
    method: 'POST', path: '/api/findings/{findingId}/split', auth: 'session', role: 'writer',
    summary: 'Take a row out of its group',
    params: FindingPath,
    responds: 'json', response: z.object({ ok: z.boolean() }),
    replaces: ['action:review.ts#splitRow'],
  }),
  acceptSure: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/accept-sure', auth: 'session', role: 'writer',
    summary: 'Accept every high-match suggestion in the catalogue or the filter',
    params: CatalogPath,
    body: z.object({ minConfidence: z.number().min(SURE_BAND_MIN).max(1), filter: FilterInput.nullable().optional() }),
    responds: 'json', response: ManyOutcome,
    replaces: ['action:review.ts#acceptAllAbove'],
  }),
  previewSure: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/accept-sure/preview', auth: 'session', role: 'writer',
    summary: 'Counts for the confirmation before accepting the sure band',
    params: CatalogPath,
    body: z.object({ filter: FilterInput.nullable().optional() }),
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), total: z.number().int(), byType: z.record(z.number().int()), skipped: Skipped, willAccept: z.number().int() }),
      Fail,
    ]),
    replaces: ['action:review.ts#previewSure'],
    notes: 'Read-only; POST because a null filter (whole catalogue) differs from an empty one.',
  }),
  undo: endpoint({
    method: 'POST', path: '/api/decisions/undo', auth: 'session', role: 'writer',
    summary: 'Undo a decision event (or one row of it), the latest own decision in a catalogue, or reopen one row',
    body: z.union([
      z.object({ eventId: Id, findingId: Id.optional() }),
      z.object({ lastInCatalog: Id }),
      z.object({ reopen: Id }),
    ]),
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), findingIds: z.array(z.string()), row: z.object({ findingId: z.string(), productName: z.string(), rowIndex: z.number().int() }).nullable() }),
      Fail,
    ]),
    replaces: ['action:review.ts#undo'],
  }),
  bulkPreview: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/bulk/preview', auth: 'session', role: 'writer',
    summary: 'How many rows a bulk action would touch',
    params: CatalogPath,
    body: BulkInput,
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), willTouch: z.number().int(), matching: z.number().int(), capped: z.boolean(), limit: z.number().int(), confirmOnly: z.number().int() }),
      Fail,
    ]),
    replaces: ['action:bulk.ts#bulkDryRun'],
  }),
  bulkApply: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/bulk', auth: 'session', role: 'writer',
    summary: 'Apply accept, reject, assign or flag to the selected rows or a whole filter',
    params: CatalogPath,
    body: BulkInput,
    responds: 'json', response: ManyOutcome,
    replaces: ['action:bulk.ts#bulkAction'],
  }),
  bulkUndoFlags: endpoint({
    method: 'POST', path: '/api/bulk-events/{eventId}/undo-flags', auth: 'session', role: 'writer',
    summary: 'Put back the flags one bulk flag action replaced',
    params: z.object({ eventId: Id }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), findingIds: z.array(z.string()), flags: z.record(z.string().nullable()) }), Fail]),
    replaces: ['action:bulk.ts#undoBulkFlag'],
  }),
  comments: endpoint({
    method: 'GET', path: '/api/findings/{findingId}/comments', auth: 'session', role: 'any',
    summary: 'The comment thread of a row',
    params: FindingPath,
    responds: 'json', response: z.array(CommentView),
    replaces: ['action:comments.ts#loadComments'],
  }),
  postComment: endpoint({
    method: 'POST', path: '/api/findings/{findingId}/comments', auth: 'session', role: 'writer',
    summary: 'Add a note; answers the thread, or null',
    params: FindingPath,
    body: z.object({ body: z.string().min(1).max(2000) }),
    responds: 'json', response: z.array(CommentView).nullable(),
    replaces: ['action:comments.ts#postComment'],
  }),
  setFlag: endpoint({
    method: 'PUT', path: '/api/findings/{findingId}/flag', auth: 'session', role: 'writer',
    summary: 'Investigation flag: waiting on the client, settled, or none',
    params: FindingPath,
    body: z.object({ flag: z.enum(FLAGS).nullable() }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:comments.ts#changeFlag'],
  }),
  views: endpoint({
    method: 'GET', path: '/api/views', auth: 'session', role: 'any',
    summary: 'The user\'s saved workspace views',
    responds: 'json', response: z.array(ViewRow),
    replaces: ['action:views.ts#viewsList'],
  }),
  saveView: endpoint({
    method: 'POST', path: '/api/views', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Save a view; answers the list',
    body: z.object({ name: z.string().min(1).max(60), params: ViewParams, makeDefault: z.boolean() }),
    responds: 'json', response: ViewsResult,
    replaces: ['action:views.ts#viewsSave'],
  }),
  removeView: endpoint({
    method: 'DELETE', path: '/api/views/{viewId}', auth: 'session', role: 'writer',
    summary: 'Remove a view; answers the list',
    params: z.object({ viewId: Id }),
    responds: 'json', response: ViewsResult,
    replaces: ['action:views.ts#viewsRemove'],
  }),
  setDefaultView: endpoint({
    method: 'PUT', path: '/api/views/default', auth: 'session', role: 'writer',
    summary: 'Choose the default view (null: none); answers the list',
    body: z.object({ viewId: Id.nullable() }),
    responds: 'json', response: ViewsResult,
    replaces: ['action:views.ts#viewsDefault'],
  }),
  lookupCodes: endpoint({
    method: 'GET', path: '/api/codes/search', auth: 'session', role: 'any',
    summary: '"Pick another code": classifier search in the viewer\'s language (10 hits; under 2 characters answers [])',
    query: z.object({ q: z.string() }),
    responds: 'json', response: z.array(ClassifierHit),
    replaces: ['action:review.ts#lookupCodes'],
  }),
  newCodeRequest: endpoint({
    method: 'GET', path: '/api/findings/{findingId}/code-request', auth: 'session', role: 'any',
    summary: 'Draft text for a new-code request on tasnif.soliq.uz',
    params: FindingPath,
    responds: 'json', response: z.string().nullable(),
    replaces: ['action:review.ts#newCodeRequest'],
  }),
  wrongSuggestion: endpoint({
    method: 'POST', path: '/api/findings/{findingId}/wrong-suggestion', auth: 'session', role: 'writer',
    summary: '"Taklif notoʻgʻri": record why the suggestion is wrong',
    params: FindingPath,
    body: z.object({ reason: z.enum(WRONG_REASONS), note: z.string().max(500).optional() }),
    responds: 'json', response: z.object({ ok: z.boolean() }),
    replaces: ['action:feedback.ts#reportWrongSuggestion'],
  }),
  nameFromBarcode: endpoint({
    method: 'POST', path: '/api/findings/{findingId}/name-from-barcode', auth: 'session', role: 'writer',
    summary: 'Fill the product name from the classifier entry of its barcode',
    params: FindingPath,
    responds: 'json', response: z.boolean(),
    replaces: ['action:barcode-name.ts#fillNameFromBarcode'],
  }),
  queue: endpoint({
    method: 'GET', path: '/api/queue', auth: 'session', role: 'any',
    summary: 'Risky rows across catalogues, paged by cursor',
    query: z.object({
      client: ShortId.optional(),
      type: z.string().max(40).optional(),
      severity: z.enum(['high', 'medium']).optional(),
      flag: z.string().max(20).optional(),
      accountant: ShortId.optional(),
      due: z.enum(['overdue', 'week', 'month']).optional(),
      cursor: z.string().max(400).optional(),
    }),
    responds: 'json',
    response: z.object({
      rows: z.array(QueueRow),
      next: z.string().nullable(),
      total: z.number().int(),
      byClient: z.array(z.object({ clientId: z.string(), name: z.string(), findings: z.number().int(), rows: z.number().int() })),
      clients: z.array(z.object({ id: z.string(), name: z.string() })),
      /** Admins only. */
      accountants: z.array(AccountantOption.extend({ clientIds: z.array(z.string()) })).nullable(),
    }),
    replaces: ['page:(app)/queue'],
    provisional: 'queue/page.tsx adds the client and accountant pickers itself',
  }),
  dashboard: endpoint({
    method: 'GET', path: '/api/dashboard', auth: 'session', role: 'any',
    summary: 'The dashboard: clients and totals, changes, workload, tasks, reviews, onboarding, recent activity',
    query: z.object({ accountant: ShortId.optional() }),
    responds: 'json',
    response: z.object({
      clients: z.array(ClientStats),
      totals: z.object({
        clients: z.number().int(), riskyRows: z.number().int(), openRows: z.number().int(), pendingFindings: z.number().int(),
        updatePending: z.number().int(), attention: z.number().int(), overdueTasks: z.number().int(), noCatalog: z.number().int(),
      }),
      byType: z.array(z.object({ type: z.string(), findings: z.number().int(), rows: z.number().int() })),
      changes: z.array(z.object({ clientId: z.string(), clientName: z.string(), catalogId: z.string(), auditedAt: IsoDateTime, before: z.number().int(), after: z.number().int() })),
      accountants: z.array(AccountantOption),
      selected: AccountantOption.nullable(),
      workload: z.array(z.object({
        userId: z.string(), email: z.string(), assigned: z.number().int().nullable(), clients: z.number().int(), openRows: z.number().int(),
        pendingFindings: z.number().int(), overdueTasks: z.number().int(), lastDecisionAt: IsoDateTime.nullable(),
      })).nullable(),
      /** client-attention.ts pendingAudits(): clients with catalogues but none audited, by status. */
      pending: z.record(z.enum(['failed', 'analyzing', 'uploaded'])),
      onboarding: z.array(z.object({ key: z.enum(['client', 'invite', 'review', 'telegram', 'upload', 'twoFactor']), done: z.boolean(), href: z.string() })),
      tasks: z.array(ReminderTask),
      reviews: z.object({ open: z.array(OpenReview), counts: z.object({ open: z.number().int(), overdue: z.number().int(), mine: z.number().int() }) }),
      activity: z.array(ActivityRow),
      role: z.enum(ROLES),
    }),
    replaces: ['page:(app)/dashboard'],
    provisional: 'dashboard/page.tsx combines dashboard(), onboardingSteps, openTasks, openReviews, reviewCounts and activityPage itself; the Map of pending audits becomes a record',
  }),
});
