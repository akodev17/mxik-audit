// In-app notifications, scoped by org and by the user's clients, also sent to the
// org's linked Telegram chats when the bot is configured. Read state is per user.
import type { Prisma } from '@prisma/client';
import { db } from './db.js';
import type { CurrentUser } from './session.js';

export type NewNotification = {
  orgId: string;
  clientId?: string | null;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
};

export async function notify(input: NewNotification): Promise<string> {
  const created = await db.notification.create({
    data: {
      orgId: input.orgId, clientId: input.clientId ?? null, kind: input.kind,
      title: input.title, body: input.body, href: input.href ?? null,
    },
  });
  await deliver(created.id);
  return created.id;
}

/** Sends a notification beyond the app; a delivery failure never loses the notification. */
export async function deliver(notificationId: string): Promise<void> {
  // Loaded lazily so the app never loads the bot library when the bot is off.
  const { deliverToTelegram } = await import('./telegram/deliver.js');
  await deliverToTelegram(notificationId).catch((error: unknown) => {
    console.warn(`[notify ${notificationId}] telegram failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export type NoticeUser = Pick<CurrentUser, 'userId' | 'orgId' | 'clientIds'>;

/** Org-level notices (no client) for everyone; client notices only for users who may see that client. */
export function noticeScope(user: Pick<CurrentUser, 'orgId' | 'clientIds'>): Prisma.NotificationWhereInput {
  if (user.clientIds == null) return { orgId: user.orgId };
  return { orgId: user.orgId, OR: [{ clientId: null }, { clientId: { in: user.clientIds } }] };
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
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/\\')) return null;
  const url = new URL(href, 'http://local');
  if (url.pathname !== '/report') return href;
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

export type ListOptions = { page?: number; pageSize?: number; unreadOnly?: boolean };

export const NOTICE_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/** One page of the user's notifications, newest first. Reading never marks anything read. */
export async function listNotifications(user: NoticeUser, opts: ListOptions = {}): Promise<NoticePage> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(opts.pageSize ?? NOTICE_PAGE_SIZE)));
  const page = Math.max(0, Math.trunc(opts.page ?? 0));
  const where = opts.unreadOnly ? unreadWhere(user) : noticeScope(user);
  const [total, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page * pageSize,
      take: pageSize,
      select: {
        id: true, kind: true, title: true, body: true, href: true, createdAt: true, readAt: true,
        client: { select: { id: true, name: true } },
        reads: { where: { userId: user.userId }, select: { readAt: true } },
      },
    }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, href: noticeHref(r.href), createdAt: r.createdAt,
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

/** Latest notification per client, for the clients list. */
export async function latestPerClient(orgId: string, clientIds: readonly string[]): Promise<Map<string, { title: string; createdAt: Date }>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db.notification.findMany({
    where: { orgId, clientId: { in: [...clientIds] } },
    orderBy: { createdAt: 'desc' },
    distinct: ['clientId'],
    select: { clientId: true, title: true, createdAt: true },
  });
  return new Map(rows.flatMap((r) => (r.clientId ? [[r.clientId, { title: r.title, createdAt: r.createdAt }] as const] : [])));
}
