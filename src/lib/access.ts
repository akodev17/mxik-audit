// Who may do what. Roles: admin manages the org, accountant works on assigned
// clients, viewer only reads. Server routes and actions call these, never the UI.
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from './session';

type Scoped = { clientIds?: string[] | null };

export const canWrite = (user: Pick<CurrentUser, 'role'>): boolean => user.role === 'admin' || user.role === 'accountant';
export const isAdminRole = (user: Pick<CurrentUser, 'role'>): boolean => user.role === 'admin';

/** True when the user may open this client's data. */
export function canSeeClient(user: Scoped, clientId: string | null | undefined): boolean {
  if (user.clientIds == null) return true;
  return clientId !== null && clientId !== undefined && user.clientIds.includes(clientId);
}

/** Prisma filter limiting a Client query to what the user may see. */
export function clientScope(user: Scoped): Prisma.ClientWhereInput {
  return user.clientIds == null ? {} : { id: { in: user.clientIds } };
}

/** Prisma filter limiting a Catalog query to what the user may see. */
export function catalogScope(user: Scoped & { orgId: string }): Prisma.CatalogWhereInput {
  return user.clientIds == null ? { orgId: user.orgId } : { orgId: user.orgId, clientId: { in: user.clientIds } };
}

/** Finding filter: only findings of catalogues the user may see. */
export function findingScope(user: Scoped & { orgId: string }): Prisma.FindingWhereInput {
  return { item: { catalog: catalogScope(user) } };
}
