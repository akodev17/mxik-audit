// In-app notifications (page, bell, mark read) and the command-palette search.
import { z } from 'zod';
import { CATALOG_STATUSES, ClientRef, IsoDateTime, PLAN_RESOURCES, QueryFlag, QueryPage, ShellFail, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';

export const NOTICE_GROUPS = ['review', 'audit', 'other'] as const;

/** notifications.ts NoticeView. */
export const NoticeView = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  href: z.string().nullable(),
  createdAt: IsoDateTime,
  unread: z.boolean(),
  client: z.object({ id: z.string(), name: z.string() }).nullable(),
});

/** search.ts SearchResults. */
export const SearchResults = z.object({
  query: z.string(),
  clients: z.array(z.object({ id: z.string(), name: z.string(), href: z.string() })),
  catalogs: z.array(z.object({ id: z.string(), filename: z.string(), clientName: z.string().nullable(), createdAt: IsoDateTime, status: z.enum(CATALOG_STATUSES), href: z.string() })),
  products: z.array(z.object({
    id: z.string(), name: z.string(), code: z.string().nullable(), row: z.number().int(), clientName: z.string().nullable(),
    status: z.enum(['attention', 'decided', 'auto', 'info', 'clean']), href: z.string(),
  })),
  codes: z.array(z.object({ code: z.string(), name: z.string(), retired: z.boolean() })),
});

/** shell-frame.ts ShellFrame: what the signed-in frame shows on every page. */
export const ShellFrame = z.object({
  email: z.string(),
  demo: z.boolean(),
  canWrite: z.boolean(),
  canManageTeam: z.boolean(),
  plan: z.object({
    state: z.enum(['unlimited', 'trial', 'firm', 'expired']),
    daysLeft: z.number().int().nullable(),
    warnings: z.array(z.enum(PLAN_RESOURCES)),
    full: z.array(z.enum(PLAN_RESOURCES)),
  }),
  clients: z.array(ClientRef),
  activeClient: ClientRef.nullable(),
  unread: z.number().int().nullable(),
});

export const notifications = defineModule('notifications', {
  shell: endpoint({
    method: 'GET', path: '/api/shell', auth: 'session', role: 'any',
    summary: 'The app frame: visible clients and the active one, unread count, plan warnings',
    responds: 'json', response: ShellFrame,
    replaces: ['page:(app)/layout#shell'],
    notes: 'An unscoped user in an org without clients gets the default client created, as the layout did. unread is null when it could not be read.',
  }),

  list: endpoint({
    method: 'GET', path: '/api/notifications', auth: 'session', role: 'any',
    summary: 'The notifications page: one page, optionally unread only or one group',
    query: z.object({ page: QueryPage, unread: QueryFlag.optional(), group: z.enum(NOTICE_GROUPS).optional() }),
    responds: 'json',
    response: z.object({
      items: z.array(NoticeView),
      total: z.number().int(),
      page: z.number().int(),
      pageSize: z.number().int(),
      pageCount: z.number().int(),
      unread: z.number().int(),
    }),
    replaces: ['page:(app)/notifications'],
  }),
  preview: endpoint({
    method: 'GET', path: '/api/notifications/preview', auth: 'session', role: 'any',
    summary: 'Latest six for the bell; reading them does not mark them read',
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), items: z.array(NoticeView), unread: z.number().int(), total: z.number().int() }), ShellFail]),
    replaces: ['action:shell.ts#notificationsPreview'],
  }),
  markRead: endpoint({
    method: 'POST', path: '/api/notifications/read', auth: 'session', role: 'any',
    summary: 'Mark notifications read for this user; answers the new unread count',
    body: z.object({ ids: z.array(ShortId).min(1).max(100) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), unread: z.number().int() }), ShellFail]),
    replaces: ['action:shell.ts#markNotificationsRead'],
  }),
  markAllRead: endpoint({
    method: 'POST', path: '/api/notifications/read-all', auth: 'session', role: 'any',
    summary: 'Mark everything the user can see as read',
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), marked: z.number().int(), unread: z.number().int() }), ShellFail]),
    replaces: ['action:shell.ts#markAllNotificationsRead'],
  }),
  search: endpoint({
    method: 'GET', path: '/api/search', auth: 'session', role: 'any',
    summary: 'Command-palette search over the user\'s clients, catalogues, products and codes',
    query: z.object({ q: z.string().max(200) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), results: SearchResults }), ShellFail]),
    replaces: ['action:shell.ts#searchEverything'],
  }),
});
