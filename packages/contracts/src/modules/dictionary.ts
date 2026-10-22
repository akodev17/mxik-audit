// The firm dictionary: learned name → code mappings, the accept-all button, edits, and the
// org setting that accepts dictionary matches automatically.
import { z } from 'zod';
import { Id, ManyOutcome, OkFlag, QueryPage } from '../common';
import { defineModule, endpoint } from '../endpoint';

export const DICT_FILTERS = ['all', 'confirmed', 'unverified', 'stale'] as const;

/** dictionary/dictionary-table.tsx DictRow, with the date as ISO instead of formatted. */
export const DictRow = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  code: z.string(),
  codeName: z.string().nullable(),
  uses: z.number().int(),
  confirmations: z.number().int(),
  source: z.string().nullable(),
  stale: z.boolean(),
  updatedAt: z.string(),
  approver: z.string().nullable(),
});

const Result = z.object({ ok: z.boolean(), error: z.string().optional() });

export const dictionary = defineModule('dictionary', {
  list: endpoint({
    method: 'GET', path: '/api/dictionary', auth: 'session', role: 'any',
    summary: 'Dictionary entries, searched and filtered, most used first',
    query: z.object({ q: z.string().max(100).optional(), f: z.enum(DICT_FILTERS).optional(), page: QueryPage }),
    responds: 'json',
    response: z.object({
      rows: z.array(DictRow),
      counts: z.object({ all: z.number().int(), stale: z.number().int(), confirmed: z.number().int(), unverified: z.number().int() }),
      total: z.number().int(),
      pageSize: z.number().int(),
      /** False when the plan or role has no dictionary (mayUseDictionary). */
      available: z.boolean(),
    }),
    replaces: ['page:(app)/dictionary'],
    provisional: 'dictionary/page.tsx queries db.firmMapping and joins codeDetails and approverEmails itself',
  }),
  acceptForCatalog: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/dictionary/accept', auth: 'session', role: 'writer',
    summary: 'Accept every pending suggestion that came from the dictionary, as one undoable event',
    params: z.object({ catalogId: Id }),
    responds: 'json', response: ManyOutcome,
    replaces: ['action:dictionary.ts#acceptDictionary'],
  }),
  update: endpoint({
    method: 'PATCH', path: '/api/dictionary/{entryId}', auth: 'session', role: 'writer',
    summary: 'Point an entry at another live classifier code (counts as one confirmation)',
    params: z.object({ entryId: Id }),
    body: z.object({ code: z.string().max(32) }),
    responds: 'json', response: Result,
    replaces: ['action:dictionary.ts#updateMapping'],
    notes: 'A code that is not 17 digits answers { ok: false, error } (wsX.dict.codeFormat), as before.',
  }),
  remove: endpoint({
    method: 'DELETE', path: '/api/dictionary/{entryId}', auth: 'session', role: 'writer',
    summary: 'Delete an entry',
    params: z.object({ entryId: Id }),
    responds: 'json', response: Result,
    replaces: ['action:dictionary.ts#deleteMapping'],
  }),
  setAutoAccept: endpoint({
    method: 'PUT', path: '/api/dictionary/auto-accept', auth: 'session', role: 'admin',
    summary: 'Accept dictionary matches automatically in new audits',
    body: z.object({ on: z.boolean() }),
    responds: 'json', response: OkFlag,
    replaces: ['action:dictionary.ts#setDictAutoAccept'],
  }),
});
