// The firm's clients: list with attention reasons, one client's page, create, rename, archive,
// restore, delete, accountants, and which client is the active one.
import { z } from 'zod';
import { ClientRef, Fail, IsoDateTime, Ok, OkOrFail, QueryPage, ROLES, ShellFail, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';
import { ActivityRow } from './account';
import { CatalogListItem } from './catalogs';
import { ReminderSchedule } from './reminders';

export const CLIENT_FILTERS = ['all', 'attention', 'overdue', 'stale', 'empty', 'archived'] as const;
export const CLIENT_SORTS = ['attention', 'name', 'open', 'progress', 'oldest', 'newest'] as const;

/** client-stats.ts ClientStats. */
export const ClientStats = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  archivedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  catalogId: z.string().nullable(),
  catalogName: z.string().nullable(),
  auditedAt: IsoDateTime.nullable(),
  rowCount: z.number().int(),
  previousId: z.string().nullable(),
  catalogs: z.number().int(),
  riskyRows: z.number().int(),
  openRows: z.number().int(),
  riskyFindings: z.number().int(),
  pendingFindings: z.number().int(),
  updatePending: z.number().int(),
  overdueTasks: z.number().int(),
  accountants: z.array(z.string()),
});

/** client-attention.ts AttentionReason. */
export const AttentionReason = z.object({ kind: z.enum(['update', 'open', 'overdue', 'empty', 'failed', 'analyzing', 'uploaded']), count: z.number().int() });

export const ClientFilterCounts = z.object(Object.fromEntries(CLIENT_FILTERS.map((f) => [f, z.number().int()])) as Record<(typeof CLIENT_FILTERS)[number], z.ZodNumber>);

export const Dependant = z.object({ kind: z.enum(['member', 'invite']), email: z.string().nullable() });

export const AssignableAccountant = z.object({ id: z.string(), email: z.string(), assigned: z.boolean(), unrestricted: z.boolean(), onlyThis: z.boolean() });

const ClientPath = z.object({ clientId: ShortId });

export const clients = defineModule('clients', {
  list: endpoint({
    method: 'GET', path: '/api/clients', auth: 'session', role: 'any',
    summary: 'Clients with their latest audit, open work and attention reasons',
    query: z.object({
      q: z.string().max(100).optional(),
      filter: z.enum(CLIENT_FILTERS).optional(),
      sort: z.enum(CLIENT_SORTS).optional(),
      /** Days without an audit after which a client counts as stale (30, 60 or 90; default 30). */
      days: z.coerce.number().int().optional(),
      page: QueryPage,
    }),
    responds: 'json',
    response: z.object({
      rows: z.array(ClientStats.extend({ attention: z.array(AttentionReason) })),
      total: z.number().int(),
      counts: ClientFilterCounts,
      pageSize: z.number().int(),
      staleDays: z.number().int(),
    }),
    replaces: ['page:(app)/clients'],
    provisional: 'clients/page.tsx combines clientStats, pendingAudits and clientAttention itself',
  }),
  get: endpoint({
    method: 'GET', path: '/api/clients/{clientId}', auth: 'session', role: 'any',
    summary: 'One client\'s page: stats, catalogues, drafts, history, reminder, staff',
    params: ClientPath,
    responds: 'json',
    response: z.object({
      client: z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), archivedAt: IsoDateTime.nullable(), activity: z.enum(['savdo', 'ishlab_chiqarish', 'boshqa']).nullable() }),
      stats: ClientStats.nullable(),
      catalogs: z.object({ items: z.array(CatalogListItem), total: z.number().int() }),
      drafts: z.array(CatalogListItem),
      history: z.object({ rows: z.array(ActivityRow), hasMore: z.boolean() }),
      schedule: ReminderSchedule.nullable(),
      /** Members who can be reminded (not viewers). */
      staff: z.array(z.object({ id: z.string(), email: z.string(), role: z.enum(ROLES), clientIds: z.array(z.string()) })),
      /** Admins only. */
      accountants: z.array(AssignableAccountant).nullable(),
      /** Admins only, never in a demo. */
      dependants: z.object({ deleteBlockers: z.array(Dependant), archiveStranded: z.array(z.string()) }).nullable(),
    }),
    replaces: ['page:(app)/clients/[id]'],
    provisional: 'clients/[id]/page.tsx runs eight queries itself; 404 when the client is not the user\'s to see',
  }),
  create: endpoint({
    method: 'POST', path: '/api/clients', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Create a client and make it the active one',
    body: z.object({ name: z.string().max(400) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), clientId: z.string() }), Fail]),
    replaces: ['action:clients.ts#addClient'],
    notes: 'Plan gate "clients"; sets session.clientId.',
  }),
  switchActive: endpoint({
    method: 'PUT', path: '/api/clients/active', auth: 'session', role: 'any',
    summary: 'Make a client the active one (visible to the user, not archived)',
    body: z.object({ clientId: ShortId }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), client: ClientRef }), ShellFail]),
    replaces: ['action:shell.ts#switchClient', 'action:clients.ts#rememberClient'],
    notes: 'rememberClient answered { ok: boolean }; callers that read only .ok keep working.',
  }),
  rename: endpoint({
    method: 'PATCH', path: '/api/clients/{clientId}', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Rename a client',
    params: ClientPath,
    body: z.object({ name: z.string().max(400) }),
    responds: 'json', response: OkOrFail,
    replaces: ['action:clients.ts#renameClientAction'],
  }),
  archive: endpoint({
    method: 'POST', path: '/api/clients/{clientId}/archive', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Archive a client; answers who is left without an active client',
    params: ClientPath,
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), stranded: z.array(z.string()) }), Fail]),
    replaces: ['action:clients.ts#archiveClientAction'],
  }),
  restore: endpoint({
    method: 'POST', path: '/api/clients/{clientId}/restore', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Restore an archived client',
    params: ClientPath,
    responds: 'json', response: OkOrFail,
    replaces: ['action:clients.ts#restoreClientAction'],
  }),
  remove: endpoint({
    method: 'POST', path: '/api/clients/{clientId}/delete', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Delete a client after its exact name was typed',
    params: ClientPath,
    body: z.object({ confirmName: z.string().max(400) }),
    responds: 'json', response: z.union([Ok, Fail.extend({ blockers: z.array(Dependant).optional() })]),
    replaces: ['action:clients.ts#deleteClientAction'],
    notes: 'POST, not DELETE: it carries the typed name in the body.',
  }),
  accountants: endpoint({
    method: 'GET', path: '/api/clients/{clientId}/accountants', auth: 'session', role: 'admin',
    summary: 'Accountants and viewers who may be assigned to the client',
    params: ClientPath,
    responds: 'json', response: z.array(AssignableAccountant),
    replaces: ['page:(app)/clients/[id]#accountants'],
  }),
  setAccountants: endpoint({
    method: 'PUT', path: '/api/clients/{clientId}/accountants', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Who is assigned to the client',
    params: ClientPath,
    body: z.object({ userIds: z.array(ShortId).max(500) }),
    responds: 'json', response: OkOrFail,
    replaces: ['action:clients.ts#setAccountantsAction'],
  }),
});
