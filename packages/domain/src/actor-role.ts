// An actor's role as the database has it now. Library functions re-check it here:
// a role passed in by a caller can be stale (the member was demoted or removed since).
import type { Prisma, UserRole } from '@prisma/client';
import { canWrite, isAdminRole } from './access.js';
import { db } from './db.js';

type Reader = Pick<Prisma.TransactionClient, 'user'>;

/** The user's role in this org; null when the user is gone or belongs to another org. */
export async function roleIn(orgId: string, userId: string, client: Reader = db): Promise<UserRole | null> {
  const user = await client.user.findFirst({ where: { id: userId, orgId }, select: { role: true } });
  return user?.role ?? null;
}

export async function isOrgAdmin(orgId: string, userId: string, client: Reader = db): Promise<boolean> {
  const role = await roleIn(orgId, userId, client);
  return role !== null && isAdminRole({ role });
}

export async function isOrgWriter(orgId: string, userId: string, client: Reader = db): Promise<boolean> {
  const role = await roleIn(orgId, userId, client);
  return role !== null && canWrite({ role });
}
