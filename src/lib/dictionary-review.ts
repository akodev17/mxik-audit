// Reviewing the firm dictionary: which entries a person stood behind, which rest on bulk accepts or an
// unknown history, and which point at a code the classifier has since retired. Read-only and tenant-scoped:
// every query starts from the org id, and approvers are looked up inside the same org.
import type { Prisma } from '@prisma/client';
import { db } from './db.js';

export const DICT_FILTERS = ['all', 'confirmed', 'unverified', 'stale'] as const;
export type DictFilter = (typeof DICT_FILTERS)[number];

export function parseDictFilter(value: unknown): DictFilter {
  return typeof value === 'string' && (DICT_FILTERS as readonly string[]).includes(value) ? (value as DictFilter) : 'all';
}

/** Codes of this org's entries that the classifier has retired (the entry is ignored by audits until it is edited). */
export async function retiredEntryCodes(orgId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ code: string }[]>`
    SELECT DISTINCT fm.code
    FROM firm_mapping fm
    JOIN mxik_code c ON c.code = fm.code
    WHERE fm."orgId" = ${orgId} AND c."retiredAt" IS NOT NULL`;
  return rows.map((r) => r.code.trim());
}

/**
 * Prisma filter for a dictionary view. "stale" = flagged by an audit or pointing at a retired code;
 * "confirmed" = at least one individual confirmation; "unverified" = live entries nobody confirmed one by one.
 */
export function dictionaryWhere(orgId: string, filter: DictFilter, retired: readonly string[], q = ''): Prisma.FirmMappingWhereInput {
  const search: Prisma.FirmMappingWhereInput = q
    ? { OR: [{ label: { contains: q, mode: 'insensitive' } }, { key: { startsWith: q } }, { code: { startsWith: q } }] }
    : {};
  const stale: Prisma.FirmMappingWhereInput = { OR: [{ staleAt: { not: null } }, { code: { in: [...retired] } }] };
  const live: Prisma.FirmMappingWhereInput = { staleAt: null, code: { notIn: [...retired] } };
  const by: Prisma.FirmMappingWhereInput =
    filter === 'stale' ? stale
      : filter === 'confirmed' ? { ...live, confirmations: { gt: 0 } }
        : filter === 'unverified' ? { ...live, confirmations: 0 }
          : {};
  return { AND: [{ orgId }, by, search] };
}

/** How many entries each view holds, so the filter chips can say so. */
export async function dictionaryCounts(orgId: string, q = ''): Promise<Record<DictFilter, number>> {
  const retired = await retiredEntryCodes(orgId);
  const counts = await Promise.all(DICT_FILTERS.map((f) => db.firmMapping.count({ where: dictionaryWhere(orgId, f, retired, q) })));
  return Object.fromEntries(DICT_FILTERS.map((f, i) => [f, counts[i] ?? 0])) as Record<DictFilter, number>;
}

/** The e-mail of whoever last taught or edited each entry, only for people of this org. */
export async function approverEmails(orgId: string, userIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, email: true } });
  return new Map(users.map((u) => [u.id, u.email]));
}
