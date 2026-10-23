// The organisation's settings and the user's preferences: branding, retention, closing and
// reopening, the account export, language, theme, sidebar, Telegram chats, API keys, and the
// activity log.
import { z } from 'zod';
import { IsoDateTime, LIMITS, LOCALES, OkFlag, Ok, Redirect, RETENTION_CHOICES, ShellFail, THEMES } from '../common';
import { defineModule, endpoint } from '../endpoint';
import { ErrorState } from './auth';

const Flag = z.union([Ok, ShellFail]);

export const ApiKeyRow = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  checksThisMonth: z.number().int(),
  /** The creator's e-mail; null when unknown or the creator has left the team. */
  createdBy: z.string().nullable(),
  /** The key was made by a member who has since left the team. */
  creatorRemoved: z.boolean(),
});

const Limits = z.object({ clients: z.number().int().nullable(), rowsPerMonth: z.number().int().nullable(), seats: z.number().int().nullable() });

/** activity.ts activityPage() rows. */
export const ActivityRow = z.object({
  id: z.string(),
  action: z.string(),
  at: IsoDateTime,
  actorId: z.string().nullable(),
  actor: z.string().nullable(),
  catalogId: z.string().nullable(),
  catalogName: z.string().nullable(),
  catalogDeleted: z.boolean(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  count: z.number().int().nullable(),
  product: z.string().nullable(),
});

export const ACTIVITY_CATEGORIES = ['all', 'decisions', 'uploads', 'exports', 'share', 'clients', 'team', 'classifier', 'dictionary', 'other'] as const;

export const account = defineModule('account', {
  get: endpoint({
    method: 'GET', path: '/api/account', auth: 'session', role: 'admin',
    summary: 'Organisation profile, branding and data settings',
    responds: 'json',
    response: z.object({
      name: z.string(),
      brandName: z.string().nullable(),
      /** data: URL of the logo, as the settings page builds it today. */
      logoUrl: z.string().nullable(),
      dictAutoAccept: z.boolean(),
      rawRetentionDays: z.number().int().nullable(),
      rawRetentionSince: IsoDateTime.nullable(),
      retentionChoices: z.array(z.number().int()),
      /** Days a closed account is kept before it is erased (ACCOUNT_DELETE_AFTER_DAYS). */
      closeAfterDays: z.number().int(),
    }),
    replaces: ['page:(app)/settings#account', 'page:(app)/settings#data'],
    notes: 'Shape confirmed in W2; until W3 account-tab.tsx and data-tab.tsx select these columns from db.organization.',
  }),
  config: endpoint({
    method: 'GET', path: '/api/config', auth: 'public',
    summary: 'Limits the help and API docs pages quote: upload cap, API rate, plan limits and price, retention and closing',
    responds: 'json',
    response: z.object({
      uploadMaxBytes: z.number().int(),
      api: z.object({ ratePerMinute: z.number().int(), maxCheckItems: z.number().int(), checksPerMonth: z.object({ trial: z.number().int().nullable(), firm: z.number().int().nullable() }) }),
      plans: z.object({ trial: Limits, firm: Limits }),
      trialDays: z.number().int(),
      retentionChoices: z.array(z.number().int()),
      origin: z.string().nullable(),
      /** The firm plan's monthly price in soʻm (PLAN_FIRM_PRICE); null while it is not for sale. */
      firmPrice: z.number().int().nullable(),
      /** Days a closed account is kept before it is erased (ACCOUNT_DELETE_AFTER_DAYS). */
      closeAfterDays: z.number().int(),
    }),
    replaces: ['page:api-docs', 'page:yordam/[[...path]]'],
    notes: 'firmPrice and closeAfterDays added in W4a for the help articles (they read the configuration through this endpoint).',
  }),
  saveBranding: endpoint({
    method: 'POST', path: '/api/account/branding', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Firm name and logo for client PDF reports',
    multipart: {
      fields: z.object({ brandName: z.string().max(120).optional(), removeLogo: z.literal('on').optional() }),
      files: { logo: { required: false, maxBytes: LIMITS.logoBytes, extensions: LIMITS.logoExtensions, description: 'PNG or JPEG, told by its first bytes.' } },
    },
    responds: 'json', response: z.object({ error: z.string().optional(), saved: z.boolean().optional() }),
    replaces: ['action:settings.ts#saveBranding'],
  }),
  setRetention: endpoint({
    method: 'PUT', path: '/api/account/retention', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Days after which uploaded raw rows are deleted; null keeps them',
    body: z.object({ days: z.number().int().nullable() }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:security.ts#changeRetention'],
    notes: `setRetention accepts ${RETENTION_CHOICES.join(', ')} or null.`,
  }),
  close: endpoint({
    method: 'POST', path: '/api/account/close', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Close the account after the admin repeats the password; signs out',
    body: z.object({ password: z.string().max(200) }),
    responds: 'json', response: z.union([Redirect, ErrorState]),
    replaces: ['action:security.ts#closeAccount'],
  }),
  closedStatus: endpoint({
    method: 'GET', path: '/api/account/closed', auth: 'session', role: 'any',
    summary: 'For the closed-account page: when the data is purged and whether this user may reopen',
    responds: 'json', response: z.object({ purgeOn: IsoDateTime.nullable(), canReopen: z.boolean() }),
    replaces: ['page:account-deleted'],
    notes: 'The session belongs to a closed org: the guard must accept it here (isLive), unlike everywhere else. 401 without a live session record; purgeOn is null while the account is open. Shape confirmed in W2; account-deleted/page.tsx reads purgeDate() and the session record directly until W3.',
  }),
  reopen: endpoint({
    method: 'POST', path: '/api/account/reopen', auth: 'session', role: 'admin',
    summary: 'Reopen a closed account (admin of the closed org)',
    responds: 'json', response: Redirect,
    replaces: ['action:security.ts#reopenAccount'],
    notes: 'Closed org: the session guard must not refuse it. Redirects to /dashboard, /account-deleted or /sign-in.',
  }),
  exportZip: endpoint({
    method: 'GET', path: '/api/account/export', auth: 'session', role: 'admin', noDemo: true,
    summary: 'The whole account as a zip',
    responds: 'file', file: { contentTypes: ['application/zip'], disposition: 'attachment' },
    replaces: ['route:GET /api/account/export'],
  }),
  setLocale: endpoint({
    method: 'PUT', path: '/api/account/locale', auth: 'public',
    summary: 'Interface language: the cookie, and the user\'s saved choice when signed in',
    body: z.object({ locale: z.enum(LOCALES) }),
    responds: 'json', response: Ok,
    replaces: ['action:locale.ts#setLocale'],
    notes: 'The action answered nothing (void) and read any unknown value as the default language.',
  }),
  setTheme: endpoint({
    method: 'PUT', path: '/api/account/theme', auth: 'public',
    summary: 'Colour theme cookie for this browser',
    body: z.object({ theme: z.enum(THEMES) }),
    responds: 'json', response: Flag,
    replaces: ['action:shell.ts#setTheme'],
  }),
  setSidebar: endpoint({
    method: 'PUT', path: '/api/account/sidebar', auth: 'public',
    summary: 'Sidebar collapsed or expanded, so the server renders it without a flash',
    body: z.object({ state: z.enum(['collapsed', 'expanded']) }),
    responds: 'json', response: Flag,
    replaces: ['action:shell.ts#setSidebar'],
  }),
  telegramLinks: endpoint({
    method: 'GET', path: '/api/account/telegram', auth: 'session', role: 'admin',
    summary: 'Telegram chats that receive notifications, and whether the bot is configured',
    responds: 'json',
    response: z.object({
      enabled: z.boolean(),
      bot: z.string().nullable(),
      links: z.array(z.object({ id: z.string(), username: z.string().nullable(), createdAt: IsoDateTime, linkedBy: z.string().nullable() })),
    }),
    replaces: ['page:(app)/settings#integrations'],
    notes: 'Shape confirmed in W2; until W3 integrations-tab.tsx queries db.telegramLink and maps linkedBy to an e-mail itself.',
  }),
  telegramCode: endpoint({
    method: 'POST', path: '/api/account/telegram/code', auth: 'session', role: 'admin', noDemo: true,
    summary: 'A one-time code to send the bot as "/start CODE"',
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), code: z.string(), minutes: z.number().int() }), z.object({ ok: z.literal(false) })]),
    replaces: ['action:settings.ts#telegramCode'],
  }),
  telegramUnlink: endpoint({
    method: 'DELETE', path: '/api/account/telegram/{linkId}', auth: 'session', role: 'admin',
    summary: 'Stop notifications to one Telegram chat',
    params: z.object({ linkId: z.string().min(1) }),
    responds: 'json', response: OkFlag,
    replaces: ['action:settings.ts#telegramUnlink'],
  }),
  telegramWebhook: endpoint({
    method: 'POST', path: '/api/telegram/webhook', auth: 'providerSignature',
    summary: 'Telegram bot webhook (X-Telegram-Bot-Api-Secret-Token)',
    body: z.record(z.unknown()),
    responds: 'raw', contentType: 'application/json',
    replaces: ['route:POST /api/telegram/webhook'],
    notes: 'grammy webhookCallback; 404 without TELEGRAM_BOT_TOKEN, 503 without TELEGRAM_WEBHOOK_SECRET. Path registered with Telegram: keep it.',
  }),
  apiKeys: endpoint({
    method: 'GET', path: '/api/account/api-keys', auth: 'session', role: 'admin',
    summary: 'API keys, this month\'s usage and the plan\'s allowance',
    responds: 'json',
    response: z.object({
      keys: z.array(ApiKeyRow),
      maxActive: z.number().int(),
      usage: z.object({ checks: z.number().int(), requests: z.number().int() }),
      /** Checks a month the plan allows; null = no cap. */
      monthlyCap: z.number().int().nullable(),
      ratePerMinute: z.number().int(),
    }),
    replaces: ['page:(app)/settings#integrations'],
    notes: 'Shape confirmed in W2; until W3 integrations-tab.tsx combines listApiKeys, usageThisMonth, planStatus and apiConfig itself.',
  }),
  createApiKey: endpoint({
    method: 'POST', path: '/api/account/api-keys', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Create a key; the token is shown once',
    body: z.object({ name: z.string().max(200) }),
    responds: 'json', response: z.union([z.object({ token: z.string() }), z.object({ error: z.enum(['name', 'limit', 'failed']) })]),
    replaces: ['action:api-keys.ts#addApiKey'],
    notes: 'The name is validated by the handler (1..60 after trim) so a bad one answers { error: "name" }, as before.',
  }),
  revokeApiKey: endpoint({
    method: 'DELETE', path: '/api/account/api-keys/{keyId}', auth: 'session', role: 'admin',
    summary: 'Revoke a key',
    params: z.object({ keyId: z.string().min(1) }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:api-keys.ts#removeApiKey'],
  }),
  activity: endpoint({
    method: 'GET', path: '/api/activity', auth: 'session', role: 'any',
    summary: 'The audit log, filtered and paged',
    query: z.object({
      client: z.string().optional(),
      user: z.string().optional(),
      category: z.enum(ACTIVITY_CATEGORIES).optional(),
      /** YYYY-MM-DD, in the org's time zone. */
      from: z.string().max(10).optional(),
      to: z.string().max(10).optional(),
      page: z.coerce.number().int().min(0).optional(),
    }),
    responds: 'json',
    response: z.object({
      rows: z.array(ActivityRow),
      hasMore: z.boolean(),
      total: z.number().int().nullable(),
      pageSize: z.number().int(),
      clients: z.array(z.object({ id: z.string(), name: z.string() })),
      users: z.array(z.object({ id: z.string(), email: z.string() })),
      /** The filters as applied: days as YYYY-MM-DD, a client or member outside the viewer's reach dropped. */
      applied: z.object({
        clientId: z.string().nullable(), userId: z.string().nullable(), category: z.enum(ACTIVITY_CATEGORIES),
        from: z.string().nullable(), to: z.string().nullable(), page: z.number().int(),
      }),
      /** A typed day could not be read and was dropped. */
      unreadable: z.boolean(),
      /** The range was given in reverse and swapped. */
      swapped: z.boolean(),
    }),
    replaces: ['page:(app)/activity'],
    notes: 'Shape confirmed in W2; until W3 activity/page.tsx also loads the client and user pickers with db.client/db.user; groupDecisions stays in the web.',
  }),
});
