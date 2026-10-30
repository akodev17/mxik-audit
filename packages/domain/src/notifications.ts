// In-app notifications, scoped by org and by the user's clients, also sent to the
// org's linked Telegram chats when the bot is configured. Read state is per user.
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { jobs } from './jobs/dispatcher.js';
import type { NoticeText, NoticeTexts } from './notification-text.js';
import type { CurrentUser } from './session.js';

export type NewNotification = {
  orgId: string;
  clientId?: string | null;
  kind: string;
  /** In the org's language: what Telegram sends and what a reader without `text` sees. */
  title: string;
  body: string;
  /** The same in every interface language, so each reader gets theirs (B13). */
  text?: NoticeTexts;
  href?: string | null;
  /** Addressed to this person alone; null or absent = everyone who may see the notice. */
  userId?: string | null;
  /** Names the event, so raising it again (a retried job, a repeated request) changes nothing. */
  dedupeKey?: string | null;
  /** Send to the org's Telegram chats too. Default: yes for notices to everyone, never for one person's. */
  external?: boolean;
};

/**
 * Stores a notification and, unless it is personal, sends it on. Returns its id, or null when the same
 * dedupeKey was already raised for the org (nothing is stored or sent twice).
 */
export async function notify(input: NewNotification): Promise<string | null> {
  const data = {
    orgId: input.orgId, clientId: input.clientId ?? null, kind: input.kind,
    title: input.title, body: input.body, href: input.href ?? null,
    userId: input.userId ?? null, dedupeKey: input.dedupeKey ?? null, text: input.text,
  };
  let id: string;
  if (data.dedupeKey) {
    // The unique index on (orgId, dedupeKey) decides; skipDuplicates turns the race into a no-op.
    const made = await db.notification.createMany({ data: [data], skipDuplicates: true });
    if (made.count === 0) return null;
    const row = await db.notification.findFirstOrThrow({ where: { orgId: data.orgId, dedupeKey: data.dedupeKey }, select: { id: true } });
    id = row.id;
  } else {
    id = (await db.notification.create({ data, select: { id: true } })).id;
  }
  if (input.external ?? !input.userId) await deliver(id);
  return id;
}

/** Sends (or queues) a notification beyond the app; a delivery failure never loses the notification. */
export async function deliver(notificationId: string): Promise<void> {
  // Inline, the dispatcher loads the bot library only now, so the app never loads it when the bot is off.
  await jobs().enqueueTelegram({ kind: 'notification', notificationId }).catch((error: unknown) => {
    console.warn(`[notify ${notificationId}] telegram failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export type NoticeUser = Pick<CurrentUser, 'userId' | 'orgId' | 'clientIds'>;

/**
 * Org-level notices (no client) for everyone; client notices only for users who may see that client;
 * a notice addressed to one person only for that person.
 */
export function noticeScope(user: Pick<CurrentUser, 'orgId' | 'clientIds' | 'userId'>): Prisma.NotificationWhereInput {
  const mine: Prisma.NotificationWhereInput = { OR: [{ userId: null }, { userId: user.userId }] };
  if (user.clientIds == null) return { orgId: user.orgId, ...mine };
  return { orgId: user.orgId, AND: [mine, { OR: [{ clientId: null }, { clientId: { in: user.clientIds } }] }] };
}

/**
 * Unread for this user. The org-wide readAt predates per-user reads: a notice marked that way
 * stays read for everyone, and nothing sets it any more.
 */
export function unreadWhere(user: NoticeUser): Prisma.NotificationWhereInput {
  return { ...noticeScope(user), readAt: null, reads: { none: { userId: user.userId } } };
}

/**
 * A stored link as a safe in-app path. Old notices point at /report?catalog=…, which only
 * redirects; they now open the catalogue directly. Anything not site-relative is dropped.
 */
export function noticeHref(href: string | null): string | null {
  if (!href) return null;
  // Browsers drop tabs and newlines inside a URL and read "\" as "/", so "/\t/x" would leave the site.
  // eslint-disable-next-line no-control-regex
  const clean = href.replace(/[\u0000- \u007f]/g, '').replace(/\\/g, '/');
  if (!clean.startsWith('/') || clean.startsWith('//')) return null;
  const url = new URL(clean, 'http://local');
  // Dot segments can still collapse into "//host" ("/.//evil"); only a same-site path survives.
  if (url.origin !== 'http://local' || url.pathname.startsWith('//')) return null;
  if (url.pathname !== '/report') return `${url.pathname}${url.search}${url.hash}`;
  const catalog = url.searchParams.get('catalog');
  if (!catalog || !/^[\w-]+$/.test(catalog)) return '/catalogs';
  const type = url.searchParams.get('marking') === '1' ? 'MARKING' : url.searchParams.get('type');
  return type && /^[A-Z_]+$/.test(type) ? `/catalogs/${catalog}?type=${type}` : `/catalogs/${catalog}`;
}

export type NoticeView = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: Date;
  unread: boolean;
  client: { id: string; name: string } | null;
};

export type NoticePage = { items: NoticeView[]; total: number; page: number; pageSize: number; pageCount: number };

/** Notice kinds by topic: review tasks, finished audits, and everything else (classifier updates, reminders). */
export const NOTICE_GROUPS = ['review', 'audit', 'other'] as const;
export type NoticeGroup = (typeof NOTICE_GROUPS)[number];

const GROUP_KINDS = { review: ['review.assigned', 'review.completed', 'review.dropped'], audit: ['catalog.ready'] } as const;

export function groupWhere(group: NoticeGroup | undefined): Prisma.NotificationWhereInput {
  if (!group) return {};
  if (group === 'other') return { kind: { notIn: [...GROUP_KINDS.review, ...GROUP_KINDS.audit] } };
  return { kind: { in: [...GROUP_KINDS[group]] } };
}

export type ListOptions = { page?: number; pageSize?: number; unreadOnly?: boolean; group?: NoticeGroup; locale?: Locale };

/** The notice in the reader's language when it was stored in every language; older rows as stored (B13). */
export function noticeText(row: { title: string; body: string; text: Prisma.JsonValue | null }, locale: Locale | undefined): NoticeText {
  const all = row.text && typeof row.text === 'object' && !Array.isArray(row.text) ? row.text : null;
  const mine = locale && all ? all[locale] : null;
  if (mine && typeof mine === 'object' && !Array.isArray(mine) && typeof mine['title'] === 'string' && typeof mine['body'] === 'string') {
    return { title: mine['title'], body: mine['body'] };
  }
  return { title: row.title, body: row.body };
}

export const NOTICE_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/** One page of the user's notifications, newest first. Reading never marks anything read. */
export async function listNotifications(user: NoticeUser, opts: ListOptions = {}): Promise<NoticePage> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(opts.pageSize ?? NOTICE_PAGE_SIZE)));
  const page = Math.max(0, Math.trunc(opts.page ?? 0));
  const where: Prisma.NotificationWhereInput = { AND: [opts.unreadOnly ? unreadWhere(user) : noticeScope(user), groupWhere(opts.group)] };
  const [total, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page * pageSize,
      take: pageSize,
      select: {
        id: true, kind: true, title: true, body: true, text: true, href: true, createdAt: true, readAt: true,
        client: { select: { id: true, name: true } },
        reads: { where: { userId: user.userId }, select: { readAt: true } },
      },
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, ...noticeText(r, opts.locale), href: noticeHref(r.href), createdAt: r.createdAt,
      unread: r.readAt === null && r.reads.length === 0,
      client: r.client,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function unreadCount(user: NoticeUser): Promise<number> {
  return db.notification.count({ where: unreadWhere(user) });
}

const MAX_MARK = 200;

/** Marks these notices read for this user; ids outside the user's scope are ignored. Returns how many were in scope. */
export async function markRead(user: NoticeUser, ids: readonly string[]): Promise<number> {
  const wanted = [...new Set(ids)].slice(0, MAX_MARK);
  if (wanted.length === 0) return 0;
  const visible = await db.notification.findMany({ where: { id: { in: wanted }, ...noticeScope(user) }, select: { id: true } });
  if (visible.length === 0) return 0;
  await db.notificationRead.createMany({ data: visible.map((n) => ({ userId: user.userId, notificationId: n.id })), skipDuplicates: true });
  return visible.length;
}

/** Marks every notice the user can see as read for this user only. Returns how many changed. */
export async function markAllRead(user: NoticeUser): Promise<number> {
  const unread = await db.notification.findMany({ where: unreadWhere(user), select: { id: true } });
  if (unread.length === 0) return 0;
  const created = await db.notificationRead.createMany({
    data: unread.map((n) => ({ userId: user.userId, notificationId: n.id })),
    skipDuplicates: true,
  });
  return created.count;
}

/** Latest notification per client, for the clients list. Personal notices are not shown there: the list is read by everyone who sees the client. */
export async function latestPerClient(orgId: string, clientIds: readonly string[]): Promise<Map<string, { title: string; createdAt: Date }>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db.notification.findMany({
    where: { orgId, clientId: { in: [...clientIds] }, userId: null },
    orderBy: { createdAt: 'desc' },
    distinct: ['clientId'],
    select: { clientId: true, title: true, createdAt: true },
  });
  return new Map(rows.flatMap((r) => (r.clientId ? [[r.clientId, { title: r.title, createdAt: r.createdAt }] as const] : [])));
}
