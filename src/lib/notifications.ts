// In-app notifications, scoped by org. Delivery to other channels (Telegram)
// hangs off `deliver`; a channel that is not configured is simply skipped.
import { db } from './db.js';

export type NewNotification = {
  orgId: string;
  clientId?: string | null;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
};

type Channel = (notificationId: string) => Promise<void>;
const channels: Channel[] = [];

/** Registers an extra delivery channel (e.g. Telegram). Called once at startup. */
export function addNotificationChannel(channel: Channel): void {
  channels.push(channel);
}

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

/** Hands one notification to every channel; a failing channel never blocks the others. */
export async function deliver(notificationId: string): Promise<void> {
  for (const channel of channels) {
    await channel(notificationId).catch((error: unknown) => {
      console.warn(`[notify ${notificationId}] channel failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

export async function listNotifications(orgId: string, limit = 50) {
  return db.notification.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { client: { select: { id: true, name: true } } },
  });
}

export async function unreadCount(orgId: string): Promise<number> {
  return db.notification.count({ where: { orgId, readAt: null } });
}

export async function markAllRead(orgId: string): Promise<void> {
  await db.notification.updateMany({ where: { orgId, readAt: null }, data: { readAt: new Date() } });
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
