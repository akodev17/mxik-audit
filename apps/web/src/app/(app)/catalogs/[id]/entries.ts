import type { GridRow } from './ws-types';

export type Entry =
  | { kind: 'row'; row: GridRow; inGroup: boolean }
  | { kind: 'group'; key: string; rows: GridRow[] };

/** Flat list, or one entry per group of similar loaded rows (members listed when expanded). */
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

/** The finding an entry stands for: itself, or the first pending member of a group. */
export function entryRow(entry: Entry | undefined): GridRow | undefined {
  if (!entry) return undefined;
  return entry.kind === 'row' ? entry.row : entry.rows.find((r) => r.decision === 'pending') ?? entry.rows[0];
}

export const entryId = (entry: Entry): string => (entry.kind === 'row' ? entry.row.findingId : `g:${entry.key}`);

/** Short stable hash, so any group key (Cyrillic, spaces, pipes) becomes a valid, distinct DOM id. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** DOM id for aria-activedescendant. */
export const entryDomId = (entry: Entry): string =>
  entry.kind === 'row' ? `ws-row-${entry.row.findingId}` : `ws-group-${hash(entry.key)}-${entry.rows[0]?.findingId ?? ''}`;

/** Index of the next pending row after `from`, or -1. */
export function nextPendingIndex(entries: readonly Entry[], from: number): number {
  for (let i = from + 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.kind === 'row' && e.row.decision === 'pending') return i;
  }
  return -1;
}
