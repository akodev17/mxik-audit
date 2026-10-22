// A closed account (deletedAt set) keeps nothing running: no API keys, share links or bot.
import { db } from '@tasnivo/db';

export async function orgActive(orgId: string): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { deletedAt: true } });
  return org !== null && org.deletedAt === null;
}
