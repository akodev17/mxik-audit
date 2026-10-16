import type { GridRow } from '@/lib/workspace-rows';

export type Entry =
  | { kind: 'row'; row: GridRow; inGroup: boolean }
  | { kind: 'group'; key: string; rows: GridRow[] };

/** Flat list, or one entry per group of similar rows (members listed when expanded). */
export function buildEntries(rows: readonly GridRow[], grouped: boolean, expanded: ReadonlySet<string>): Entry[] {
  if (!grouped) return rows.map((row) => ({ kind: 'row', row, inGroup: false }));
  const members = new Map<string, GridRow[]>();
  for (const row of rows) {
    if (row.groupKey) members.set(row.groupKey, [...(members.get(row.groupKey) ?? []), row]);
  }
  const out: Entry[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const group = row.groupKey ? members.get(row.groupKey) : undefined;
    if (!row.groupKey || !group || group.length < 2) {
      out.push({ kind: 'row', row, inGroup: false });
      continue;
    }
    if (placed.has(row.groupKey)) continue;
    placed.add(row.groupKey);
    out.push({ kind: 'group', key: row.groupKey, rows: group });
    if (expanded.has(row.groupKey)) out.push(...group.map((r): Entry => ({ kind: 'row', row: r, inGroup: true })));
  }
  return out;
}

/** The finding id an entry stands for: the first pending member of a group. */
export function entryRow(entry: Entry | undefined): GridRow | undefined {
  if (!entry) return undefined;
  return entry.kind === 'row' ? entry.row : entry.rows.find((r) => r.decision === 'pending') ?? entry.rows[0];
}

export const entryId = (entry: Entry): string => (entry.kind === 'row' ? entry.row.findingId : `g:${entry.key}`);
