// A client's purchase lists ("Kirim") and cheque / sales lists: upload, map, apply, restart,
// remove, the blank templates, and the client's activity type that decides NOT_PURCHASED risk.
import { z } from 'zod';
import { CLIENT_ACTIVITIES, DOC_KINDS, DocMap, Fail, Id, IsoDateTime, LIMITS, Ok, OkFlag, PurchaseMap, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';

const ClientPath = z.object({ clientId: ShortId });
const ListPath = z.object({ listId: Id });

/** actions/purchases.ts ListPreview. */
export const ListPreview = z.object({
  listId: z.string(),
  filename: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  totalRows: z.number().int(),
  totalSeen: z.number().int(),
  truncated: z.boolean(),
});

const UploadFile = { required: true, maxBytes: LIMITS.uploadBytes, extensions: LIMITS.uploadExtensions, description: 'Excel (.xlsx, .xls) or CSV.' } as const;

export const PurchaseListRow = z.object({
  id: z.string(),
  filename: z.string(),
  rowCount: z.number().int(),
  status: z.string(),
  createdAt: IsoDateTime,
  headers: z.array(z.string()),
  map: PurchaseMap,
  /** Rows with a code. */
  codes: z.number().int(),
  sample: z.array(z.array(z.string())),
  totalSeen: z.number().int().nullable(),
  truncated: z.boolean(),
});

export const DocListRow = z.object({
  id: z.string(),
  kind: z.enum(DOC_KINDS),
  filename: z.string(),
  rowCount: z.number().int(),
  status: z.string(),
  progressDone: z.number().int(),
  progressTotal: z.number().int(),
  error: z.string().nullable(),
  createdAt: IsoDateTime,
  headers: z.array(z.string()),
  map: DocMap,
  /** The check stopped without a heartbeat (docCheckStale). */
  stale: z.boolean(),
  /** First rows of an uploaded or failed list, to resume its mapping; [] otherwise. */
  sample: z.array(z.array(z.string())),
  totalSeen: z.number().int().nullable(),
  truncated: z.boolean(),
});

/** docs.ts DocGroup with GroupDetail; Decimal columns as numbers. */
export const DocGroupRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  mxik: z.string().nullable(),
  mxikName: z.string().nullable(),
  unit: z.string().nullable(),
  lines: z.number().int(),
  quantity: z.number().nullable(),
  amount: z.number().nullable(),
  issues: z.array(z.string()),
  suggestedMxik: z.string().nullable(),
  confidence: z.number().nullable(),
  /** Every product name the group's lines carried. */
  names: z.array(z.string()),
  /** The classifier name of the suggested code. */
  suggestedName: z.string().nullable(),
  detail: z.object({
    reasons: z.array(z.string()),
    alternatives: z.array(z.object({ code: z.string(), name: z.string(), confidence: z.number() })),
    catalogMatches: z.array(z.object({ rowIndex: z.number().int(), name: z.string(), catalogId: z.string() })),
  }),
});

export const imports = defineModule('imports', {
  purchases: endpoint({
    method: 'GET', path: '/api/clients/{clientId}/purchases', auth: 'session', role: 'any',
    summary: 'The client\'s purchase lists with their mapping and a sample',
    params: ClientPath,
    responds: 'json', response: z.object({ client: z.object({ id: z.string(), name: z.string(), activity: z.enum(CLIENT_ACTIVITIES).nullable() }), lists: z.array(PurchaseListRow) }),
    replaces: ['page:(app)/clients/[id]/purchases'],
    provisional: 'purchases/page.tsx queries db.purchaseList and db.purchaseItem itself',
  }),
  uploadPurchases: endpoint({
    method: 'POST', path: '/api/clients/{clientId}/purchases', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Store a purchase file under the client and preview it for mapping',
    params: ClientPath,
    multipart: { fields: z.object({}), files: { file: UploadFile } },
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), preview: ListPreview.extend({ map: PurchaseMap }) }), Fail]),
    replaces: ['action:purchases.ts#uploadPurchases'],
    notes: 'The action read clientId from the form; here it is the path.',
  }),
  applyPurchases: endpoint({
    method: 'POST', path: '/api/purchases/{listId}/apply', auth: 'session', role: 'writer',
    summary: 'Confirm the columns of a purchase list; answers how many codes it holds',
    params: ListPath,
    body: z.object({ map: PurchaseMap }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), codes: z.number().int() }), Fail]),
    replaces: ['action:purchases.ts#applyPurchases'],
  }),
  removePurchases: endpoint({
    method: 'DELETE', path: '/api/purchases/{listId}', auth: 'session', role: 'writer',
    summary: 'Delete a purchase list',
    params: ListPath,
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['action:purchases.ts#removePurchases'],
  }),
  setActivity: endpoint({
    method: 'PUT', path: '/api/clients/{clientId}/activity', auth: 'session', role: 'writer', noDemo: true,
    summary: '"Faoliyat turi": whether a sale without a purchase is a high risk',
    params: ClientPath,
    body: z.object({ activity: z.enum(CLIENT_ACTIVITIES) }),
    responds: 'json', response: OkFlag,
    replaces: ['action:purchases.ts#setActivity'],
  }),
  docs: endpoint({
    method: 'GET', path: '/api/clients/{clientId}/docs', auth: 'session', role: 'any',
    summary: 'The client\'s cheque or sales lists (30 newest)',
    params: ClientPath,
    query: z.object({ kind: z.enum(DOC_KINDS).default('cheques') }),
    responds: 'json', response: z.object({ client: z.object({ id: z.string(), name: z.string() }), lists: z.array(DocListRow) }),
    replaces: ['page:(app)/clients/[id]/imports'],
    provisional: 'imports/page.tsx queries db.docList and db.docItem itself',
  }),
  uploadDoc: endpoint({
    method: 'POST', path: '/api/clients/{clientId}/docs', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Store a cheque or sales list under the client and preview it for mapping',
    params: ClientPath,
    multipart: { fields: z.object({ kind: z.enum(DOC_KINDS) }), files: { file: UploadFile } },
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), preview: ListPreview.extend({ map: DocMap }) }), Fail]),
    replaces: ['action:docs.ts#uploadDoc'],
  }),
  doc: endpoint({
    method: 'GET', path: '/api/docs/{listId}', auth: 'session', role: 'any',
    summary: 'One checked list: its groups, issues and suggestions',
    params: ListPath,
    query: z.object({ issue: z.string().max(40).optional() }),
    responds: 'json',
    response: z.object({
      list: DocListRow.extend({
        clientId: z.string(), clientName: z.string(),
        /** Groups found and checked (a list over MAX_GROUPS checks the largest), and amounts read ambiguously. */
        groupsTotal: z.number().int().nullable(), groupsChecked: z.number().int().nullable(), ambiguous: z.number().int(),
      }),
      /** Every group of a finished check (largest amount first), or only those with `issue`; empty before it finished. */
      groups: z.array(DocGroupRow),
    }),
    replaces: ['page:(app)/clients/[id]/imports/[listId]'],
    provisional: 'imports/[listId]/page.tsx queries db.docList and db.docGroup and joins codeDetails itself',
  }),
  applyDoc: endpoint({
    method: 'POST', path: '/api/docs/{listId}/apply', auth: 'session', role: 'writer',
    summary: 'Confirm the columns and start the check',
    params: ListPath,
    body: z.object({ map: DocMap }),
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['action:docs.ts#applyDoc'],
    notes: 'The check runs on the worker (doc-check queue).',
  }),
  restartDoc: endpoint({
    method: 'POST', path: '/api/docs/{listId}/restart', auth: 'session', role: 'writer',
    summary: 'Restart a failed or stalled check',
    params: ListPath,
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['action:docs.ts#restartDoc'],
  }),
  removeDoc: endpoint({
    method: 'DELETE', path: '/api/docs/{listId}', auth: 'session', role: 'writer',
    summary: 'Delete a cheque or sales list',
    params: ListPath,
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['action:docs.ts#removeDoc'],
  }),
  docTemplate: endpoint({
    method: 'GET', path: '/api/doc-template', auth: 'session', role: 'any',
    summary: 'Blank cheque or sales template, in the requester\'s language',
    query: z.object({ kind: z.enum(DOC_KINDS).optional() }),
    responds: 'file', file: { contentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], disposition: 'attachment' },
    replaces: ['route:GET /api/doc-template'],
  }),
  purchaseTemplate: endpoint({
    method: 'GET', path: '/api/purchase-template', auth: 'session', role: 'any',
    summary: 'Blank purchase-list template, in the requester\'s language',
    responds: 'file', file: { contentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], disposition: 'attachment' },
    replaces: ['route:GET /api/purchase-template'],
  }),
});
