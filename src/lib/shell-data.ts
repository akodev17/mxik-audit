// What the app frame needs on every page: clients, unread count, the latest catalogue.
import { db } from './db';
import { resolveClient } from './clients';
import { unreadCount } from './notifications';
import type { CurrentUser } from './session';

export type ShellData = {
  email: string;
  demo: boolean;
  clients: { id: string; name: string }[];
  activeClient: { id: string; name: string };
  unread: number;
  /** The catalogue the search box and the demo land on. */
  latestCatalogId: string | null;
};

export async function shellData(user: CurrentUser): Promise<ShellData> {
  const active = await resolveClient(user.orgId, user.clientId);
  const [clients, unread, latest] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    unreadCount(user.orgId).catch(() => 0),
    db.catalog.findFirst({ where: { orgId: user.orgId, clientId: active.id }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
  ]);
  return {
    email: user.email,
    demo: user.demo,
    clients,
    activeClient: { id: active.id, name: active.name },
    unread,
    latestCatalogId: latest?.id ?? null,
  };
}
