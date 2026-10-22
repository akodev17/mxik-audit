// The client the app works on for this user: the remembered one when the user may still see it,
// otherwise the first client in the user's scope. Archived clients are never active.
import { canSeeClient, clientScope } from './access';
import { db } from './db';
import type { CurrentUser } from './session';

export type VisibleClient = { id: string; name: string; isDefault: boolean };

type Who = Pick<CurrentUser, 'orgId' | 'clientId' | 'clientIds'>;

const SELECT = { id: true, name: true, isDefault: true } as const;
const ORDER = [{ isDefault: 'desc' as const }, { name: 'asc' as const }];

/** Session client if visible and not archived, else the first visible client, else null. */
export async function resolveVisibleClient(user: Who): Promise<VisibleClient | null> {
  if (user.clientId && canSeeClient(user, user.clientId)) {
    const remembered = await db.client.findFirst({ where: { id: user.clientId, orgId: user.orgId, archivedAt: null }, select: SELECT });
    if (remembered) return remembered;
  }
  return db.client.findFirst({ where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) }, orderBy: ORDER, select: SELECT });
}

/** Every client the user may switch to, default client first. */
export async function visibleClients(user: Pick<CurrentUser, 'orgId' | 'clientIds'>): Promise<{ id: string; name: string }[]> {
  return db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) },
    orderBy: ORDER,
    select: { id: true, name: true },
  });
}

/** The client by id when this user may switch to it (same org, in scope, not archived). */
export async function switchableClient(user: Pick<CurrentUser, 'orgId' | 'clientIds'>, clientId: string): Promise<VisibleClient | null> {
  if (!canSeeClient(user, clientId)) return null;
  return db.client.findFirst({ where: { id: clientId, orgId: user.orgId, archivedAt: null }, select: SELECT });
}
