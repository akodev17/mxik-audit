// Finding types as read from the database. The column is a Postgres enum, and a
// migration can add a value before every running copy of the app has a Prisma
// client generated from the new schema (a rolling deploy, a worktree whose
// client lags the database). Whatever reads the column as text passes it
// through readFindingType, so a value this client does not know becomes 'OTHER'
// (shown with a neutral "other finding" label) instead of failing the page.
import { FindingType } from '@prisma/client';

export type FindingTypeRead = FindingType | 'OTHER';

/** The values of the generated client: what this build can read without failing. */
const KNOWN: ReadonlySet<string> = new Set(Object.values(FindingType));

/** A finding type this client knows, or 'OTHER'. Never throws. */
export function readFindingType(raw: string | null | undefined): FindingTypeRead {
  return raw && KNOWN.has(raw) ? (raw as FindingType) : 'OTHER';
}

export type FindingTypeCount = { type: FindingTypeRead; count: number };

/** Counts keyed by the type as text, every unknown value merged into one OTHER entry. */
export function mergeTypeCounts(rows: Iterable<{ type: string; count: number }>): FindingTypeCount[] {
  const merged = new Map<FindingTypeRead, number>();
  for (const r of rows) {
    const type = readFindingType(r.type);
    merged.set(type, (merged.get(type) ?? 0) + r.count);
  }
  return [...merged].map(([type, count]) => ({ type, count }));
}
