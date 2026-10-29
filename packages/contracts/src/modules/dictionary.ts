// The firm dictionary: learned name → code mappings, the accept-all button, edits, and the
// org setting that accepts dictionary matches automatically.
import { z } from 'zod';
import { Id, ManyOutcome, OkFlag, QueryPage } from '../common';
import { defineModule, endpoint } from '../endpoint';

export const DICT_FILTERS = ['all', 'confirmed', 'unverified', 'reconfirm', 'stale'] as const;

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
  /** Auto-accept skips the entry until someone confirms it again. */
  needsReconfirm: z.boolean(),
  /** A suggestion from it was rejected or reported wrong; cleared by an admin's confirm or edit. */
  disputedAt: z.string().nullable(),
  /** E-mail of who disputed it (same org); null when unknown or removed. */
  disputedBy: z.string().nullable(),
});

const Result = z.object({ ok: z.boolean(), error: z.string().optional() });

/** The firm dictionary entry behind a reused suggestion, as the row drawer shows it. */
const DictionarySource = z.object({
  entryId: z.string(),
  kind: z.string(),
  label: z.string(),
  code: z.string(),
  confirmations: z.number().int(),
  needsReconfirm: z.boolean(),
  disputedAt: z.string().nullable(),
  disputedBy: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string(),
  source: z.string().nullable(),
});

export const dictionary = defineModule('dictionary', {
  list: endpoint({
    method: 'GET', path: '/api/dictionary', auth: 'session', role: 'any',
    summary: 'Dictionary entries, searched and filtered, most used first',
    query: z.object({ q: z.string().max(100).optional(), f: z.enum(DICT_FILTERS).optional(), page: QueryPage }),
    responds: 'json',
    response: z.object({
      rows: z.array(DictRow),
      counts: z.object({ all: z.number().int(), stale: z.number().int(), confirmed: z.number().int(), unverified: z.number().int(), reconfirm: z.number().int() }),
      total: z.number().int(),
      pageSize: z.number().int(),
      /** False when the plan or role has no dictionary (mayUseDictionary). */
      available: z.boolean(),
    }),
    replaces: ['page:(app)/dictionary'],
  }),
  acceptForCatalog: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/dictionary/accept', auth: 'session', role: 'writer',
    summary: 'Accept every pending suggestion that came from the dictionary, as one undoable event',
    params: z.object({ catalogId: Id }),
    responds: 'json', response: ManyOutcome,
    replaces: ['action:dictionary.ts#acceptDictionary'],
  }),
  update: endpoint({
    method: 'PATCH', path: '/api/dictionary/{entryId}', auth: 'session', role: 'admin',
    summary: 'Point an entry at another live classifier code (admins); it needs a fresh confirmation unless confirmed now',
    params: z.object({ entryId: Id }),
    body: z.object({ code: z.string().max(32), confirm: z.boolean().optional() }),
    responds: 'json', response: Result,
    replaces: ['action:dictionary.ts#updateMapping'],
    notes: 'A code that is not 17 digits answers { ok: false, error } (wsX.dict.codeFormat), as before. confirm=true counts as one confirmation.',
  }),
  confirm: endpoint({
    method: 'POST', path: '/api/dictionary/{entryId}/confirm', auth: 'session', role: 'writer',
    summary: 'Confirm an entry\'s code as it is: one confirmation, lifts needsReconfirm; a disputed entry needs an admin',
    params: z.object({ entryId: Id }),
    responds: 'json', response: Result,
    replaces: ['page:(app)/dictionary#confirm'],
  }),
  remove: endpoint({
    method: 'DELETE', path: '/api/dictionary/{entryId}', auth: 'session', role: 'admin',
    summary: 'Delete an entry (admins)',
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
  provenance: endpoint({
    method: 'GET', path: '/api/findings/{findingId}/provenance', auth: 'session', role: 'any',
    summary: 'Where a row\'s suggestion or decision came from: the dictionary entry behind it, the upload a carried-over decision was first made in',
    params: z.object({ findingId: Id }),
    responds: 'json',
    response: z.object({
      /** Null for a suggestion that did not come from the dictionary, or a member scoped to some clients. */
      dictionary: DictionarySource.nullable(),
      carriedFrom: z.object({ catalogId: z.string(), filename: z.string().nullable(), originalDecidedAt: z.string().nullable() }).nullable(),
    }),
    replaces: ['page:(app)/catalogs/[id]#provenance'],
    notes: '404 for a finding outside the reader\'s clients.',
  }),
});
