// Platform-admin pages: traction, pipeline status, accuracy metrics and their CSV. Anyone who
// is not a platform admin gets 404, as the pages and the CSV route did.
import { z } from 'zod';
import { IsoDateTime } from '../common';
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
});
