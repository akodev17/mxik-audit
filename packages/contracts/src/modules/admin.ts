// Platform-admin pages: traction, pipeline status, accuracy metrics and their CSV, and the
// learned lexicon (synonyms, unit aliases, global alias candidates). Anyone who is not a
// platform admin gets 404, as the pages and the CSV route did.
import { z } from 'zod';
import { Id, IsoDateTime } from '../common';
import { defineModule, endpoint } from '../endpoint';

export const ACCURACY_DIMENSIONS = ['stage', 'label', 'org', 'week'] as const;

/** accuracy.ts AccuracyRow. */
export const AccuracyRow = z.object({
  key: z.string(),
  unchanged: z.number().int(),
  replaced: z.number().int(),
  rejected: z.number().int(),
  open: z.number().int(),
  decided: z.number().int(),
  rate: z.number().nullable(),
});

const Counts = z.record(z.number().int());

/** A normalize/synonyms.ts entry as JSON (domain lexicon.ts SynonymPayload). */
export const SynonymPayload = z.object({
  forms: z.array(z.string().max(100)).min(1).max(50),
  term: z.string().min(1).max(400),
  replace: z.boolean().optional(),
  unless: z.array(z.string().max(100)).max(100).optional(),
  group: z.enum(['catering']).optional(),
  kind: z.enum(['anchor', 'contextual', 'qualifier']).optional(),
});

/** A unit alias: free text → an official unit's name (normalize/units.ts). */
export const UnitPayload = z.object({ alias: z.string().min(1).max(60), target: z.string().min(1).max(100) });

export const LexiconEntry = z.object({
  id: z.string(),
  kind: z.enum(['synonym', 'unit']),
  status: z.enum(['active', 'disabled']),
  key: z.string(),
  payload: z.union([SynonymPayload, UnitPayload]),
  note: z.string().nullable(),
  updatedAt: IsoDateTime,
});

export const AliasCandidate = z.object({
  key: z.string(),
  code: z.string(),
  codeName: z.string().nullable(),
  orgs: z.number().int(),
  confirmations: z.number().int(),
  examples: z.array(z.string()),
  status: z.enum(['candidate', 'active', 'disabled', 'rejected']),
  entryId: z.string().nullable(),
});

/** ok with the entry's id, or the problems the normaliser's check (or a duplicate key) raised. */
export const LexiconSave = z.object({ ok: z.boolean(), id: z.string().optional(), problems: z.array(z.string()).optional() });

export const admin = defineModule('admin', {
  traction: endpoint({
    method: 'GET', path: '/api/admin/traction', auth: 'session', role: 'platformAdmin',
    summary: 'Customers, catalogues, rows, decisions, review speed, demos and leads',
    responds: 'json',
    response: z.object({
      generatedAt: IsoDateTime,
      orgs: z.object({ customers: z.number().int(), newLast30Days: z.number().int() }),
      catalogs: z.object({ total: z.number().int(), last30Days: z.number().int(), byStatus: Counts }),
      rows: z.object({ audited: z.number().int(), risky: z.number().int() }),
      findingsByType: Counts,
      decisions: z.object({ accepted: z.number().int(), edited: z.number().int(), rejected: z.number().int(), pending: z.number().int(), bulkAcceptedRows: z.number().int(), undone: z.number().int() }),
      review: z.object({ medianSecondsPerRow: z.number().nullable(), sampleIntervals: z.number().int() }),
      demo: z.object({ sessions: z.number().int(), last30Days: z.number().int() }),
      leads: z.object({ total: z.number().int(), withFile: z.number().int(), last30Days: z.number().int() }),
    }),
    replaces: ['page:(app)/admin#traction'],
  }),
  pipeline: endpoint({
    method: 'GET', path: '/api/admin/pipeline', auth: 'session', role: 'platformAdmin',
    summary: 'Matching pipeline status lines (embedder, vectors, reranker, classifier), in the viewer\'s language',
    responds: 'json', response: z.array(z.object({ label: z.string(), value: z.string(), ok: z.boolean() })),
    replaces: ['page:(app)/admin#pipeline'],
  }),
  accuracy: endpoint({
    method: 'GET', path: '/api/admin/accuracy', auth: 'session', role: 'platformAdmin',
    summary: 'Suggestion accuracy by stage, label, org or week, and why suggestions were called wrong',
    query: z.object({ by: z.enum(ACCURACY_DIMENSIONS).default('stage') }),
    responds: 'json',
    response: z.object({
      rows: z.array(AccuracyRow),
      overall: AccuracyRow,
      wrongReasons: z.array(z.object({ reason: z.string(), count: z.number().int(), examples: z.array(z.object({ product: z.string(), code: z.string().nullable(), note: z.string().nullable() })) })),
    }),
    replaces: ['page:(app)/admin/metrics'],
  }),
  metricsCsv: endpoint({
    method: 'GET', path: '/api/admin/metrics', auth: 'session', role: 'platformAdmin',
    summary: 'Accuracy metrics as CSV (by=stage|label|org|week|reasons)',
    query: z.object({ by: z.enum([...ACCURACY_DIMENSIONS, 'reasons']).optional() }),
    responds: 'file', file: { contentTypes: ['text/csv; charset=utf-8'], disposition: 'attachment' },
    replaces: ['route:GET /api/admin/metrics'],
  }),
  lexicon: endpoint({
    method: 'GET', path: '/api/admin/lexicon', auth: 'session', role: 'platformAdmin',
    summary: 'The learned lexicon: synonym entries, unit aliases and global alias candidates with their decisions',
    responds: 'json',
    response: z.object({
      synonyms: z.array(LexiconEntry),
      units: z.array(LexiconEntry),
      aliases: z.array(AliasCandidate),
      file: z.object({ synonyms: z.number().int(), units: z.number().int() }),
    }),
    replaces: ['page:(app)/admin/lexicon'],
  }),
  createLexiconEntry: endpoint({
    method: 'POST', path: '/api/admin/lexicon', auth: 'session', role: 'platformAdmin',
    summary: 'Add a synonym entry or a unit alias; refused when it breaks the normaliser\'s invariants',
    body: z.object({ kind: z.enum(['synonym', 'unit']), payload: z.union([SynonymPayload, UnitPayload]), note: z.string().max(500).optional() }),
    responds: 'json', response: LexiconSave,
    replaces: ['page:(app)/admin/lexicon#create'],
  }),
  updateLexiconEntry: endpoint({
    method: 'PATCH', path: '/api/admin/lexicon/{entryId}', auth: 'session', role: 'platformAdmin',
    summary: 'Edit, disable or re-enable a synonym entry or unit alias (checked like a new entry)',
    params: z.object({ entryId: Id }),
    body: z.object({ payload: z.union([SynonymPayload, UnitPayload]).optional(), note: z.string().max(500).nullable().optional(), status: z.enum(['active', 'disabled']).optional() }),
    responds: 'json', response: LexiconSave,
    replaces: ['page:(app)/admin/lexicon#update'],
  }),
  decideAlias: endpoint({
    method: 'POST', path: '/api/admin/lexicon/aliases', auth: 'session', role: 'platformAdmin',
    summary: 'Approve or reject a global alias candidate (a name two or more organisations confirmed to one code)',
    body: z.object({ key: z.string().min(1).max(400), code: z.string().regex(/^\d{17}$/), decision: z.enum(['approve', 'reject']) }),
    responds: 'json', response: LexiconSave,
    replaces: ['page:(app)/admin/lexicon#aliases'],
  }),
});
